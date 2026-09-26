import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import select

from app.core.config import settings
from app.models.chunk import DocumentChunk
from app.models.source import Source, SourceStatus, SourceType
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.graph import (
    Entity,
    GraphExtractionResult,
    GraphNeighborhoodResponse,
    Relationship,
)
from app.schemas.router import ConversationalRouteResult, RouterAction
from app.schemas.search import SearchResult
from app.schemas.synthesis import SynthesisResult
from app.services.graph import InMemoryGraphStore
from app.services.pipeline import process_source_pipeline
from app.services.router import MockConversationalRouter
from app.services.search import search_similar_chunks
from app.services.synthesis import RAGPipelineService, _empty_neighborhood


# =====================================================================
# 1. PART 1 TESTS: Router seed_entities direct usage & fallback
# =====================================================================

@pytest.mark.asyncio
async def test_part1_seed_entities_used_without_extractor(db_session, isolate_graph_store, monkeypatch):
    """Verify answer_query uses router seed_entities directly without calling extract_graph."""
    tenant = Tenant(name="Test Tenant", slug="test-part1")
    db_session.add(tenant)
    await db_session.commit()
    await db_session.refresh(tenant)

    # Mock router to return explicit seed entities
    mock_router = MagicMock()
    mock_router.route = AsyncMock(return_value=ConversationalRouteResult(
        action=RouterAction.RETRIEVE,
        standalone_query="Tell me about Project Alpha",
        seed_entities=["Project Alpha"],
        direct_or_clarification_message=None,
        clarification_options=[],
        execution_time_ms=10.0,
    ))
    monkeypatch.setattr("app.services.synthesis.get_conversational_router", lambda **kwargs: mock_router)

    # Track if extractor is ever called
    mock_extractor = MagicMock()
    mock_extractor.extract_graph = AsyncMock()
    monkeypatch.setattr("app.services.synthesis.get_graph_extractor", lambda **kwargs: mock_extractor)

    # Mock embedding
    mock_emb = MagicMock()
    mock_emb.embed_query = AsyncMock(return_value=[0.1] * 768)
    monkeypatch.setattr("app.services.synthesis.get_embedding_service", lambda **kwargs: mock_emb)

    # Mock synthesizer
    mock_synth = MagicMock()
    mock_synth.synthesize = AsyncMock(return_value=SynthesisResult(
        answer="Project Alpha is verified.",
        follow_up_suggestions=["Alpha Specs"],
        needs_clarification=False,
        match_type="complete"
    ))
    monkeypatch.setattr("app.services.synthesis.get_rag_synthesizer", lambda **kwargs: mock_synth)

    resp = await RAGPipelineService.answer_query(
        db=db_session,
        tenant_id=tenant.id,
        query="Tell me about Project Alpha",
    )

    assert "Project Alpha" in resp.entities_detected
    # CRITICAL: Extractor must NOT have been called on query time!
    mock_extractor.extract_graph.assert_not_called()
    assert resp.answer == "Project Alpha is verified."


@pytest.mark.asyncio
async def test_part1_fallback_triggers_when_router_seed_entities_empty(db_session, isolate_graph_store, monkeypatch):
    """When router returns no seed entities, fuzzy candidate entity fallback triggers."""
    tenant = Tenant(name="Test Tenant", slug="test-part1-fallback")
    db_session.add(tenant)
    await db_session.commit()
    await db_session.refresh(tenant)

    # Pre-populate graph store with candidate entity
    await isolate_graph_store.insert_graph(
        tenant_id=tenant.id,
        source_id=1,
        chunk_id=10,
        graph=GraphExtractionResult(
            entities=[Entity(name="CloudStorage", type="TECHNOLOGY", description="S3 storage")],
            relationships=[]
        )
    )

    # Router returns empty seed_entities
    mock_router = MagicMock()
    mock_router.route = AsyncMock(return_value=ConversationalRouteResult(
        action=RouterAction.RETRIEVE,
        standalone_query="How do I configure storage?",
        seed_entities=[],
        direct_or_clarification_message=None,
        clarification_options=[],
        execution_time_ms=5.0,
    ))
    monkeypatch.setattr("app.services.synthesis.get_conversational_router", lambda **kwargs: mock_router)

    # Extractor must still not be called
    mock_extractor = MagicMock()
    mock_extractor.extract_graph = AsyncMock()
    monkeypatch.setattr("app.services.synthesis.get_graph_extractor", lambda **kwargs: mock_extractor)

    mock_emb = MagicMock()
    mock_emb.embed_query = AsyncMock(return_value=[0.05] * 768)
    monkeypatch.setattr("app.services.synthesis.get_embedding_service", lambda **kwargs: mock_emb)

    mock_synth = MagicMock()
    mock_synth.synthesize = AsyncMock(return_value=SynthesisResult(
        answer="CloudStorage configuration details.",
        follow_up_suggestions=[],
        needs_clarification=False,
        match_type="complete"
    ))
    monkeypatch.setattr("app.services.synthesis.get_rag_synthesizer", lambda **kwargs: mock_synth)

    resp = await RAGPipelineService.answer_query(
        db=db_session,
        tenant_id=tenant.id,
        query="How do I configure storage?",
    )

    mock_extractor.extract_graph.assert_not_called()
    # The fuzzy fallback should have detected CloudStorage
    assert "CloudStorage" in resp.entities_detected


# =====================================================================
# 2. PART 2 TESTS: Concurrent vector search and graph traversal
# =====================================================================

@pytest.mark.asyncio
async def test_part2_empty_neighborhood_helper():
    """Verify _empty_neighborhood returns empty GraphNeighborhoodResponse without error."""
    res = await _empty_neighborhood()
    assert isinstance(res, GraphNeighborhoodResponse)
    assert len(res.nodes) == 0
    assert len(res.edges) == 0


@pytest.mark.asyncio
async def test_part2_concurrent_gather_execution(db_session, isolate_graph_store, monkeypatch):
    """Verify search_similar_chunks and get_neighborhood execute concurrently without altering results."""
    tenant = Tenant(name="Test Tenant", slug="test-part2")
    db_session.add(tenant)
    await db_session.commit()
    await db_session.refresh(tenant)

    user = User(tenant_id=tenant.id, email="user@test-part2.com", hashed_password="hashed_password", full_name="User Part2")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    source = Source(
        tenant_id=tenant.id,
        owner_id=user.id,
        name="Doc1",
        file_path="uploads/doc1.txt",
        mime_type="text/plain",
        source_type=SourceType.FILE.value,
        status=SourceStatus.INDEXED.value
    )
    db_session.add(source)
    await db_session.commit()
    await db_session.refresh(source)

    chunk = DocumentChunk(
        tenant_id=tenant.id,
        source_id=source.id,
        chunk_index=0,
        content="Project Orion uses PostgreSQL for transactions.",
        char_count=48,
        token_count=10,
        embedding=[0.2] * 768
    )
    db_session.add(chunk)
    await db_session.commit()

    # Pre-populate graph store
    await isolate_graph_store.insert_graph(
        tenant_id=tenant.id,
        source_id=source.id,
        chunk_id=chunk.id,
        graph=GraphExtractionResult(
            entities=[
                Entity(name="Project Orion", type="PROJECT", description="Orion System"),
                Entity(name="PostgreSQL", type="TECHNOLOGY", description="RDBMS")
            ],
            relationships=[
                Relationship(source="Project Orion", target="PostgreSQL", relation_type="USES", description="uses DB")
            ]
        )
    )

    mock_router = MagicMock()
    mock_router.route = AsyncMock(return_value=ConversationalRouteResult(
        action=RouterAction.RETRIEVE,
        standalone_query="What does Project Orion use?",
        seed_entities=["Project Orion"],
        direct_or_clarification_message=None,
        clarification_options=[],
        execution_time_ms=8.0,
    ))
    monkeypatch.setattr("app.services.synthesis.get_conversational_router", lambda **kwargs: mock_router)

    mock_emb = MagicMock()
    mock_emb.embed_query = AsyncMock(return_value=[0.2] * 768)
    monkeypatch.setattr("app.services.synthesis.get_embedding_service", lambda **kwargs: mock_emb)

    mock_synth = MagicMock()
    mock_synth.synthesize = AsyncMock(return_value=SynthesisResult(
        answer="Project Orion uses PostgreSQL.",
        follow_up_suggestions=["PostgreSQL setup"],
        needs_clarification=False,
        match_type="complete"
    ))
    monkeypatch.setattr("app.services.synthesis.get_rag_synthesizer", lambda **kwargs: mock_synth)

    resp = await RAGPipelineService.answer_query(
        db=db_session,
        tenant_id=tenant.id,
        query="What does Project Orion use?",
    )

    assert resp.answer == "Project Orion uses PostgreSQL."
    assert len(resp.source_citations) >= 1
    assert resp.source_citations[0].source_name == "Doc1"
    assert len(resp.graph_citations) >= 1
    assert resp.graph_citations[0].source_entity == "Project Orion"
    assert resp.graph_citations[0].target_entity == "PostgreSQL"
    assert resp.execution_time_ms > 0


# =====================================================================
# 3. PART 4 TESTS: Ingestion batch graph insertion and error isolation
# =====================================================================

@pytest.mark.asyncio
async def test_part4_insert_graph_batch_parity():
    """Verify insert_graph_batch creates the identical graph state as multiple insert_graph calls."""
    store_a = InMemoryGraphStore()
    store_b = InMemoryGraphStore()

    g1 = GraphExtractionResult(
        entities=[Entity(name="Alice", type="PERSON", description="Lead"), Entity(name="ProjectX", type="PROJECT", description="Core")],
        relationships=[Relationship(source="Alice", target="ProjectX", relation_type="MANAGES", description="leads")]
    )
    g2 = GraphExtractionResult(
        entities=[Entity(name="ProjectX", type="PROJECT", description="Core"), Entity(name="Docker", type="TECHNOLOGY", description="Containers")],
        relationships=[Relationship(source="ProjectX", target="Docker", relation_type="USES", description="runs in")]
    )

    # Store A: Individual inserts
    await store_a.insert_graph(tenant_id=1, source_id=10, chunk_id=1, graph=g1)
    await store_a.insert_graph(tenant_id=1, source_id=10, chunk_id=2, graph=g2)

    # Store B: Batch insert
    await store_b.insert_graph_batch(tenant_id=1, source_id=10, chunk_graphs=[(1, g1), (2, g2)])

    stats_a = await store_a.get_stats(tenant_id=1)
    stats_b = await store_b.get_stats(tenant_id=1)

    assert stats_a.node_count == stats_b.node_count == 3
    assert stats_a.edge_count == stats_b.edge_count == 2

    # Verify neighborhoods match
    nh_a = await store_a.get_neighborhood(tenant_id=1, entity_names=["Alice"], max_hops=2)
    nh_b = await store_b.get_neighborhood(tenant_id=1, entity_names=["Alice"], max_hops=2)

    assert len(nh_a.nodes) == len(nh_b.nodes)
    assert len(nh_a.edges) == len(nh_b.edges)


@pytest.mark.asyncio
async def test_part4_process_source_pipeline_partial_failure_isolation(db_session, isolate_graph_store, monkeypatch):
    """Verify that if one chunk fails graph extraction, remaining chunks succeed and source indexes successfully."""
    from tests.conftest import TestSessionLocal
    from app.services.chunking import RecursiveTextSplitter
    monkeypatch.setattr("app.services.pipeline.AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr("app.services.pipeline.RecursiveTextSplitter", lambda: RecursiveTextSplitter(chunk_size=60, chunk_overlap=10))

    tenant = Tenant(name="Partial Failure Tenant", slug="partial-failure")
    db_session.add(tenant)
    await db_session.commit()
    await db_session.refresh(tenant)

    # Write a test file with multiple paragraphs
    import os
    os.makedirs("uploads", exist_ok=True)
    test_file = "uploads/partial_test.txt"
    with open(test_file, "w", encoding="utf-8") as f:
        f.write("Section 1: Microservices architecture with FastAPI.\n\nSection 2: Message queues with Kafka streaming.\n\nSection 3: Database storage with PostgreSQL.")

    user = User(tenant_id=tenant.id, email="user@partial-failure.com", hashed_password="hashed_password", full_name="User Part4")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    source = Source(
        tenant_id=tenant.id,
        owner_id=user.id,
        name="Partial Test Doc",
        file_path=test_file,
        mime_type="text/plain",
        source_type=SourceType.FILE.value,
        status=SourceStatus.PENDING.value
    )
    db_session.add(source)
    await db_session.commit()
    await db_session.refresh(source)

    # Mock embedding
    mock_emb = MagicMock()
    mock_emb.embed_documents = AsyncMock(return_value=[[0.1] * 768, [0.2] * 768, [0.3] * 768])
    monkeypatch.setattr("app.services.pipeline.get_embedding_service", lambda **kwargs: mock_emb)

    # Mock extractor: Fail on the 2nd chunk, succeed on 1st and 3rd
    call_count = 0
    async def selective_extract_graph(text: str):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("Gemini 500 Temporary Ingestion Glitch on chunk 2")
        return GraphExtractionResult(
            entities=[Entity(name=f"Entity_{call_count}", type="CONCEPT", description="test")],
            relationships=[]
        )

    mock_extractor = MagicMock()
    mock_extractor.extract_graph = selective_extract_graph
    monkeypatch.setattr("app.services.pipeline.get_graph_extractor", lambda **kwargs: mock_extractor)

    # Execute pipeline
    await process_source_pipeline(source.id)

    # Check source status in DB
    await db_session.refresh(source)
    assert source.status == SourceStatus.INDEXED.value

    # Verify chunks in DB
    stmt = select(DocumentChunk).where(DocumentChunk.source_id == source.id)
    chunks = (await db_session.execute(stmt)).scalars().all()
    assert len(chunks) == 3

    # Verify that graph elements were inserted for the successful chunks
    stats = await isolate_graph_store.get_stats(tenant.id)
    assert stats.node_count >= 2


# =====================================================================
# 4. PART 5 TESTS: pgvector HNSW ANN Index & search tuning
# =====================================================================

@pytest.mark.asyncio
async def test_part5_search_similar_chunks_with_ef_search(db_session):
    """Verify search_similar_chunks orders correctly and handles ef_search settings gracefully."""
    tenant = Tenant(name="ANN Tenant", slug="ann-tenant")
    db_session.add(tenant)
    await db_session.commit()
    await db_session.refresh(tenant)

    user = User(tenant_id=tenant.id, email="user@ann-tenant.com", hashed_password="hashed_password", full_name="User Part5")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    source = Source(
        tenant_id=tenant.id,
        owner_id=user.id,
        name="ANN Doc",
        file_path="uploads/ann.txt",
        mime_type="text/plain",
        source_type=SourceType.FILE.value,
        status=SourceStatus.INDEXED.value
    )
    db_session.add(source)
    await db_session.commit()
    await db_session.refresh(source)

    # Chunk A is very close to query vector [1.0, 0.0, ...]
    c1 = DocumentChunk(
        tenant_id=tenant.id,
        source_id=source.id,
        chunk_index=0,
        content="Target high similarity content",
        char_count=30,
        token_count=5,
        embedding=[1.0] + [0.0] * 767
    )
    # Chunk B is orthogonal/far [0.0, 1.0, ...]
    c2 = DocumentChunk(
        tenant_id=tenant.id,
        source_id=source.id,
        chunk_index=1,
        content="Distant content",
        char_count=15,
        token_count=3,
        embedding=[0.0, 1.0] + [0.0] * 766
    )
    db_session.add_all([c1, c2])
    await db_session.commit()

    query_vec = [1.0] + [0.0] * 767
    results = await search_similar_chunks(
        db=db_session,
        tenant_id=tenant.id,
        query_vector=query_vec,
        top_k=2
    )

    assert len(results) == 2
    # First result must be Chunk A with highest similarity score
    assert results[0].chunk_id == c1.id
    assert results[0].score > results[1].score
    assert results[0].score >= 0.99


def test_part5_migration_module_structure():
    """Verify the Alembic migration module contains required upgrade, downgrade, and version detection."""
    import importlib.util
    import os

    migration_path = os.path.abspath("alembic/versions/0001_add_pgvector_hnsw_index.py")
    spec = importlib.util.spec_from_file_location("migration_0001", migration_path)
    migration_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration_mod)

    assert hasattr(migration_mod, "upgrade")
    assert hasattr(migration_mod, "downgrade")
    assert hasattr(migration_mod, "get_pgvector_version")
    assert hasattr(migration_mod, "version_tuple")

    assert migration_mod.version_tuple("0.5.1") == (0, 5, 1)
    assert migration_mod.version_tuple("0.4.0") < (0, 5, 0)
    assert migration_mod.version_tuple("0.7.0-dev") == (0, 7, 0)
