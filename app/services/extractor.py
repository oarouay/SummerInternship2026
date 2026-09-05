import logging
import re
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

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        from google import genai
        from google.genai import types

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.types = types

    async def extract_graph(self, text: str) -> GraphExtractionResult:
        if not text.strip():
            return GraphExtractionResult()

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
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=self.types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GraphExtractionResult,
                    temperature=0.1
                )
            )
            return GraphExtractionResult.model_validate_json(response.text)
        except Exception as e:
            logger.exception(f"Gemini graph extraction failed: {e}. Falling back to rule-based extractor.")
            return await MockGraphExtractor().extract_graph(text)


def get_graph_extractor() -> BaseGraphExtractor:
    """
    Factory that returns GeminiGraphExtractor if GEMINI_API_KEY is configured,
    otherwise returns MockGraphExtractor.
    """
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiGraphExtractor(
                api_key=settings.GEMINI_API_KEY,
                model=settings.LLM_MODEL
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiGraphExtractor ({e}). Falling back to MockGraphExtractor.")
            return MockGraphExtractor()

    return MockGraphExtractor()
