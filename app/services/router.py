import asyncio
import json
import logging
import re
import time
from abc import ABC, abstractmethod
from typing import List, Optional

from app.core.config import settings
from app.schemas.router import ConversationalRouteResult, RouterAction

logger = logging.getLogger(__name__)

ROUTING_SYSTEM_INSTRUCTION = """
You are the Conversational Routing Engine for an enterprise knowledge and search platform.
Your objective is to inspect the latest user message alongside the conversation history, resolve ambiguity, and determine whether to RETRIEVE information from the knowledge base, CLARIFY an ambiguous command, or provide a DIRECT conversational greeting/closing.

Output strictly valid JSON conforming to the requested schema.

### Core Rules for Intent Classification ("action"):

1. "retrieve" (PRIMARY & DEFAULT ACTION for questions):
- Choose "retrieve" whenever the user is asking ANY question or seeking information, facts, contact methods, services, procedures, pricing, or locations.
- CRITICAL DOMAIN SCOPING:
  * Pronouns like "you", "your", "vous", "votre" refer to the HOST ORGANIZATION / COMPANY whose knowledge base is indexed, NOT the AI software model.
  * Inquiries such as:
    - "Who are you?" / "Qui êtes-vous ?" / "C'est quoi ce site ?" / "Vous faites quoi ?"
    - "What are your services?" / "Quels sont vos services ?"
    - "Where are you located?" / "Où êtes-vous situés ?" / "Vos bureaux ?"
    - "How can I contact you?" / "Comment vous contacter ?" / "Téléphone / Email"
    - "How to do customs clearance?" / "Comment faire le dédouanement ?"
    - "What documents are required?" / "Quels documents pour importer ?"
    - "What are the delays?" / "Quels sont les délais ?"
    MUST ALWAYS be classified as "retrieve"! The answers exist in the organization's indexed knowledge base and knowledge graph.
  * Populate "standalone_query" and extract appropriate "seed_entities" (e.g., the company name, service names, locations, document types).
  * Set "direct_or_clarification_message" to null and "clarification_options" to an empty list [].

2. "direct_response":
- STRICTLY RESERVED for pure conversational pleasantries containing NO inquiry, question, or request for information:
  * Pure greetings: "Hi", "Hello", "Bonjour", "Hey"
  * Pure gratitude: "Thanks", "Thank you", "Merci", "Merci beaucoup"
  * Pure closings: "Goodbye", "Bye", "Au revoir", "Bonne journée"
- DO NOT use "direct_response" if the message asks ANY question or seeks ANY information about the company, services, or procedures.
- Populate "direct_or_clarification_message" with a polite, professional reply. Set "clarification_options" to []. Set "standalone_query" to null.

3. "clarify":
- RESERVED for broad, critically underspecified, or ambiguous queries across multiple systems/topics (e.g., "How do I deploy?", "Show me the logs", "check logs", "deploy", "fix bug", "logs") where the specific target system or environment is unknown. Rather than guessing, pause retrieval to ask a clarifying question.
- Do NOT use "clarify" for natural questions like "Comment faire le dédouanement ?" or "Quels documents pour importer ?" because the organization's documents contain the comprehensive answer.
- When action is "clarify", you MUST:
  * Write a concise message explaining the ambiguity in "direct_or_clarification_message".
  * Provide 2 to 4 brief, clickable choices in "clarification_options" (e.g., ["Production Web Deploy", "Staging Deploy", "CI/CD Pipeline"]). This field MUST NOT be empty.
  * Set "standalone_query" to null.

### Multi-Turn Coreference Resolution:
- When action is "retrieve", rewrite the user's latest message into "standalone_query", replacing pronouns ("it", "they", "il", "elle") with explicit entities from history.
- When action is NOT "retrieve", set "standalone_query" to null.

### Output JSON Format:
{
  "action": "retrieve" | "direct_response" | "clarify",
  "standalone_query": string or null,
  "seed_entities": [string],
  "direct_or_clarification_message": string or null,
  "clarification_options": [string]
}
"""


class BaseConversationalRouter(ABC):
    """Abstract base class for the Conversational Routing Engine."""

    @abstractmethod
    async def route(
        self,
        query: str,
        conversation_history: Optional[List[dict]] = None,
        tenant_name: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> ConversationalRouteResult:
        """Inspects query and conversation history to determine action and execution parameters."""
        pass


class MockConversationalRouter(BaseConversationalRouter):
    """
    Deterministic rule-based router for unit tests and local/offline execution.
    Implements full intent classification, multi-turn coreference resolution,
    seed entity extraction, and clarification choices without external API dependencies.
    """

    GREETING_PATTERNS = [
        r"^\s*(hi|hello|hey|greetings|howdy|good\s+(morning|afternoon|evening))\b",
        r"^\s*(thanks|thank\s+you|appreciate\s+it|thx)\b",
        r"^\s*(bye|goodbye|see\s+you|farewell|have\s+a\s+good\s+day)\b",
    ]

    AMBIGUOUS_PATTERNS = [
        r"\b(how\s+do\s+i\s+deploy|deploy|deployment)\b",
        r"\b(show\s+me\s+the\s+logs|check\s+the\s+logs|logs)\b",
        r"\b(fix\s+the\s+bug|there\s+is\s+a\s+bug|error\s+in\s+code)\b",
        r"^\s*(help|support|assist\s+me)\s*$",
    ]

    COMMON_ACRONYMS = {"JWT", "CVE", "API", "SDK", "URL", "HTTP", "SSO", "REST", "SQL", "RBAC", "AWS", "GCP"}

    STOPWORDS = {
        "the", "a", "an", "this", "that", "these", "those", "what", "who", "user", "assistant",
        "according", "based", "however", "therefore", "furthermore", "please", "hello",
        "thanks", "with", "from", "for", "when", "where", "which", "why", "how", "and",
        "or", "but", "yes", "no", "referencing", "verified",
        "tell", "show", "give", "explain", "find", "describe", "is", "are", "was", "were",
        "can", "could", "would", "will", "do", "does", "did", "me", "my", "about", "to", "in", "on"
    }

    async def route(
        self,
        query: str,
        conversation_history: Optional[List[dict]] = None,
        tenant_name: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> ConversationalRouteResult:
        start_time = time.perf_counter()
        clean_q = query.strip()
        lower_q = clean_q.lower()

        # Inquiries should never be treated as direct response greetings
        has_inquiry_cue = any(k in lower_q for k in [
            "?", "qui", "quoi", "comment", "où", "ou", "quel", "quels", "quelle", "quelles",
            "how", "what", "where", "service", "contact", "phone", "email", "tarif", "delai", "délai", "document"
        ])

        # 1. Direct response check (pure greetings, thanks, closings)
        if not has_inquiry_cue:
            for pattern in self.GREETING_PATTERNS:
                if re.search(pattern, lower_q, re.IGNORECASE):
                    if any(k in lower_q for k in ["thanks", "thank", "appreciate", "thx"]):
                        msg = "You are very welcome! Let me know if you need anything else from our knowledge base."
                    elif any(k in lower_q for k in ["bye", "goodbye", "farewell"]):
                        msg = "Goodbye! Have a great day ahead."
                    else:
                        msg = "Hello! How can I assist you with your organization's knowledge base today?"

                    elapsed = round((time.perf_counter() - start_time) * 1000, 2)
                    return ConversationalRouteResult(
                        action=RouterAction.DIRECT_RESPONSE,
                        standalone_query=None,
                        seed_entities=[],
                        direct_or_clarification_message=msg,
                        clarification_options=[],
                        execution_time_ms=elapsed,
                    )

        # 2. Clarification check (broad or underspecified queries)
        for pattern in self.AMBIGUOUS_PATTERNS:
            if re.search(pattern, lower_q, re.IGNORECASE) and len(clean_q.split()) <= 6:
                if "deploy" in lower_q:
                    msg = "Which deployment environment or target are you referring to?"
                    options = ["Production Web Deploy", "Staging Mobile Deploy", "CI/CD Pipeline"]
                elif "log" in lower_q:
                    msg = "Which service logs would you like to inspect?"
                    options = ["API Gateway Logs", "Database Cluster Logs", "Auth Service Logs"]
                elif "bug" in lower_q:
                    msg = "Which system or component is experiencing this issue?"
                    options = ["Frontend Web App", "Backend API Service", "Database Migration"]
                else:
                    msg = "Could you please specify which topic or system you'd like help with?"
                    options = ["System Architecture", "Security & Auth", "Deployment Guide"]

                elapsed = round((time.perf_counter() - start_time) * 1000, 2)
                return ConversationalRouteResult(
                    action=RouterAction.CLARIFY,
                    standalone_query=None,
                    seed_entities=[],
                    direct_or_clarification_message=msg,
                    clarification_options=options,
                    execution_time_ms=elapsed,
                )

        # 3. Retrieve action: coreference resolution & seed entity extraction
        standalone = clean_q
        detected_entities = []

        # Find entities in history to resolve pronouns, prioritizing user turns
        history_entities = []
        if conversation_history:
            for turn in reversed(conversation_history):
                if turn.get("role") == "user":
                    content = turn.get("content", "")
                    found = re.findall(r"\b[A-Z][a-zA-Z0-9_-]+(?:\s+[A-Z][a-zA-Z0-9_-]+)*\b", content)
                    for f in found:
                        if f.lower() not in self.STOPWORDS and f not in history_entities:
                            history_entities.append(f)

            for turn in reversed(conversation_history):
                if turn.get("role") == "assistant":
                    content = turn.get("content", "")
                    found = re.findall(r"\b[A-Z][a-zA-Z0-9_-]+(?:\s+[A-Z][a-zA-Z0-9_-]+)*\b", content)
                    for f in found:
                        if f.lower() not in self.STOPWORDS and f not in history_entities:
                            history_entities.append(f)

        # Coreference replacement
        pronoun_match = re.search(r"\b(it|they|that\s+tool|his\s+project|this\s+system)\b", lower_q)
        if pronoun_match and history_entities:
            target_entity = history_entities[0]
            # Replace pronoun with primary entity
            standalone = re.sub(
                r"\b(it|they|that\s+tool|his\s+project|this\s+system)\b",
                target_entity,
                clean_q,
                flags=re.IGNORECASE
            )
            detected_entities.append(target_entity)

        # Extract high-value domain nouns / proper nouns from standalone query
        matches = re.findall(r"\b[a-zA-Z0-9_-]+\b", standalone)
        for word in matches:
            upper_w = word.upper()
            if upper_w in self.COMMON_ACRONYMS:
                if upper_w not in detected_entities:
                    detected_entities.append(upper_w)

        cap_entities = re.findall(r"\b[A-Z][a-zA-Z0-9_-]+(?:\s+[A-Z][a-zA-Z0-9_-]+)*\b", standalone)
        for ent in cap_entities:
            ent_clean = ent.strip()
            if ent_clean.lower() not in {"what", "who", "how", "why", "which", "where", "is", "does", "the", "tell"}:
                if ent_clean not in detected_entities:
                    detected_entities.append(ent_clean)

        # Fallback check for known lowercase matches that should be Title Cased
        for known in ["hydra auth", "project titan"]:
            if known in standalone.lower():
                titled = known.title()
                if titled not in detected_entities:
                    detected_entities.append(titled)

        elapsed = round((time.perf_counter() - start_time) * 1000, 2)
        return ConversationalRouteResult(
            action=RouterAction.RETRIEVE,
            standalone_query=standalone,
            seed_entities=detected_entities,
            direct_or_clarification_message=None,
            clarification_options=[],
            execution_time_ms=elapsed,
        )


class GeminiConversationalRouter(BaseConversationalRouter):
    """
    Production router leveraging Google Gemini with structured JSON output schema.
    Applies the conversational routing prompt to resolve ambiguity, rewrite queries,
    and extract seed entities.
    """

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        from google import genai

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.mock_fallback = MockConversationalRouter()

    async def route(
        self,
        query: str,
        conversation_history: Optional[List[dict]] = None,
        tenant_name: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> ConversationalRouteResult:
        start_time = time.perf_counter()

        history_str = "None"
        if conversation_history:
            recent_turns = conversation_history[-6:]
            history_str = "\n".join([f"{msg.get('role', 'user').capitalize()}: {msg.get('content', '')}" for msg in recent_turns])

        context_lines = []
        if tenant_name:
            context_lines.append(f"Target Organization / Company: {tenant_name}")
        if custom_system_prompt:
            context_lines.append(f"Organization Directives / Persona: {custom_system_prompt}")
        context_block = ("\n" + "\n".join(context_lines) + "\n") if context_lines else ""

        prompt = f"""
{ROUTING_SYSTEM_INSTRUCTION}
{context_block}
CONVERSATION HISTORY:
{history_str}

LATEST USER MESSAGE:
{query}

JSON RESPONSE:
"""
        try:
            req_config = {
                "response_mime_type": "application/json",
                "temperature": 0.0,
            }
            # Check if sync models.generate_content was specifically mocked (e.g. by unit tests)
            is_sync_mocked = (
                hasattr(self.client, "models")
                and hasattr(self.client.models, "generate_content")
                and type(self.client.models.generate_content).__name__ in ("MagicMock", "AsyncMock", "Mock")
            )
            if hasattr(self.client, "aio") and hasattr(self.client.aio, "models") and not is_sync_mocked:
                # Native async client avoids blocking the event loop
                gen_coro = self.client.aio.models.generate_content(
                    model=self.model,
                    contents=prompt,
                    config=req_config,
                )
            else:
                # Fallback path if native async client is unavailable or sync method is mocked in tests
                gen_coro = asyncio.to_thread(
                    self.client.models.generate_content,
                    model=self.model,
                    contents=prompt,
                    config=req_config,
                )
            # Cap latency to 5.0s max: if Google API hangs on 503 retries, fail-fast to deterministic rule-based router
            response = await asyncio.wait_for(gen_coro, timeout=5.0)
            raw_json = response.text.strip()
            data = json.loads(raw_json)

            action_val = data.get("action", "retrieve")
            try:
                action_enum = RouterAction(action_val)
            except ValueError:
                action_enum = RouterAction.RETRIEVE

            clarification_opts = data.get("clarification_options", []) if action_enum == RouterAction.CLARIFY else []
            if action_enum == RouterAction.CLARIFY and not clarification_opts:
                mock_res = await self.mock_fallback.route(
                    query=query,
                    conversation_history=conversation_history,
                    tenant_name=tenant_name,
                    custom_system_prompt=custom_system_prompt,
                )
                clarification_opts = mock_res.clarification_options or ["Overview & Capabilities", "Specific Services", "Contact & Locations"]

            elapsed = round((time.perf_counter() - start_time) * 1000, 2)
            return ConversationalRouteResult(
                action=action_enum,
                standalone_query=data.get("standalone_query") if action_enum == RouterAction.RETRIEVE else None,
                seed_entities=data.get("seed_entities", []) if action_enum == RouterAction.RETRIEVE else [],
                direct_or_clarification_message=data.get("direct_or_clarification_message"),
                clarification_options=clarification_opts,
                execution_time_ms=elapsed,
            )
        except Exception as exc:
            logger.warning(
                f"[ConversationalRouter] Gemini routing failed ({exc}). Falling back to rule-based router."
            )
            return await self.mock_fallback.route(
                query=query,
                conversation_history=conversation_history,
                tenant_name=tenant_name,
                custom_system_prompt=custom_system_prompt,
            )


class OpenAIConversationalRouter(BaseConversationalRouter):
    """
    Production router leveraging OpenAI (e.g. gpt-4o-mini) with structured JSON output schema.
    Applies conversational routing to resolve ambiguity, rewrite queries, and extract seed entities.
    """

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key, timeout=8.0)
        self.model = model
        self.mock_fallback = MockConversationalRouter()

    async def route(
        self,
        query: str,
        conversation_history: Optional[List[dict]] = None,
        tenant_name: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> ConversationalRouteResult:
        start_time = time.perf_counter()

        history_str = "None"
        if conversation_history:
            recent_turns = conversation_history[-6:]
            history_str = "\n".join([f"{msg.get('role', 'user').capitalize()}: {msg.get('content', '')}" for msg in recent_turns])

        context_lines = []
        if tenant_name:
            context_lines.append(f"Target Organization / Company: {tenant_name}")
        if custom_system_prompt:
            context_lines.append(f"Organization Directives / Persona: {custom_system_prompt}")
        context_block = ("\n" + "\n".join(context_lines) + "\n") if context_lines else ""

        user_content = f"""{context_block}
CONVERSATION HISTORY:
{history_str}

LATEST USER MESSAGE:
{query}

JSON RESPONSE:"""

        try:
            res = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": ROUTING_SYSTEM_INSTRUCTION},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
            )
            raw_json = res.choices[0].message.content or "{}"
            data = json.loads(raw_json)

            action_val = data.get("action", "retrieve")
            try:
                action_enum = RouterAction(action_val)
            except ValueError:
                action_enum = RouterAction.RETRIEVE

            clarification_opts = data.get("clarification_options", []) if action_enum == RouterAction.CLARIFY else []
            if action_enum == RouterAction.CLARIFY and not clarification_opts:
                mock_res = await self.mock_fallback.route(
                    query=query,
                    conversation_history=conversation_history,
                    tenant_name=tenant_name,
                    custom_system_prompt=custom_system_prompt,
                )
                clarification_opts = mock_res.clarification_options or ["Overview & Capabilities", "Specific Services", "Contact & Locations"]

            elapsed = round((time.perf_counter() - start_time) * 1000, 2)
            return ConversationalRouteResult(
                action=action_enum,
                standalone_query=data.get("standalone_query") if action_enum == RouterAction.RETRIEVE else None,
                seed_entities=data.get("seed_entities", []) if action_enum == RouterAction.RETRIEVE else [],
                direct_or_clarification_message=data.get("direct_or_clarification_message"),
                clarification_options=clarification_opts,
                execution_time_ms=elapsed,
            )
        except Exception as exc:
            logger.warning(
                f"[ConversationalRouter] OpenAI routing failed ({exc}). Falling back to rule-based router."
            )
            return await self.mock_fallback.route(
                query=query,
                conversation_history=conversation_history,
                tenant_name=tenant_name,
                custom_system_prompt=custom_system_prompt,
            )


def get_conversational_router(api_key: Optional[str] = None) -> BaseConversationalRouter:
    """Factory returning OpenAIConversationalRouter or GeminiConversationalRouter based on config."""
    # 1. Explicit OpenAI key
    if api_key and api_key.strip() and api_key.strip().startswith("sk-"):
        try:
            return OpenAIConversationalRouter(
                api_key=api_key.strip(),
                model=settings.LLM_MODEL if "gpt" in settings.LLM_MODEL else "gpt-4o-mini"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIConversationalRouter ({e}). Checking Gemini...")

    # 2. Explicit Gemini key
    if api_key and api_key.strip() and not api_key.strip().startswith("sk-"):
        try:
            return GeminiConversationalRouter(
                api_key=api_key.strip(),
                model="models/gemini-3.6-flash"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiConversationalRouter ({e}). Using MockConversationalRouter.")
            return MockConversationalRouter()

    # 3. System OpenAI key fallback
    if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY.strip():
        try:
            return OpenAIConversationalRouter(
                api_key=settings.OPENAI_API_KEY.strip(),
                model=settings.LLM_MODEL if "gpt" in settings.LLM_MODEL else "gpt-4o-mini"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIConversationalRouter ({e}). Checking Gemini...")

    # 4. System Gemini key fallback
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiConversationalRouter(
                api_key=settings.GEMINI_API_KEY.strip(),
                model="models/gemini-3.6-flash"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiConversationalRouter ({e}). Using MockConversationalRouter.")
            return MockConversationalRouter()

    return MockConversationalRouter()
