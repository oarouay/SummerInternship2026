import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.schemas.graph import GraphNeighborhoodResponse
from app.schemas.rag import (
    RAGGraphCitation,
    RAGQueryResponse,
    RAGSourceCitation,
)
from app.schemas.router import RouterAction
from app.schemas.search import SearchResult
from app.schemas.synthesis import SynthesisResult
from app.services.disambiguation import get_graph_disambiguator
from app.services.embedding import get_embedding_service
from app.services.extractor import get_graph_extractor
from app.services.graph import get_graph_store
from app.services.router import get_conversational_router
from app.services.search import search_similar_chunks
from app.models.ai_profile import AIProfile, Persona
from app.services.ai_profile_service import AIProfileService
from app.services.evidence import EvidenceBuilder, EvidencePackage
from app.services.prompt_compiler import PromptCompiler
from app.services.response_validator import ResponseValidator

logger = logging.getLogger(__name__)

GROUNDED_SYNTHESIS_SYSTEM_INSTRUCTION = """
You are the Grounded Synthesis Engine for an enterprise knowledge retrieval system.
Your mission is to generate accurate, direct, and dynamic responses using strictly the provided Document Passages, Verified Graph Triples, and Candidate Graph Concepts.

Adopt the requested Tenant Persona at all times (e.g., technical, concise, professional).
Output strictly valid JSON matching the requested schema.

### Context Handling Rules:

1. COMPLETE MATCH:
- Answer the user's query directly and authoritatively.
- Synthesize information across both unstructured Document Passages and structured Graph Triples.
- Maintain absolute fidelity: do NOT speculate, fabricate, or extrapolate beyond the verified facts.
- Generate 2 to 3 intelligent, forward-looking suggestions in "follow_up_suggestions" that guide the user to explore deeper technical connections or adjacent systems. Set "needs_clarification" to false.

2. PARTIAL MATCH:
- State what IS confirmed by the available Document Passages or Graph Triples as a direct, complete, and authoritative answer to that portion of the question.
- Do NOT add generic disclaimers or stall the response. Only append a brief note about what is missing if there is a specific, named gap in the records.
- Populate "follow_up_suggestions" with intelligent forward-looking paths or adjacent topics the user can explore.
- Set "needs_clarification" to true ONLY when the core of the user's question genuinely cannot be answered without additional input from the user (such as multiple competing ambiguous entities matched). If the verified facts sufficiently answer the user's question, set "needs_clarification" to false.

3. ZERO MATCH OR LOW CONFIDENCE:
- If no document passages meet the relevance threshold and no graph paths confirm the query:
  * Never state generic non-answers like "I don't know" or "Insufficient information."
  * State clearly: "I could not find records directly answering [User Query] in your organization's indexed knowledge base."
  * Inspect the provided "Candidate Graph Concepts". If candidate entities or adjacent tenant topics are present, bridge the gap: "However, I found related entities in your knowledge graph: [List 2-3 candidate entities with brief context]. Would you like to inspect one of these?"
  * Populate "follow_up_suggestions" directly with the names of these candidate entities.
  * Set "needs_clarification" to true.

### Formatting & Style:
- Use clear Markdown with bold text and bullet points for complex breakdowns.
- Cite specific document titles and relational triples inline where appropriate.
- Keep the synthesis tone helpful, grounded, and collaborative.
"""

STREAMING_SYNTHESIS_SYSTEM_INSTRUCTION = """
You are the Grounded Synthesis Engine for an enterprise knowledge retrieval system.
Your mission is to generate an accurate, direct, and dynamic response using strictly the provided Document Passages, Verified Graph Triples, and Candidate Graph Concepts.

Adopt the requested Tenant Persona at all times (e.g., technical, concise, professional).

### Context Handling Rules:

1. COMPLETE MATCH:
- Answer the user's query directly and authoritatively.
- Synthesize information across both unstructured Document Passages and structured Graph Triples.
- Maintain absolute fidelity: do NOT speculate, fabricate, or extrapolate beyond the verified facts.

2. PARTIAL MATCH:
- State what IS confirmed by the available Document Passages or Graph Triples as a direct, complete, and authoritative answer to that portion of the question.
- Do NOT add generic disclaimers or stall the response. Only append a brief note about what is missing if there is a specific, named gap in the records.

3. ZERO MATCH OR LOW CONFIDENCE:
- If no document passages meet the relevance threshold and no graph paths confirm the query:
  * Never state generic non-answers like "I don't know" or "Insufficient information."
  * State clearly: "I could not find records directly answering [User Query] in your organization's indexed knowledge base."
  * Inspect the provided "Candidate Graph Concepts". If candidate entities or adjacent tenant topics are present, bridge the gap: "However, I found related entities in your knowledge graph: [List 2-3 candidate entities with brief context]. Would you like to inspect one of these?"

### Formatting & Style:
- Use clear Markdown with bold text and bullet points for complex breakdowns.
- Cite specific document titles and relational triples inline where appropriate.
- Keep the synthesis tone helpful, grounded, and collaborative.
- Output ONLY the markdown formatted answer text. Do not wrap in JSON or add extraneous meta-commentary.
"""


async def _empty_neighborhood() -> GraphNeighborhoodResponse:
    """Returns an empty GraphNeighborhoodResponse for branchless asyncio.gather concurrency."""
    return GraphNeighborhoodResponse()


def build_fusion_context(
    chunks: List[SearchResult],
    graph: GraphNeighborhoodResponse,
    candidate_concepts: Optional[List[str]] = None,
) -> str:
    """
    Fuses unstructured text passages, structured knowledge graph triples,
    and candidate graph concepts into a unified markdown prompt context.
    """
    sections = []

    # 1. Knowledge Graph Section
    if graph.edges:
        graph_lines = ["### 🕸️ Verified Knowledge Graph Relationships:"]
        for edge in graph.edges:
            desc = f" ({edge.description})" if edge.description else ""
            graph_lines.append(f"- ({edge.source}) --[{edge.type}]--> ({edge.target}){desc}")
        sections.append("\n".join(graph_lines))
    elif graph.nodes:
        node_lines = ["### 🕸️ Verified Knowledge Graph Entities:"]
        for node in graph.nodes:
            desc = f": {node.description}" if node.description else ""
            node_lines.append(f"- {node.name} [{node.type}]{desc}")
        sections.append("\n".join(node_lines))

    # 2. Text Chunks Section
    if chunks:
        chunk_lines = ["### 📄 Verified Document Passages:"]
        for i, chk in enumerate(chunks, 1):
            chunk_lines.append(
                f"[{i}] Document: \"{chk.source_name}\" (Chunk #{chk.chunk_id}, Relevance: {chk.score:.2f})\n"
                f"{chk.content.strip()}"
            )
        sections.append("\n\n".join(chunk_lines))

    # 3. Candidate Graph Concepts
    if candidate_concepts:
        cand_lines = ["### 💡 Candidate Knowledge Graph Concepts:"]
        for cand in candidate_concepts:
            cand_lines.append(f"- {cand}")
        sections.append("\n".join(cand_lines))

    if not sections:
        return "No relevant context found in the organization's knowledge base."

    return "\n\n---\n\n".join(sections)


class BaseRAGSynthesizer(ABC):
    """Abstract base class for hybrid RAG answer synthesis."""

    @abstractmethod
    async def synthesize(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        evidence_package: Optional[Any] = None,
    ) -> SynthesisResult:
        """Synthesizes a grounded answer from fused vector and graph context."""
        pass

    @abstractmethod
    async def synthesize_stream(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        evidence_package: Optional[Any] = None,
    ) -> AsyncIterator[dict]:
        """Streams grounded answer as token dicts and ends with a single metadata dict."""
        pass


class MockRAGSynthesizer(BaseRAGSynthesizer):
    """
    Deterministic rule-based synthesizer for unit testing and offline development.
    Adheres strictly to Complete Match, Partial Match, and Zero Match rules.
    """

    def _compute_mock_result(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        conversation_history: Optional[List[dict]] = None,
        evidence_package: Optional[Any] = None,
    ) -> SynthesisResult:
        candidates = candidate_concepts or [n.name for n in graph.nodes]
        if evidence_package and hasattr(evidence_package, "candidate_concepts") and evidence_package.candidate_concepts:
            candidates = evidence_package.candidate_concepts

        has_items = bool(evidence_package.items) if evidence_package else bool(chunks)
        has_graph = bool(evidence_package.graph_triples) if evidence_package else bool(graph.edges)

        # Case 3: ZERO MATCH OR LOW CONFIDENCE
        if not has_items and not has_graph:
            base_answer = f"I could not find records directly answering '{query}' in your organization's indexed knowledge base."
            if candidates:
                top_candidates = candidates[:3]
                candidate_str = ", ".join(top_candidates)
                answer = (
                    f"{base_answer} However, I found related entities in your knowledge graph: {candidate_str}. "
                    f"Would you like to inspect one of these?"
                )
                suggestions = [f"Inspect {c}" for c in top_candidates]
            else:
                answer = base_answer
                suggestions = []

            return SynthesisResult(
                answer=answer,
                follow_up_suggestions=suggestions,
                needs_clarification=True,
                match_type="zero_match",
            )

        # Build chunk snippets with valid [EV_#] citations
        chunk_snippets = []
        if evidence_package and evidence_package.items:
            for itm in evidence_package.items[:3]:
                snippet = itm.content[:160].strip().replace("\n", " ")
                chunk_snippets.append(f"From \"{itm.document_title}\": {snippet} [{itm.evidence_id}]")
        elif chunks:
            for i, chk in enumerate(chunks[:3], 1):
                snippet = chk.content[:160].strip().replace("\n", " ")
                chunk_snippets.append(f"From \"{chk.source_name}\": {snippet} [EV_{i}]")

        # Build edge strings
        if evidence_package and evidence_package.graph_triples:
            edge_strs = evidence_package.graph_triples[:6]
        else:
            edge_strs = [f"{e.source} {e.type.lower().replace('_', ' ')} {e.target}" for e in graph.edges[:6]]

        # Case 1: COMPLETE MATCH (both chunks and graph edges present)
        if has_items and has_graph:
            parts = []
            if edge_strs:
                parts.append(f"According to the knowledge graph, {', and '.join(edge_strs)}.")
            if chunk_snippets:
                parts.append(" ".join(chunk_snippets))
            if conversation_history:
                parts.append(f"(Follow-up to previous {len(conversation_history)} messages)")

            answer = " ".join(parts)
            target_suggestion = edge_strs[0] if edge_strs else "operational architecture"
            suggestions = [
                f"Explore deeper dependencies for {target_suggestion}",
                f"Review operational architecture documentation",
            ]
            return SynthesisResult(
                answer=answer,
                follow_up_suggestions=suggestions,
                needs_clarification=False,
                match_type="complete",
            )

        # Case 2: PARTIAL MATCH (chunks without edges or edges without chunks)
        if has_items:
            answer = f"Based on your organization's documentation: {' '.join(chunk_snippets)}."
            suggestions = [
                "Inspect related documentation",
                "Explore related operational topics",
            ]
        else:
            answer = f"Based on your organization's knowledge graph: {', and '.join(edge_strs)}."
            suggestions = [
                "Explore connected graph entities",
                "Upload related documentation",
            ]

        return SynthesisResult(
            answer=answer,
            follow_up_suggestions=suggestions,
            needs_clarification=False,
            match_type="partial",
        )

    async def synthesize(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        evidence_package: Optional[Any] = None,
    ) -> SynthesisResult:
        return self._compute_mock_result(
            query=query,
            chunks=chunks,
            graph=graph,
            candidate_concepts=candidate_concepts,
            conversation_history=conversation_history,
            evidence_package=evidence_package,
        )

    async def synthesize_stream(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        evidence_package: Optional[Any] = None,
    ) -> AsyncIterator[dict]:
        res = self._compute_mock_result(
            query=query,
            chunks=chunks,
            graph=graph,
            candidate_concepts=candidate_concepts,
            conversation_history=conversation_history,
            evidence_package=evidence_package,
        )
        words = res.answer.split(" ")
        chunk_size = 4
        for i in range(0, len(words), chunk_size):
            chunk_slice = words[i:i + chunk_size]
            chunk_text = " ".join(chunk_slice)
            if i + chunk_size < len(words):
                chunk_text += " "
            yield {"type": "token", "text": chunk_text}
            await asyncio.sleep(0.02)

        yield {
            "type": "metadata",
            "follow_up_suggestions": res.follow_up_suggestions,
            "needs_clarification": res.needs_clarification,
            "match_type": res.match_type,
        }


class GeminiRAGSynthesizer(BaseRAGSynthesizer):
    """
    Production synthesizer using Google Gemini with grounded prompt engineering
    and structured JSON output conforming to SynthesisResult.
    """

    _quota_cooldown_until: float = 0.0

    def __init__(self, api_key: str, model: str = "gemini-flash-lite-latest"):
        from google import genai

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.mock_fallback = MockRAGSynthesizer()

    async def synthesize(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> SynthesisResult:
        now = time.time()
        if now < GeminiRAGSynthesizer._quota_cooldown_until:
            logger.debug("Gemini RAG synthesis in quota cooldown window. Fast falling back to mock synthesizer.")
            return await self.mock_fallback.synthesize(
                query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt
            )

        context_str = build_fusion_context(chunks, graph, candidate_concepts)

        tone_directive = f"\nAdopt the requested Persona at all times: {persona_tone}." if persona_tone else ""
        custom_directive = f"\nTenant Custom Guidance: {custom_system_prompt}" if custom_system_prompt else ""

        history_section = ""
        if conversation_history:
            recent_turns = conversation_history[-6:]
            formatted_turns = "\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in recent_turns])
            history_section = f"\n\nRECENT CONVERSATION HISTORY:\n{formatted_turns}\n"

        prompt = f"""
{GROUNDED_SYNTHESIS_SYSTEM_INSTRUCTION}
{tone_directive}{custom_directive}

CONTEXT INFORMATION:
{context_str}
{history_section}
USER QUESTION:
{query}

JSON RESPONSE:
"""

        for attempt in range(2):
            try:
                synth_cfg = {
                    "response_mime_type": "application/json",
                    "response_schema": SynthesisResult,
                    "temperature": temperature,
                }
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
                        config=synth_cfg,
                    )
                else:
                    # Fallback path if native async client is unavailable or sync method is mocked in tests
                    gen_coro = asyncio.to_thread(
                        self.client.models.generate_content,
                        model=self.model,
                        contents=prompt,
                        config=synth_cfg,
                    )
                # Cap latency to 12.0s max: fail-fast to deterministic grounded synthesis on API stalls
                response = await asyncio.wait_for(gen_coro, timeout=12.0)
                raw_json = response.text.strip()
                if raw_json.startswith("```json"):
                    raw_json = raw_json[7:]
                if raw_json.endswith("```"):
                    raw_json = raw_json[:-3]
                data = json.loads(raw_json.strip())
                resolved_answer = data.get("answer") or data.get("response") or data.get("content") or ""
                return SynthesisResult(
                    answer=resolved_answer,
                    follow_up_suggestions=data.get("follow_up_suggestions", []),
                    needs_clarification=data.get("needs_clarification", False),
                    match_type=data.get("match_type", "complete"),
                )
            except Exception as e:
                err_str = str(e)
                if ("503" in err_str or "UNAVAILABLE" in err_str) and attempt == 0:
                    logger.info("Gemini RAG synthesis encountered 503/UNAVAILABLE; retrying in 0.8s...")
                    await asyncio.sleep(0.8)
                    continue
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    GeminiRAGSynthesizer._quota_cooldown_until = time.time() + 60.0
                    logger.warning(
                        f"Gemini RAG synthesis hit quota limit (429 RESOURCE_EXHAUSTED) for model '{self.model}'. "
                        "Enabling 60s cooldown and falling back to mock synthesizer."
                    )
                else:
                    logger.warning(f"Gemini RAG synthesis failed: {e}. Fast falling back to mock synthesizer.")
                return await self.mock_fallback.synthesize(
                    query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt
                )

    async def synthesize_stream(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> AsyncIterator[dict]:
        now = time.time()
        if now < GeminiRAGSynthesizer._quota_cooldown_until:
            logger.debug("Gemini RAG synthesis in quota cooldown window. Falling back to mock synthesizer stream.")
            async for event in self.mock_fallback.synthesize_stream(
                query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt
            ):
                yield event
            return

        context_str = build_fusion_context(chunks, graph, candidate_concepts)
        tone_directive = f"\nAdopt the requested Persona at all times: {persona_tone}." if persona_tone else ""
        custom_directive = f"\nTenant Custom Guidance: {custom_system_prompt}" if custom_system_prompt else ""

        history_section = ""
        if conversation_history:
            recent_turns = conversation_history[-6:]
            formatted_turns = "\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in recent_turns])
            history_section = f"\n\nRECENT CONVERSATION HISTORY:\n{formatted_turns}\n"

        prompt = f"""
{STREAMING_SYNTHESIS_SYSTEM_INSTRUCTION}
{tone_directive}{custom_directive}

CONTEXT INFORMATION:
{context_str}
{history_section}
USER QUESTION:
{query}

ANSWER:
"""

        stream_failed = False
        full_text_parts = []

        for attempt in range(2):
            try:
                full_text_parts = []
                if hasattr(self.client, "aio") and hasattr(self.client.aio, "models"):
                    response_stream = await self.client.aio.models.generate_content_stream(
                        model=self.model,
                        contents=prompt,
                        config={
                            "temperature": temperature,
                        }
                    )
                    async for chunk in response_stream:
                        chunk_text = getattr(chunk, "text", "") or ""
                        if chunk_text:
                            full_text_parts.append(chunk_text)
                            yield {"type": "token", "text": chunk_text}
                            await asyncio.sleep(0)
                else:
                    response_stream = self.client.models.generate_content_stream(
                        model=self.model,
                        contents=prompt,
                        config={
                            "temperature": temperature,
                        }
                    )
                    for chunk in response_stream:
                        chunk_text = getattr(chunk, "text", "") or ""
                        if chunk_text:
                            full_text_parts.append(chunk_text)
                            yield {"type": "token", "text": chunk_text}
                            await asyncio.sleep(0)
                break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    GeminiRAGSynthesizer._quota_cooldown_until = time.time() + 60.0
                    logger.warning(
                        f"Gemini RAG stream hit quota limit (429 RESOURCE_EXHAUSTED) for model '{self.model}'. "
                        "Enabling 60s cooldown and falling back to mock synthesizer stream."
                    )
                else:
                    logger.warning(f"Gemini RAG stream failed: {e}. Falling back to mock synthesizer stream.")
                stream_failed = True
                break

        if stream_failed or not full_text_parts:
            async for event in self.mock_fallback.synthesize_stream(
                query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt
            ):
                yield event
            return

        # Fast deterministic evaluation for stream metadata (0ms latency, eliminates redundant LLM round-trip)
        is_zero = not chunks and not graph.edges
        default_suggestions = [f"Learn more about {c}" for c in (candidate_concepts or [])[:3]]
        if not default_suggestions:
            default_suggestions = ["What are the core capabilities?", "Where is the company located?", "What documents are required?"]
        yield {
            "type": "metadata",
            "follow_up_suggestions": default_suggestions,
            "needs_clarification": is_zero,
            "match_type": "zero_match" if is_zero else ("complete" if (chunks and graph.edges) else "partial"),
        }



class OpenAIRAGSynthesizer(BaseRAGSynthesizer):
    """
    Production synthesizer using OpenAI (e.g. gpt-4o-mini) with grounded prompt engineering
    and structured JSON output conforming to SynthesisResult, as well as native SSE token streaming.
    """

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key, timeout=12.0)
        self.model = model
        self.mock_fallback = MockRAGSynthesizer()

    async def synthesize(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        evidence_package: Optional[Any] = None,
    ) -> SynthesisResult:
        if evidence_package:
            context_str = EvidenceBuilder.format_evidence_prompt_context(evidence_package)
        else:
            context_str = build_fusion_context(chunks, graph, candidate_concepts)

        history_section = ""
        if conversation_history:
            recent_turns = conversation_history[-6:]
            formatted_turns = "\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in recent_turns])
            history_section = f"\n\nRECENT CONVERSATION HISTORY:\n{formatted_turns}\n"

        system_instruction = custom_system_prompt if custom_system_prompt else GROUNDED_SYNTHESIS_SYSTEM_INSTRUCTION
        if persona_tone and not custom_system_prompt:
            system_instruction += f"\nAdopt the requested Persona at all times: {persona_tone}."

        prompt = f"""
CONTEXT INFORMATION:
{context_str}
{history_section}
USER QUESTION:
{query}

Format the output strictly as a JSON object with this structure:
{{
  "answer": "Comprehensive answer text in markdown format citing documents using bracketed evidence IDs like [EV_1]",
  "follow_up_suggestions": ["2 to 3 suggested questions or adjacent topics"],
  "needs_clarification": false,
  "match_type": "complete"
}}

JSON RESPONSE:
"""
        try:
            res = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                temperature=temperature,
            )
            raw_json = res.choices[0].message.content or "{}"
            data = json.loads(raw_json.strip())
            resolved_answer = data.get("answer") or data.get("response") or data.get("content") or ""
            return SynthesisResult(
                answer=resolved_answer,
                follow_up_suggestions=data.get("follow_up_suggestions", []),
                needs_clarification=data.get("needs_clarification", False),
                match_type=data.get("match_type", "complete"),
            )
        except Exception as e:
            logger.warning(f"OpenAI RAG synthesis failed: {e}. Fast falling back to mock synthesizer.")
            return await self.mock_fallback.synthesize(
                query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt, evidence_package
            )

    async def synthesize_stream(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        candidate_concepts: Optional[List[str]] = None,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        evidence_package: Optional[Any] = None,
    ) -> AsyncIterator[dict]:
        if evidence_package:
            context_str = EvidenceBuilder.format_evidence_prompt_context(evidence_package)
        else:
            context_str = build_fusion_context(chunks, graph, candidate_concepts)

        history_section = ""
        if conversation_history:
            recent_turns = conversation_history[-6:]
            formatted_turns = "\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in recent_turns])
            history_section = f"\n\nRECENT CONVERSATION HISTORY:\n{formatted_turns}\n"

        system_instruction = custom_system_prompt if custom_system_prompt else STREAMING_SYNTHESIS_SYSTEM_INSTRUCTION
        if persona_tone and not custom_system_prompt:
            system_instruction += f"\nAdopt the requested Persona at all times: {persona_tone}."

        prompt = f"""
CONTEXT INFORMATION:
{context_str}
{history_section}
USER QUESTION:
{query}

ANSWER:
"""
        stream_failed = False
        full_text_parts = []
        try:
            response_stream = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt},
                ],
                temperature=temperature,
                stream=True,
            )
            async for chunk in response_stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_text_parts.append(content)
                    yield {"type": "token", "text": content}
                    await asyncio.sleep(0)
        except Exception as e:
            logger.warning(f"OpenAI RAG stream failed: {e}. Falling back to mock synthesizer stream.")
            stream_failed = True

        if stream_failed or not full_text_parts:
            async for event in self.mock_fallback.synthesize_stream(
                query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt, evidence_package
            ):
                yield event
            return

        is_zero = not chunks and not graph.edges
        default_suggestions = [f"Learn more about {c}" for c in (candidate_concepts or [])[:3]]
        if not default_suggestions:
            default_suggestions = ["What are the core capabilities?", "Where is the company located?", "What documents are required?"]
        yield {
            "type": "metadata",
            "follow_up_suggestions": default_suggestions,
            "needs_clarification": is_zero,
            "match_type": "zero_match" if is_zero else ("complete" if (chunks and graph.edges) else "partial"),
        }


def get_rag_synthesizer(api_key: Optional[str] = None) -> BaseRAGSynthesizer:
    """Factory returning OpenAIRAGSynthesizer or GeminiRAGSynthesizer based on config, else MockRAGSynthesizer."""
    # 1. Explicit OpenAI key
    if api_key and api_key.strip() and api_key.strip().startswith("sk-"):
        try:
            return OpenAIRAGSynthesizer(
                api_key=api_key.strip(),
                model=settings.LLM_MODEL if "gpt" in settings.LLM_MODEL else "gpt-4o-mini"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIRAGSynthesizer ({e}). Checking Gemini...")

    # 2. Explicit Gemini key
    if api_key and api_key.strip() and not api_key.strip().startswith("sk-"):
        try:
            return GeminiRAGSynthesizer(
                api_key=api_key.strip(),
                model="models/gemini-3.6-flash"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiRAGSynthesizer ({e}). Using MockRAGSynthesizer.")
            return MockRAGSynthesizer()

    # 3. System OpenAI key fallback
    if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY.strip():
        try:
            return OpenAIRAGSynthesizer(
                api_key=settings.OPENAI_API_KEY.strip(),
                model=settings.LLM_MODEL if "gpt" in settings.LLM_MODEL else "gpt-4o-mini"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIRAGSynthesizer ({e}). Checking Gemini...")

    # 4. System Gemini key fallback
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiRAGSynthesizer(
                api_key=settings.GEMINI_API_KEY.strip(),
                model="models/gemini-3.6-flash"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiRAGSynthesizer ({e}). Using MockRAGSynthesizer.")
            return MockRAGSynthesizer()

    return MockRAGSynthesizer()


class RAGPipelineService:
    """
    Orchestrates the complete end-to-end Hybrid GraphRAG pipeline:
    1. Query analysis & seed entity extraction.
    2. Parallel dual-track retrieval:
       - pgvector Cosine Distance search for semantic text chunks.
       - Neo4j Cypher multi-hop graph traversal for connected entity triples.
    3. Context fusion & LLM grounded synthesis.
    4. Verifiable citation formatting.
    """

    @classmethod
    async def answer_query(
        cls,
        db: AsyncSession,
        tenant_id: int,
        query: str,
        top_k_chunks: int = 4,
        max_graph_hops: int = 2,
        temperature: float = 0.2,
        source_id: Optional[int] = None,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        gemini_api_key: Optional[str] = None,
        tenant_name: Optional[str] = None,
        openai_api_key: Optional[str] = None,
        ai_profile: Optional[AIProfile] = None,
        persona: Optional[Persona] = None,
    ) -> RAGQueryResponse:
        start_time = time.perf_counter()
        effective_llm_key = openai_api_key or gemini_api_key

        # Resolve active AIProfile & Persona if not explicitly provided
        profile = ai_profile
        active_persona = persona
        if not profile and db:
            try:
                profile, active_persona = await AIProfileService.get_or_create_default_profile(
                    db=db, tenant_id=tenant_id, tenant_name=tenant_name or "Organization"
                )
            except Exception as prof_err:
                logger.debug(f"AIProfile resolution notice: {prof_err}")

        # Derive effective retrieval parameters from AIProfile
        if profile and profile.retrieval_policy:
            rp = profile.retrieval_policy
            if top_k_chunks == 4 and "topK" in rp:
                top_k_chunks = rp["topK"]
            if max_graph_hops == 2 and "maxGraphDepth" in rp:
                max_graph_hops = rp["maxGraphDepth"]

        # Deterministically compile system instructions via PromptCompiler
        if profile:
            compiled_system_prompt = PromptCompiler.compile_system_prompt(
                profile=profile,
                persona=active_persona,
                runtime_context={"tenant_name": tenant_name}
            )
            if custom_system_prompt:
                compiled_system_prompt = f"{compiled_system_prompt}\n\nAdditional Guidance:\n{custom_system_prompt}"
        else:
            compiled_system_prompt = custom_system_prompt

        # Step 0: Conversational Routing & Intent Classification
        router = get_conversational_router(api_key=effective_llm_key)
        route_res = await router.route(
            query=query,
            conversation_history=conversation_history,
            tenant_name=tenant_name,
            custom_system_prompt=compiled_system_prompt,
        )
        t_route_ms = round((time.perf_counter() - start_time) * 1000, 2)

        # Safety net: Questions or informational requests must NEVER be swallowed as direct_response
        inquiry_markers = [
            "?", "qui", "quoi", "comment", "où", "ou", "quel", "quels", "quelle", "quelles",
            "combien", "pourquoi", "est-ce", "pouvez-vous", "avez-vous",
            "who", "what", "where", "how", "when", "why", "which", "can", "could", "would",
            "contact", "adresse", "service", "phone", "telephone", "téléphone", "tel", "mail", "email",
            "tarif", "prix", "cout", "coût", "délai", "delai", "document", "dédouanement", "dedouanement"
        ]
        lower_query = query.lower().strip()
        has_inquiry = any(marker in lower_query for marker in inquiry_markers)

        # Early exit for direct responses ONLY if it's truly a pure greeting/closing without an inquiry
        if route_res.action == RouterAction.DIRECT_RESPONSE and not has_inquiry:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RAGQueryResponse(
                query=query,
                answer=route_res.direct_or_clarification_message or "Hello! How can I help you today?",
                action=route_res.action.value,
                clarification_options=[],
                standalone_query=None,
                source_citations=[],
                graph_citations=[],
                entities_detected=[],
                execution_time_ms=elapsed_ms,
                evidence_status="sufficient",
                ai_profile_version=profile.version if profile else None,
                persona_name=active_persona.name if active_persona else None,
            )

        # Early exit for ambiguous or underspecified queries requiring clarification
        if route_res.action == RouterAction.CLARIFY:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RAGQueryResponse(
                query=query,
                answer=route_res.direct_or_clarification_message or "Could you please clarify your question?",
                action=route_res.action.value,
                clarification_options=route_res.clarification_options,
                standalone_query=None,
                source_citations=[],
                graph_citations=[],
                entities_detected=[],
                execution_time_ms=elapsed_ms,
                evidence_status="partial",
                ai_profile_version=profile.version if profile else None,
                persona_name=active_persona.name if active_persona else None,
            )

        # Step 1: Query Analysis & Seed Entity Extraction (Action: RETRIEVE)
        effective_query = route_res.standalone_query or query
        detected_entities = list(dict.fromkeys(route_res.seed_entities)) if route_res.seed_entities else []

        graph_store = await get_graph_store()
        graph_response = GraphNeighborhoodResponse()
        candidate_concepts = []

        # Fuzzy-entity fallback: if router detected no entities, search candidate entities via fuzzy match
        if not detected_entities:
            try:
                candidate_ents = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                if candidate_ents:
                    detected_entities = [c.name for c in candidate_ents]
            except Exception as e:
                logger.debug(f"Candidate entity search fallback failed: {e}")

        # Step 2 & 3: Run Vector Search (pgvector) and Graph Traversal (Neo4j) concurrently
        t_retrieve_start = time.perf_counter()
        embedding_service = get_embedding_service(api_key=effective_llm_key)
        query_vector = await embedding_service.embed_query(effective_query)

        graph_coro = (
            graph_store.get_neighborhood(
                tenant_id=tenant_id,
                entity_names=detected_entities,
                max_hops=max_graph_hops,
                limit=25
            )
            if detected_entities
            else _empty_neighborhood()
        )

        chunks, graph_response = await asyncio.gather(
            search_similar_chunks(
                db=db,
                tenant_id=tenant_id,
                query_vector=query_vector,
                top_k=top_k_chunks,
                source_id=source_id
            ),
            graph_coro
        )
        candidate_concepts = [n.name for n in graph_response.nodes if n.name not in detected_entities]

        # Step 3.5: Zero-match retry pass using top candidate entity
        if not chunks and not graph_response.edges:
            try:
                candidates = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                if candidates:
                    top_candidate = candidates[0].name
                    retry_query = f"{effective_query} {top_candidate}"
                    retry_vector = await embedding_service.embed_query(retry_query)
                    retry_chunks, retry_graph = await asyncio.gather(
                        search_similar_chunks(
                            db=db,
                            tenant_id=tenant_id,
                            query_vector=retry_vector,
                            top_k=top_k_chunks,
                            source_id=source_id,
                        ),
                        graph_store.get_neighborhood(
                            tenant_id=tenant_id,
                            entity_names=[top_candidate],
                            max_hops=max_graph_hops,
                            limit=25,
                        )
                    )
                    if retry_chunks or retry_graph.edges:
                        chunks = retry_chunks
                        graph_response = retry_graph
                        if top_candidate not in detected_entities:
                            detected_entities.append(top_candidate)
                        candidate_concepts = [n.name for n in graph_response.nodes if n.name not in detected_entities]
            except Exception as e:
                logger.warning(f"Zero-match candidate retry notice: {e}")

        # In zero-match or low-confidence cases, engage Graph Disambiguation Specialist
        if not chunks and not graph_response.edges:
            try:
                candidates = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                popular_topics = await graph_store.get_popular_topics(
                    tenant_id=tenant_id, limit=5
                )
                if candidates or popular_topics:
                    disambiguator = get_graph_disambiguator(api_key=effective_llm_key)
                    disambig_res = await disambiguator.disambiguate(
                        user_query=effective_query,
                        candidate_entities=candidates,
                        popular_tenant_topics=popular_topics,
                    )
                    candidate_concepts.extend([c for c in disambig_res.suggested_chips if c not in candidate_concepts])
                elif graph_response.nodes:
                    candidate_concepts.extend([n.name for n in graph_response.nodes if n.name not in candidate_concepts])
            except Exception as e:
                logger.warning(f"Disambiguation specialist hook notice: {e}")

        t_retrieve_ms = round((time.perf_counter() - t_retrieve_start) * 1000, 2)

        # Step 3.6: Package into EvidencePackage with Source Authority Reranking
        authority_policy = profile.source_authority_policy if profile else None
        evidence_package = EvidenceBuilder.build_evidence_package(
            chunks=chunks,
            graph=graph_response,
            source_authority_policy=authority_policy,
            candidate_concepts=candidate_concepts
        )

        # Step 4: Grounded LLM Synthesis
        t_synth_start = time.perf_counter()
        synthesizer = get_rag_synthesizer(api_key=effective_llm_key)
        synth_res = await synthesizer.synthesize(
            query=effective_query,
            chunks=chunks,
            graph=graph_response,
            candidate_concepts=candidate_concepts,
            temperature=temperature,
            conversation_history=conversation_history,
            persona_tone=persona_tone or (active_persona.tone if active_persona else None),
            custom_system_prompt=compiled_system_prompt,
            evidence_package=evidence_package,
        )
        t_synth_ms = round((time.perf_counter() - t_synth_start) * 1000, 2)

        # Step 5: Post-generation Response Validation & Citation Verification
        citations_mandatory = profile.citation_policy.get("citationsRequired", True) if profile else True
        evidence_mode = profile.evidence_policy.get("mode", "strict") if profile else "strict"
        validated = ResponseValidator.validate_and_sanitize(
            raw_answer=synth_res.answer,
            evidence_package=evidence_package,
            citations_mandatory=citations_mandatory,
            evidence_mode=evidence_mode,
            tenant_id=tenant_id
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.info(
            f"[RAGPipeline] Timing breakdown - Route: {t_route_ms}ms, "
            f"Retrieve (Vector+Graph): {t_retrieve_ms}ms, "
            f"Synthesize: {t_synth_ms}ms, Total: {elapsed_ms}ms"
        )

        return RAGQueryResponse(
            query=query,
            answer=validated.sanitized_answer,
            action=route_res.action.value,
            clarification_options=[],
            standalone_query=route_res.standalone_query,
            follow_up_suggestions=synth_res.follow_up_suggestions,
            needs_clarification=synth_res.needs_clarification,
            source_citations=validated.verified_source_citations,
            graph_citations=validated.verified_graph_citations,
            entities_detected=detected_entities,
            execution_time_ms=elapsed_ms,
            evidence_status=validated.evidence_status,
            ai_profile_version=profile.version if profile else None,
            persona_name=active_persona.name if active_persona else None,
        )

    @classmethod
    async def answer_query_stream(
        cls,
        db: AsyncSession,
        tenant_id: int,
        query: str,
        top_k_chunks: int = 4,
        max_graph_hops: int = 2,
        temperature: float = 0.2,
        source_id: Optional[int] = None,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
        gemini_api_key: Optional[str] = None,
        tenant_name: Optional[str] = None,
        openai_api_key: Optional[str] = None,
        ai_profile: Optional[AIProfile] = None,
        persona: Optional[Persona] = None,
    ) -> AsyncIterator[dict]:
        start_time = time.perf_counter()
        effective_llm_key = openai_api_key or gemini_api_key

        # Resolve active AIProfile & Persona if not explicitly provided
        profile = ai_profile
        active_persona = persona
        if not profile and db:
            try:
                profile, active_persona = await AIProfileService.get_or_create_default_profile(
                    db=db, tenant_id=tenant_id, tenant_name=tenant_name or "Organization"
                )
            except Exception as prof_err:
                logger.debug(f"AIProfile resolution notice: {prof_err}")

        # Derive effective retrieval parameters from AIProfile
        if profile and profile.retrieval_policy:
            rp = profile.retrieval_policy
            if top_k_chunks == 4 and "topK" in rp:
                top_k_chunks = rp["topK"]
            if max_graph_hops == 2 and "maxGraphDepth" in rp:
                max_graph_hops = rp["maxGraphDepth"]

        # Deterministically compile system instructions via PromptCompiler
        if profile:
            compiled_system_prompt = PromptCompiler.compile_system_prompt(
                profile=profile,
                persona=active_persona,
                runtime_context={"tenant_name": tenant_name}
            )
            if custom_system_prompt:
                compiled_system_prompt = f"{compiled_system_prompt}\n\nAdditional Guidance:\n{custom_system_prompt}"
        else:
            compiled_system_prompt = custom_system_prompt

        # Step 0: Conversational Routing & Intent Classification
        router = get_conversational_router(api_key=effective_llm_key)
        route_res = await router.route(
            query=query,
            conversation_history=conversation_history,
            tenant_name=tenant_name,
            custom_system_prompt=compiled_system_prompt,
        )
        t_route_ms = round((time.perf_counter() - start_time) * 1000, 2)

        # Safety net: Questions or informational requests must NEVER be swallowed as direct_response
        inquiry_markers = [
            "?", "qui", "quoi", "comment", "où", "ou", "quel", "quels", "quelle", "quelles",
            "combien", "pourquoi", "est-ce", "pouvez-vous", "avez-vous",
            "who", "what", "where", "how", "when", "why", "which", "can", "could", "would",
            "contact", "adresse", "service", "phone", "telephone", "téléphone", "tel", "mail", "email",
            "tarif", "prix", "cout", "coût", "délai", "delai", "document", "dédouanement", "dedouanement"
        ]
        lower_query = query.lower().strip()
        has_inquiry = any(marker in lower_query for marker in inquiry_markers)

        # Early exit for direct responses ONLY if it's truly a pure greeting/closing without an inquiry
        if route_res.action == RouterAction.DIRECT_RESPONSE and not has_inquiry:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            direct_msg = route_res.direct_or_clarification_message or "Hello! How can I help you today?"
            yield {"type": "token", "text": direct_msg}
            yield {
                "type": "metadata",
                "action": route_res.action.value,
                "clarification_options": [],
                "standalone_query": None,
                "follow_up_suggestions": [],
                "needs_clarification": False,
                "match_type": "complete",
                "source_citations": [],
                "graph_citations": [],
                "entities_detected": [],
                "execution_time_ms": elapsed_ms,
                "evidence_status": "sufficient",
                "ai_profile_version": profile.version if profile else None,
                "persona_name": active_persona.name if active_persona else None,
            }
            return

        # Early exit for ambiguous or underspecified queries requiring clarification
        if route_res.action == RouterAction.CLARIFY:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            clarify_msg = route_res.direct_or_clarification_message or "Could you please clarify your question?"
            yield {"type": "token", "text": clarify_msg}
            yield {
                "type": "metadata",
                "action": route_res.action.value,
                "clarification_options": route_res.clarification_options,
                "standalone_query": None,
                "follow_up_suggestions": [],
                "needs_clarification": True,
                "match_type": "partial",
                "source_citations": [],
                "graph_citations": [],
                "entities_detected": [],
                "execution_time_ms": elapsed_ms,
                "evidence_status": "partial",
                "ai_profile_version": profile.version if profile else None,
                "persona_name": active_persona.name if active_persona else None,
            }
            return

        # Step 1: Query Analysis & Seed Entity Extraction (Action: RETRIEVE)
        effective_query = route_res.standalone_query or query
        detected_entities = list(dict.fromkeys(route_res.seed_entities)) if route_res.seed_entities else []

        graph_store = await get_graph_store()
        graph_response = GraphNeighborhoodResponse()
        candidate_concepts = []

        # Fuzzy-entity fallback: if router detected no entities, search candidate entities via fuzzy match
        if not detected_entities:
            try:
                candidate_ents = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                if candidate_ents:
                    detected_entities = [c.name for c in candidate_ents]
            except Exception as e:
                logger.debug(f"Candidate entity search fallback failed: {e}")

        # Step 2 & 3: Run Vector Search (pgvector) and Graph Traversal (Neo4j) concurrently
        t_retrieve_start = time.perf_counter()
        embedding_service = get_embedding_service(api_key=effective_llm_key)
        query_vector = await embedding_service.embed_query(effective_query)

        graph_coro = (
            graph_store.get_neighborhood(
                tenant_id=tenant_id,
                entity_names=detected_entities,
                max_hops=max_graph_hops,
                limit=25
            )
            if detected_entities
            else _empty_neighborhood()
        )

        chunks, graph_response = await asyncio.gather(
            search_similar_chunks(
                db=db,
                tenant_id=tenant_id,
                query_vector=query_vector,
                top_k=top_k_chunks,
                source_id=source_id
            ),
            graph_coro
        )
        candidate_concepts = [n.name for n in graph_response.nodes if n.name not in detected_entities]

        # Step 3.5: Zero-match retry pass using top candidate entity
        if not chunks and not graph_response.edges:
            try:
                candidates = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                if candidates:
                    top_candidate = candidates[0].name
                    retry_query = f"{effective_query} {top_candidate}"
                    retry_vector = await embedding_service.embed_query(retry_query)
                    retry_chunks, retry_graph = await asyncio.gather(
                        search_similar_chunks(
                            db=db,
                            tenant_id=tenant_id,
                            query_vector=retry_vector,
                            top_k=top_k_chunks,
                            source_id=source_id,
                        ),
                        graph_store.get_neighborhood(
                            tenant_id=tenant_id,
                            entity_names=[top_candidate],
                            max_hops=max_graph_hops,
                            limit=25,
                        )
                    )
                    if retry_chunks or retry_graph.edges:
                        chunks = retry_chunks
                        graph_response = retry_graph
                        if top_candidate not in detected_entities:
                            detected_entities.append(top_candidate)
                        candidate_concepts = [n.name for n in graph_response.nodes if n.name not in detected_entities]
            except Exception as e:
                logger.warning(f"Zero-match candidate retry notice: {e}")

        t_retrieve_ms = round((time.perf_counter() - t_retrieve_start) * 1000, 2)
        logger.info(
            f"[RAGPipelineStream] Timing breakdown - Route: {t_route_ms}ms, "
            f"Retrieve (Vector+Graph): {t_retrieve_ms}ms"
        )

        if not chunks and not graph_response.edges:
            try:
                candidates = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                popular_topics = await graph_store.get_popular_topics(
                    tenant_id=tenant_id, limit=5
                )
                if candidates or popular_topics:
                    disambiguator = get_graph_disambiguator(api_key=effective_llm_key)
                    disambig_res = await disambiguator.disambiguate(
                        user_query=effective_query,
                        candidate_entities=candidates,
                        popular_tenant_topics=popular_topics,
                    )
                    candidate_concepts.extend([c for c in disambig_res.suggested_chips if c not in candidate_concepts])
                elif graph_response.nodes:
                    candidate_concepts.extend([n.name for n in graph_response.nodes if n.name not in candidate_concepts])
            except Exception as e:
                logger.warning(f"Disambiguation specialist hook notice: {e}")

        # Step 3.6: Package into EvidencePackage with Source Authority Reranking
        authority_policy = profile.source_authority_policy if profile else None
        evidence_package = EvidenceBuilder.build_evidence_package(
            chunks=chunks,
            graph=graph_response,
            source_authority_policy=authority_policy,
            candidate_concepts=candidate_concepts
        )

        # Step 4: Stream from synthesizer
        synthesizer = get_rag_synthesizer(api_key=effective_llm_key)
        full_streamed_tokens = []
        async for event in synthesizer.synthesize_stream(
            query=effective_query,
            chunks=chunks,
            graph=graph_response,
            candidate_concepts=candidate_concepts,
            temperature=temperature,
            conversation_history=conversation_history,
            persona_tone=persona_tone or (active_persona.tone if active_persona else None),
            custom_system_prompt=compiled_system_prompt,
            evidence_package=evidence_package,
        ):
            if event["type"] == "token":
                full_streamed_tokens.append(event["text"])
                yield event
            elif event["type"] == "metadata":
                elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                raw_full = "".join(full_streamed_tokens)
                citations_mandatory = profile.citation_policy.get("citationsRequired", True) if profile else True
                evidence_mode = profile.evidence_policy.get("mode", "strict") if profile else "strict"
                validated = ResponseValidator.validate_and_sanitize(
                    raw_answer=raw_full,
                    evidence_package=evidence_package,
                    citations_mandatory=citations_mandatory,
                    evidence_mode=evidence_mode,
                    tenant_id=tenant_id
                )
                yield {
                    "type": "metadata",
                    "action": route_res.action.value,
                    "clarification_options": [],
                    "standalone_query": route_res.standalone_query,
                    "follow_up_suggestions": event.get("follow_up_suggestions", []),
                    "needs_clarification": event.get("needs_clarification", False),
                    "match_type": event.get("match_type", "complete"),
                    "source_citations": [s.model_dump() for s in validated.verified_source_citations],
                    "graph_citations": [g.model_dump() for g in validated.verified_graph_citations],
                    "entities_detected": detected_entities,
                    "execution_time_ms": elapsed_ms,
                    "evidence_status": validated.evidence_status,
                    "ai_profile_version": profile.version if profile else None,
                    "persona_name": active_persona.name if active_persona else None,
                }

