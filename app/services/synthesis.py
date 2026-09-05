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
from app.schemas.search import SearchResult
from app.services.embedding import get_embedding_service
from app.services.extractor import get_graph_extractor
from app.services.graph import get_graph_store
from app.services.search import search_similar_chunks

logger = logging.getLogger(__name__)


def build_fusion_context(
    chunks: List[SearchResult],
    graph: GraphNeighborhoodResponse
) -> str:
    """
    Fuses unstructured text passages and structured knowledge graph triples
    into a unified markdown prompt context.
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
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> str:
        """Synthesizes a grounded answer from fused vector and graph context."""
        pass


class MockRAGSynthesizer(BaseRAGSynthesizer):
    """
    Deterministic rule-based synthesizer for unit testing and offline development.
    Requires no API keys and produces predictable, testable answers.
    """

    async def synthesize(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> str:
        if not chunks and not graph.edges and not graph.nodes:
            return "Based on your organization's knowledge base, there is insufficient information to answer this question."

        parts = []

        # Graph synthesis
        if graph.edges:
            edge_strs = [f"{e.source} {e.type.lower().replace('_', ' ')} {e.target}" for e in graph.edges]
            parts.append(f"According to the knowledge graph, {', and '.join(edge_strs)}.")

        # Chunk synthesis
        if chunks:
            top_chunk = chunks[0]
            snippet = top_chunk.content[:180].strip().replace("\n", " ")
            parts.append(f"Referencing \"{top_chunk.source_name}\": {snippet}...")

        if conversation_history:
            parts.append(f"(Follow-up to previous {len(conversation_history)} messages)")

        return " ".join(parts)


class GeminiRAGSynthesizer(BaseRAGSynthesizer):
    """
    Production synthesizer using Google Gemini (gemini-2.5-flash) with grounded prompt engineering.
    """

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        from google import genai

        self.client = genai.Client(api_key=api_key)
        self.model = model

    async def synthesize(
        self,
        query: str,
        chunks: List[SearchResult],
        graph: GraphNeighborhoodResponse,
        temperature: float = 0.2,
        conversation_history: Optional[List[dict]] = None,
        persona_tone: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> str:
        if not chunks and not graph.edges and not graph.nodes:
            return "Based on your organization's knowledge base, there is insufficient information to answer this question."

        context_str = build_fusion_context(chunks, graph)

        tone_directive = f"\n6. Persona & Tone: You MUST respond in a {persona_tone} tone." if persona_tone else ""
        custom_directive = f"\n7. Specific Tenant Guidance: {custom_system_prompt}" if custom_system_prompt else ""

        system_instruction = f"""
        You are the AI Knowledge Engine for an enterprise organization.
        Answer the user's question accurately and objectively using ONLY the provided verified context.

        CRITICAL GROUNDING RULES:
        1. Rely SOLELY on the provided Document Passages and Knowledge Graph Relationships.
        2. If the context does not contain enough information to answer the question, respond:
           "Based on your organization's knowledge base, there is insufficient information to answer this question."
        3. Do NOT extrapolate, speculate, or fabricate details.
        4. Synthesize across both text passages and graph relationships when answering.
        5. When citing facts, mention the document name or the relationship triple.{tone_directive}{custom_directive}
        """

        history_section = ""
        if conversation_history:
            recent_turns = conversation_history[-6:]
            formatted_turns = "\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in recent_turns])
            history_section = f"\n\nRECENT CONVERSATION HISTORY:\n{formatted_turns}\n"

        prompt = f"""
        {system_instruction}

        CONTEXT INFORMATION:
        {context_str}
        {history_section}
        USER QUESTION:
        {query}

        SYNTHESIZED ANSWER:
        """

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config={"temperature": temperature}
            )
            return response.text.strip()
        except Exception as e:
            logger.exception(f"Gemini RAG synthesis failed: {e}. Falling back to mock synthesizer.")
            return await MockRAGSynthesizer().synthesize(
                query, chunks, graph, temperature, conversation_history, persona_tone, custom_system_prompt
            )


def get_rag_synthesizer() -> BaseRAGSynthesizer:
    """Factory returning GeminiRAGSynthesizer if API key is present, else MockRAGSynthesizer."""
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiRAGSynthesizer(
                api_key=settings.GEMINI_API_KEY,
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
    ) -> RAGQueryResponse:
        start_time = time.perf_counter()

        # Step 1: Query Analysis & Seed Entity Extraction
        extractor = get_graph_extractor()
        query_graph = await extractor.extract_graph(query)
        detected_entities = [e.name for e in query_graph.entities]

        # Step 2: Track A - Semantic Vector Retrieval (pgvector)
        embedding_service = get_embedding_service()
        query_vector = await embedding_service.embed_query(query)

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
        if detected_entities:
            graph_response = await graph_store.get_neighborhood(
                tenant_id=tenant_id,
                entity_names=detected_entities,
                max_hops=max_graph_hops,
                limit=25
            )

        # Step 4: Context Fusion & Grounded LLM Synthesis
        synthesizer = get_rag_synthesizer()
        answer = await synthesizer.synthesize(
            query=query,
            chunks=chunks,
            graph=graph_response,
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
            answer=answer,
            source_citations=source_citations,
            graph_citations=graph_citations,
            entities_detected=detected_entities,
            execution_time_ms=elapsed_ms
        )
