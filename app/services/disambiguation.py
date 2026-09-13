import json
import logging
from abc import ABC, abstractmethod
from typing import List, Optional

from app.core.config import settings
from app.schemas.disambiguation import (
    CandidateEntity,
    DisambiguationResult,
    DisambiguationType,
)

logger = logging.getLogger(__name__)

STOPWORDS = {
    "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "is", "are", "was", "were", "what", "where", "how", "who", "which", "why",
    "tell", "me", "about", "show", "does", "do", "can", "you", "i", "we"
}


class BaseGraphDisambiguator(ABC):
    """Abstract interface for Graph Disambiguation Specialist."""

    @abstractmethod
    async def disambiguate(
        self,
        user_query: str,
        candidate_entities: List[CandidateEntity],
        popular_tenant_topics: Optional[List[str]] = None,
    ) -> DisambiguationResult:
        """Analyze candidate nodes, resolve ambiguity, and generate structured disambiguation response."""
        pass


class MockGraphDisambiguator(BaseGraphDisambiguator):
    """
    Deterministic rule-based Disambiguation Specialist for hermetic unit testing
    and zero-network environments.
    """

    async def disambiguate(
        self,
        user_query: str,
        candidate_entities: List[CandidateEntity],
        popular_tenant_topics: Optional[List[str]] = None,
    ) -> DisambiguationResult:
        popular_topics = popular_tenant_topics or []
        query_lower = user_query.lower().strip()
        query_tokens = [w for w in query_lower.split() if w not in STOPWORDS and len(w) > 1]

        # 1. CANDIDATE RELEVANCE SCORING & NOISE FILTERING
        scored_candidates = []
        for cand in candidate_entities:
            cand_name_lower = cand.name.lower().strip()
            cand_desc_lower = (cand.description or "").lower()
            cand_tokens = [w for w in cand_name_lower.split() if w not in STOPWORDS]

            score = 0.0
            # Direct or substring match
            if query_lower in cand_name_lower or cand_name_lower in query_lower:
                score += 2.0

            # Token overlap
            token_overlap = [t for t in query_tokens if t in cand_tokens or any(t in ct for ct in cand_tokens)]
            if token_overlap:
                score += len(token_overlap) * 1.5

            # Description keyword match
            if any(t in cand_desc_lower for t in query_tokens):
                score += 0.5

            # 1-hop connected neighbors match
            cand_neighbors_lower = [n.lower() for n in cand.neighbors]
            for n_low in cand_neighbors_lower:
                n_tokens = [w for w in n_low.split() if w not in STOPWORDS]
                n_overlap = [t for t in query_tokens if t in n_tokens or any(t in nt for nt in n_tokens)]
                if n_overlap:
                    score += len(n_overlap) * 1.2

            # Filter noisy entities with 0 semantic overlap
            if score >= 1.0 or (not query_tokens and score > 0):
                scored_candidates.append((score, cand))

        scored_candidates.sort(key=lambda x: x[0], reverse=True)
        relevant_candidates = [c for _, c in scored_candidates]

        # 2. DISAMBIGUATION STRATEGY
        # Strategy A: entity_split (multiple relevant entities found)
        if len(relevant_candidates) >= 2:
            top_candidates = relevant_candidates[:4]
            systems_desc = ", ".join([f"**{c.name}** ({c.type.title()})" for c in top_candidates])
            explanation = (
                f"I found multiple distinct systems related to '{user_query}' in your knowledge graph: "
                f"{systems_desc}. Which specific system or component would you like information for?"
            )
            chips = [c.name for c in top_candidates]
            return DisambiguationResult(
                explanation_message=explanation,
                disambiguation_type=DisambiguationType.entity_split,
                suggested_chips=chips,
            )

        # Strategy B: adjacent_topics (single entity with neighbors or focused candidate)
        if len(relevant_candidates) == 1:
            cand = relevant_candidates[0]
            if cand.neighbors:
                neighbors_desc = ", ".join([f"**{n}**" for n in cand.neighbors[:3]])
                explanation = (
                    f"Your query closely relates to **{cand.name}** ({cand.type.title()}) in your knowledge graph. "
                    f"Related adjacent concepts include {neighbors_desc}. Would you like to explore one of these topics?"
                )
                chips = [cand.name] + [n for n in cand.neighbors if n != cand.name][:3]
            else:
                explanation = (
                    f"Your query closely matches **{cand.name}** ({cand.type.title()}) in your knowledge graph. "
                    f"Would you like more technical details on this topic?"
                )
                chips = [cand.name]

            return DisambiguationResult(
                explanation_message=explanation,
                disambiguation_type=DisambiguationType.adjacent_topics,
                suggested_chips=chips[:4],
            )

        # Strategy C: unindexed_fallback (no candidate entities matched, fallback to popular topics)
        if popular_topics:
            topics_desc = ", ".join([f"**{t}**" for t in popular_topics[:4]])
            explanation = (
                f"I could not find records or graph entities directly answering '{user_query}' in your organization's indexed knowledge base. "
                f"The most active domain topics currently indexed in your workspace include: {topics_desc}. "
                f"Please select an option below or refine your query."
            )
            chips = popular_topics[:4]
            return DisambiguationResult(
                explanation_message=explanation,
                disambiguation_type=DisambiguationType.unindexed_fallback,
                suggested_chips=chips,
            )

        # Catch-all when no candidates and no popular topics
        return DisambiguationResult(
            explanation_message=f"I could not find records directly answering '{user_query}' in your organization's indexed knowledge base.",
            disambiguation_type=DisambiguationType.unindexed_fallback,
            suggested_chips=[],
        )


class GeminiGraphDisambiguator(BaseGraphDisambiguator):
    """
    Production Graph Disambiguation Specialist leveraging Google Gemini
    with structured JSON response schemas and automatic fallback to MockGraphDisambiguator.
    """

    def __init__(self, api_key: str):
        from google import genai

        self.client = genai.Client(api_key=api_key)
        self.fallback = MockGraphDisambiguator()

    async def disambiguate(
        self,
        user_query: str,
        candidate_entities: List[CandidateEntity],
        popular_tenant_topics: Optional[List[str]] = None,
    ) -> DisambiguationResult:
        popular_topics = popular_tenant_topics or []
        candidates_data = [
            {
                "name": c.name,
                "type": c.type,
                "description": c.description,
                "neighbors": c.neighbors,
            }
            for c in candidate_entities
        ]

        system_instruction = (
            "You are the Graph Disambiguation Specialist for an enterprise multi-tenant platform.\n"
            "The user's query failed to produce high-confidence document chunks or exact-match graph paths. "
            "However, fuzzy search across the tenant's Knowledge Graph yielded candidate entities and neighborhood connections.\n"
            "Your task is to analyze the candidate nodes, resolve why retrieval failed, and generate a natural disambiguation response "
            "that presents relevant options to the user.\n\n"
            "Operating Instructions:\n"
            "1. CANDIDATE RELEVANCE SCORING: Evaluate which candidate entities share the closest conceptual, technical, or linguistic proximity. Filter out noisy entities matching merely common substrings.\n"
            "2. DISAMBIGUATION STRATEGY:\n"
            "   - 'entity_split': Multiple relevant candidates exist. Formulate an explanation pointing out distinct systems found in the knowledge graph, and ask which specific system they need.\n"
            "   - 'adjacent_topics': Closely related candidate with 1-hop neighborhood. Explain the closest concept and present adjacent connections.\n"
            "   - 'unindexed_fallback': No direct candidates match the query, but popular_tenant_topics are provided. State the requested subject is unindexed, and present the most active domain topics.\n"
            "3. SUGGESTION GENERATION: Extract 2 to 4 concise, high-signal entity names or search phrases and assign them to 'suggested_chips'.\n"
            "Output strictly valid JSON matching the schema."
        )

        user_prompt = (
            f"User Query: {user_query}\n\n"
            f"Candidate Entities:\n{json.dumps(candidates_data, indent=2)}\n\n"
            f"Popular Tenant Topics:\n{json.dumps(popular_topics, indent=2)}"
        )

        try:
            from google.genai import types

            response = self.client.models.generate_content(
                model="gemini-2.5-flash",
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2,
                    response_mime_type="application/json",
                    response_schema=DisambiguationResult,
                ),
            )

            raw_text = response.text.strip()
            # Clean possible markdown wrapping
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]

            data = json.loads(raw_text.strip())
            return DisambiguationResult(**data)
        except Exception as e:
            logger.warning(f"GeminiGraphDisambiguator encountered error, falling back to mock: {e}")
            return await self.fallback.disambiguate(
                user_query=user_query,
                candidate_entities=candidate_entities,
                popular_tenant_topics=popular_topics,
            )


def get_graph_disambiguator(api_key: Optional[str] = None) -> BaseGraphDisambiguator:
    """Factory selecting GeminiGraphDisambiguator if an API key is available, else MockGraphDisambiguator."""
    key = api_key or settings.GEMINI_API_KEY
    if key and key.strip() and not key.startswith("AIzaSyMock"):
        return GeminiGraphDisambiguator(api_key=key.strip())
    return MockGraphDisambiguator()
