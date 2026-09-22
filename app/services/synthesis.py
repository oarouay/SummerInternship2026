import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from typing import List, Optional

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
    ) -> SynthesisResult:
        """Synthesizes a grounded answer from fused vector and graph context."""
        pass


class MockRAGSynthesizer(BaseRAGSynthesizer):
    """
    Deterministic rule-based synthesizer for unit testing and offline development.
    Adheres strictly to Complete Match, Partial Match, and Zero Match rules.
    """

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
        candidates = candidate_concepts or [n.name for n in graph.nodes]

        # Case 3: ZERO MATCH OR LOW CONFIDENCE
        if not chunks and not graph.edges:
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

        # Case 1: COMPLETE MATCH (both chunks and graph edges present)
        if chunks and graph.edges:
            parts = []
            edge_strs = [f"{e.source} {e.type.lower().replace('_', ' ')} {e.target}" for e in graph.edges[:6]]
            parts.append(f"According to the knowledge graph, {', and '.join(edge_strs)}.")
            chunk_snippets = []
            for chk in chunks[:3]:
                snippet = chk.content[:160].strip().replace("\n", " ")
                chunk_snippets.append(f"From \"{chk.source_name}\": {snippet}")
            parts.append(" ".join(chunk_snippets))
            if conversation_history:
                parts.append(f"(Follow-up to previous {len(conversation_history)} messages)")

            answer = " ".join(parts)
            suggestions = [
                f"Explore deeper dependencies for {graph.edges[0].target}",
                f"Review operational architecture in {chunks[0].source_name}",
            ]
            return SynthesisResult(
                answer=answer,
                follow_up_suggestions=suggestions,
                needs_clarification=False,
                match_type="complete",
            )

        # Case 2: PARTIAL MATCH (chunks without edges or edges without chunks)
        if chunks:
            chunk_snippets = []
            for chk in chunks[:3]:
                snippet = chk.content[:160].strip().replace("\n", " ")
                chunk_snippets.append(f"From \"{chk.source_name}\": {snippet}")
            answer = f"Based on your organization's documentation: {' '.join(chunk_snippets)}."
            suggestions = [
                f"Inspect documentation in {chunks[0].source_name}",
                "Explore related operational topics",
            ]
        else:
            edge_strs = [f"{e.source} {e.type.lower().replace('_', ' ')} {e.target}" for e in graph.edges[:6]]
            answer = f"Based on your organization's knowledge graph: {', and '.join(edge_strs)}."
            suggestions = [
                f"Explore neighborhood of {graph.edges[0].source}",
                "Upload related documentation",
            ]

        return SynthesisResult(
            answer=answer,
            follow_up_suggestions=suggestions,
            needs_clarification=False,
            match_type="partial",
        )


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
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=prompt,
                    config={
                        "response_mime_type": "application/json",
                        "response_schema": SynthesisResult,
                        "temperature": temperature,
                    }
                )
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
                    logger.warning(f"Gemini RAG synthesis failed: {e}. Falling back to mock synthesizer.")
                return await self.mock_fallback.synthesize(
                    query, chunks, graph, candidate_concepts, temperature, conversation_history, persona_tone, custom_system_prompt
                )


def get_rag_synthesizer(api_key: Optional[str] = None) -> BaseRAGSynthesizer:
    """Factory returning GeminiRAGSynthesizer if API key is present, else MockRAGSynthesizer."""
    effective_key = (api_key and api_key.strip()) or (settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip())
    if effective_key:
        try:
            return GeminiRAGSynthesizer(
                api_key=effective_key,
                model=settings.LLM_MODEL
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
    ) -> RAGQueryResponse:
        start_time = time.perf_counter()

        # Step 0: Conversational Routing & Intent Classification
        router = get_conversational_router(api_key=gemini_api_key)
        route_res = await router.route(
            query=query,
            conversation_history=conversation_history,
            tenant_name=tenant_name,
            custom_system_prompt=custom_system_prompt,
        )

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
            )

        # Step 1: Query Analysis & Seed Entity Extraction (Action: RETRIEVE)
        effective_query = route_res.standalone_query or query
        extractor = get_graph_extractor(api_key=gemini_api_key)
        query_graph = await extractor.extract_graph(effective_query)
        detected_entities = list(dict.fromkeys(route_res.seed_entities + [e.name for e in query_graph.entities]))

        # Step 2: Track A - Semantic Vector Retrieval (pgvector)
        embedding_service = get_embedding_service(api_key=gemini_api_key)
        query_vector = await embedding_service.embed_query(effective_query)

        chunks: List[SearchResult] = await search_similar_chunks(
            db=db,
            tenant_id=tenant_id,
            query_vector=query_vector,
            top_k=top_k_chunks,
            source_id=source_id
        )

        # Step 3: Track B - Knowledge Graph Traversal (Neo4j)
        graph_store = await get_graph_store()
        graph_response = GraphNeighborhoodResponse()
        candidate_concepts = []

        # Fuzzy-entity fallback: if router/extractor detected no entities, search candidate entities via fuzzy match
        if not detected_entities:
            try:
                candidate_ents = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                if candidate_ents:
                    detected_entities = [c.name for c in candidate_ents]
            except Exception as e:
                logger.debug(f"Candidate entity search fallback failed: {e}")

        if detected_entities:
            graph_response = await graph_store.get_neighborhood(
                tenant_id=tenant_id,
                entity_names=detected_entities,
                max_hops=max_graph_hops,
                limit=25
            )
            candidate_concepts = [n.name for n in graph_response.nodes if n.name not in detected_entities]

        # Step 3.5: Zero-match retry pass using top candidate entity before falling back to disambiguator
        if not chunks and not graph_response.edges:
            try:
                candidates = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                if candidates:
                    top_candidate = candidates[0].name
                    retry_query = f"{effective_query} {top_candidate}"
                    retry_vector = await embedding_service.embed_query(retry_query)
                    retry_chunks = await search_similar_chunks(
                        db=db,
                        tenant_id=tenant_id,
                        query_vector=retry_vector,
                        top_k=top_k_chunks,
                        source_id=source_id,
                    )
                    retry_graph = await graph_store.get_neighborhood(
                        tenant_id=tenant_id,
                        entity_names=[top_candidate],
                        max_hops=max_graph_hops,
                        limit=25,
                    )
                    if retry_chunks or retry_graph.edges:
                        chunks = retry_chunks
                        graph_response = retry_graph
                        if top_candidate not in detected_entities:
                            detected_entities.append(top_candidate)
                        candidate_concepts = [n.name for n in graph_response.nodes if n.name not in detected_entities]
            except Exception as e:
                logger.warning(f"Zero-match candidate retry notice: {e}")

        # In zero-match or low-confidence cases (still empty after retry), engage Graph Disambiguation Specialist
        if not chunks and not graph_response.edges:
            try:
                candidates = await graph_store.find_candidate_entities(
                    tenant_id=tenant_id, query=effective_query, limit=5
                )
                popular_topics = await graph_store.get_popular_topics(
                    tenant_id=tenant_id, limit=5
                )
                if candidates or popular_topics:
                    disambiguator = get_graph_disambiguator(api_key=gemini_api_key)
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

        # Step 4: Context Fusion & Grounded LLM Synthesis
        synthesizer = get_rag_synthesizer(api_key=gemini_api_key)
        synth_res = await synthesizer.synthesize(
            query=effective_query,
            chunks=chunks,
            graph=graph_response,
            candidate_concepts=candidate_concepts,
            temperature=temperature,
            conversation_history=conversation_history,
            persona_tone=persona_tone,
            custom_system_prompt=custom_system_prompt,
        )

        # Step 5: Format Verifiable Citations
        source_citations = [
            RAGSourceCitation(
                source_id=chk.source_id,
                source_name=chk.source_name,
                chunk_id=chk.chunk_id,
                snippet=chk.content[:200].strip(),
                similarity_score=round(chk.score, 4)
            )
            for chk in chunks
        ]

        graph_citations = [
            RAGGraphCitation(
                source_entity=edge.source,
                relation=edge.type,
                target_entity=edge.target,
                description=edge.description
            )
            for edge in graph_response.edges
        ]

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return RAGQueryResponse(
            query=query,
            answer=synth_res.answer,
            action=route_res.action.value,
            clarification_options=[],
            standalone_query=route_res.standalone_query,
            follow_up_suggestions=synth_res.follow_up_suggestions,
            needs_clarification=synth_res.needs_clarification,
            source_citations=source_citations,
            graph_citations=graph_citations,
            entities_detected=detected_entities,
            execution_time_ms=elapsed_ms
        )
