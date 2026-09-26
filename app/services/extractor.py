import asyncio
import logging
import re
import time
from abc import ABC, abstractmethod
from typing import Optional

from app.core.config import settings
from app.schemas.graph import Entity, GraphExtractionResult, Relationship

logger = logging.getLogger(__name__)


class BaseGraphExtractor(ABC):
    """Abstract base class for extracting knowledge graph entities and relationships."""

    @abstractmethod
    async def extract_graph(self, text: str) -> GraphExtractionResult:
        """Extracts structured entities and relationships from text."""
        pass


class MockGraphExtractor(BaseGraphExtractor):
    """
    Deterministic rule-based extractor for unit tests and local offline development.
    Uses regex patterns to identify capitalized entities and connects adjacent pairs.
    """

    # Common words to ignore when scanning for proper noun entities
    STOPWORDS = {"The", "A", "An", "This", "That", "These", "Those", "All", "Each", "Every", "In", "On", "At", "For", "With"}

    async def extract_graph(self, text: str) -> GraphExtractionResult:
        entities = []
        relationships = []

        # Find capitalized words/phrases (potential entities)
        matches = re.findall(r"\b[A-Z][a-zA-Z0-9_-]+(?:\s+[A-Z][a-zA-Z0-9_-]+)*\b", text)
        cleaned_matches = [m.strip() for m in matches if m.strip() not in self.STOPWORDS and len(m.strip()) > 1]
        unique_names = list(dict.fromkeys(cleaned_matches))

        # Assign entity types heuristically
        for name in unique_names:
            ent_type = "CONCEPT"
            if any(k in name.lower() for k in ["corp", "company", "inc", "ltd"]):
                ent_type = "ORGANIZATION"
            elif any(k in name.lower() for k in ["project", "initiative", "plan"]):
                ent_type = "PROJECT"
            elif any(k in name.lower() for k in ["api", "db", "sql", "postgres", "fastapi", "neo4j", "python"]):
                ent_type = "TECHNOLOGY"
            elif name in ["Alice", "Bob", "Charlie", "David", "Eve"]:
                ent_type = "PERSON"

            entities.append(Entity(
                name=name,
                type=ent_type,
                description=f"Entity extracted from text: {name}"
            ))

        # Create sequential or relational links between detected entities
        if len(entities) >= 2:
            for i in range(len(entities) - 1):
                src = entities[i].name
                tgt = entities[i + 1].name
                rel_type = "CONNECTS_TO"
                if entities[i].type == "PERSON" and entities[i + 1].type == "PROJECT":
                    rel_type = "MANAGES"
                elif entities[i].type == "PROJECT" and entities[i + 1].type == "TECHNOLOGY":
                    rel_type = "DEPENDS_ON"
                elif entities[i].type == "TECHNOLOGY" and entities[i + 1].type == "TECHNOLOGY":
                    rel_type = "INTEGRATES_WITH"

                relationships.append(Relationship(
                    source=src,
                    target=tgt,
                    relation_type=rel_type,
                    description=f"{src} {rel_type.lower().replace('_', ' ')} {tgt}"
                ))

        return GraphExtractionResult(entities=entities, relationships=relationships)


class GeminiGraphExtractor(BaseGraphExtractor):
    """
    Google Gemini Knowledge Graph Extractor using structured JSON schema.
    """
    _quota_cooldown_until: float = 0.0

    def __init__(self, api_key: str, model: str = "gemini-flash-lite-latest"):
        from google import genai
        from google.genai import types

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.types = types

    async def extract_graph(self, text: str) -> GraphExtractionResult:
        if not text.strip():
            return GraphExtractionResult()

        now = time.time()
        if now < GeminiGraphExtractor._quota_cooldown_until:
            logger.debug("Gemini graph extraction within quota cooldown window. Fast falling back to rule-based extractor.")
            return await MockGraphExtractor().extract_graph(text)

        prompt = f"""
        You are an expert Knowledge Graph construction AI.
        Analyze the following text and extract all meaningful entities and the directed relationships connecting them.

        Guidelines:
        1. Entity names MUST be canonical and clean (e.g. 'FastAPI' instead of 'the FastAPI framework').
        2. Assign an appropriate uppercase type to each entity: PERSON, ORGANIZATION, PROJECT, TECHNOLOGY, LOCATION, CONCEPT.
        3. Relationship types MUST be concise uppercase verbs (e.g. 'MANAGES', 'DEPENDS_ON', 'USES', 'CREATED_BY', 'PART_OF').
        4. Provide clear, factual descriptions for both entities and relationships based only on the provided text.

        Text passage:
        \"\"\"{text}\"\"\"
        """

        try:
            req_config = self.types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GraphExtractionResult,
                temperature=0.1
            )
            if hasattr(self.client, "aio") and hasattr(self.client.aio, "models"):
                # Native async client avoids blocking the event loop
                gen_coro = self.client.aio.models.generate_content(
                    model=self.model,
                    contents=prompt,
                    config=req_config,
                )
            else:
                # Fallback path if native async client is unavailable
                gen_coro = asyncio.to_thread(
                    self.client.models.generate_content,
                    model=self.model,
                    contents=prompt,
                    config=req_config,
                )
            # Cap latency to 10.0s max: fail-fast to deterministic extractor on API stalls
            response = await asyncio.wait_for(gen_coro, timeout=10.0)
            return GraphExtractionResult.model_validate_json(response.text)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                GeminiGraphExtractor._quota_cooldown_until = time.time() + 60.0
                logger.warning(
                    f"Gemini graph extraction hit quota limit (429 RESOURCE_EXHAUSTED) for model '{self.model}'. "
                    "Enabling 60s cooldown and falling back to rule-based extractor."
                )
            else:
                logger.warning(f"Gemini graph extraction failed: {e}. Falling back to rule-based extractor.")
            return await MockGraphExtractor().extract_graph(text)


class OpenAIGraphExtractor(BaseGraphExtractor):
    """
    OpenAI Knowledge Graph Extractor using structured JSON output.
    """

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key, timeout=10.0)
        self.model = model

    async def extract_graph(self, text: str) -> GraphExtractionResult:
        if not text.strip():
            return GraphExtractionResult()

        prompt = f"""You are an expert Knowledge Graph construction AI.
Analyze the following text and extract all meaningful entities and the directed relationships connecting them.

Guidelines:
1. Entity names MUST be canonical and clean (e.g. 'FastAPI' instead of 'the FastAPI framework').
2. Assign an appropriate uppercase type to each entity: PERSON, ORGANIZATION, PROJECT, TECHNOLOGY, LOCATION, CONCEPT.
3. Relationship types MUST be concise uppercase verbs (e.g. 'MANAGES', 'DEPENDS_ON', 'USES', 'CREATED_BY', 'PART_OF').
4. Provide clear, factual descriptions for both entities and relationships based only on the provided text.

Format the response strictly as a JSON object matching this schema:
{{
  "entities": [
    {{"name": "string", "type": "string", "description": "string"}}
  ],
  "relationships": [
    {{"source": "string", "target": "string", "relation_type": "string", "description": "string"}}
  ]
}}

Text passage:
\"\"\"{text}\"\"\""""

        try:
            res = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a specialized knowledge graph extraction assistant. Output only valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
            )
            raw_content = res.choices[0].message.content or "{}"
            return GraphExtractionResult.model_validate_json(raw_content)
        except Exception as e:
            logger.warning(f"OpenAI graph extraction failed: {e}. Falling back to rule-based extractor.")
            return await MockGraphExtractor().extract_graph(text)


def get_graph_extractor(api_key: Optional[str] = None) -> BaseGraphExtractor:
    """
    Factory that returns OpenAIGraphExtractor if an OpenAI key is configured,
    or GeminiGraphExtractor if a Gemini key is configured,
    otherwise falls back to MockGraphExtractor.
    """
    # 1. Explicit OpenAI key
    if api_key and api_key.strip() and api_key.strip().startswith("sk-"):
        try:
            return OpenAIGraphExtractor(
                api_key=api_key.strip(),
                model=settings.LLM_MODEL if "gpt" in settings.LLM_MODEL else "gpt-4o-mini"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIGraphExtractor ({e}). Checking Gemini...")

    # 2. Explicit Gemini key
    if api_key and api_key.strip() and not api_key.strip().startswith("sk-"):
        try:
            return GeminiGraphExtractor(
                api_key=api_key.strip(),
                model="models/gemini-3.6-flash"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiGraphExtractor ({e}). Falling back to MockGraphExtractor.")
            return MockGraphExtractor()

    # 3. System OpenAI key fallback
    if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY.strip():
        try:
            return OpenAIGraphExtractor(
                api_key=settings.OPENAI_API_KEY.strip(),
                model=settings.LLM_MODEL if "gpt" in settings.LLM_MODEL else "gpt-4o-mini"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIGraphExtractor ({e}). Checking Gemini...")

    # 4. System Gemini key fallback
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiGraphExtractor(
                api_key=settings.GEMINI_API_KEY.strip(),
                model="models/gemini-3.6-flash"
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiGraphExtractor ({e}). Falling back to MockGraphExtractor.")
            return MockGraphExtractor()

    return MockGraphExtractor()
