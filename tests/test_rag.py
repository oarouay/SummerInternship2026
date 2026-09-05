import io
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.graph import GraphEdge, GraphNeighborhoodResponse, GraphNode
from app.schemas.search import SearchResult
from app.services.pipeline import process_source_pipeline
from app.services.synthesis import MockRAGSynthesizer, build_fusion_context


def test_build_fusion_context():
    """Verify that graph triples and text chunks are fused into clean markdown."""
    chunks = [
        SearchResult(
            chunk_id=1,
            source_id=10,
            source_name="Architecture Plan",
            content="Project Titan is the flagship infrastructure initiative.",
            score=0.92,
            distance=0.08,
            chunk_index=0,
        )
    ]
    graph = GraphNeighborhoodResponse(
        nodes=[
            GraphNode(name="Alice", type="PERSON"),
            GraphNode(name="Project Titan", type="PROJECT"),
        ],
        edges=[
            GraphEdge(
                source="Alice",
                target="Project Titan",
                type="MANAGES",
                description="Alice manages Project Titan",
                weight=1,
            )
        ],
    )

    context = build_fusion_context(chunks, graph)
    assert "Verified Knowledge Graph Relationships" in context
    assert "(Alice) --[MANAGES]--> (Project Titan)" in context
    assert "Verified Document Passages" in context
    assert "Architecture Plan" in context
    assert "Project Titan is the flagship" in context


@pytest.mark.asyncio
async def test_mock_rag_synthesizer():
    """Verify mock synthesizer behavior on populated and empty context."""
    synthesizer = MockRAGSynthesizer()

    # Populated
    chunks = [
        SearchResult(
            chunk_id=1,
            source_id=1,
            source_name="Security Docs",
            content="Hydra Auth secures token exchange.",
            score=0.88,
            distance=0.12,
            chunk_index=0,
        )
    ]
    graph = GraphNeighborhoodResponse(
        edges=[GraphEdge(source="Titan", target="Hydra", type="DEPENDS_ON", weight=1)]
    )
    answer = await synthesizer.synthesize("What does Titan use?", chunks, graph)
    assert "Titan depends on Hydra" in answer
    assert "Security Docs" in answer

    # Empty
    empty_answer = await synthesizer.synthesize("Anything?", [], GraphNeighborhoodResponse())
    assert "insufficient information" in empty_answer.lower()


@pytest.mark.asyncio
async def test_hybrid_rag_query_endpoint_and_cross_tenant_isolation(
    client: AsyncClient, db_session: AsyncSession
):
    """Verify POST /api/v1/rag/query with citations and strict cross-tenant isolation."""
    # 1. Register Tenant A
    res_a = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "RAGCorp Alpha",
            "tenant_slug": "ragalpha",
            "admin_email": "alpha_admin@ragcorp.com",
            "admin_password": "Password123!",
            "admin_name": "Alpha Admin",
        },
    )
    assert res_a.status_code == 201
    token_a = res_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # 2. Register Tenant B
    res_b = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "RAGCorp Beta",
            "tenant_slug": "ragbeta",
            "admin_email": "beta_admin@ragcorp.com",
            "admin_password": "Password123!",
            "admin_name": "Beta Admin",
        },
    )
    assert res_b.status_code == 201
    token_b = res_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 3. Ingest knowledge document for Tenant A
    doc_content = (
        "Alice directs Project Titan at RAGCorp. "
        "Project Titan depends on Hydra Auth for all security and authentication protocols. "
        "Hydra Auth implements RFC-6749 OAuth2 standard with strict token revocation."
    )
    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers=headers_a,
        files={"file": ("titan_architecture.txt", io.BytesIO(doc_content.encode("utf-8")), "text/plain")},
    )
    assert upload_res.status_code == 201
    source_id = upload_res.json()["id"]

    # Run processing pipeline
    await process_source_pipeline(source_id=source_id)

    # 4. Tenant A asks a question
    query_payload = {
        "query": "What security system does Project Titan depend on?",
        "top_k_chunks": 3,
        "max_graph_hops": 2,
    }
    rag_res_a = await client.post("/api/v1/rag/query", headers=headers_a, json=query_payload)
    assert rag_res_a.status_code == 200
    data_a = rag_res_a.json()

    assert data_a["query"] == query_payload["query"]
    assert len(data_a["answer"]) > 0
    assert "insufficient information" not in data_a["answer"].lower()
    assert len(data_a["source_citations"]) >= 1
    assert data_a["source_citations"][0]["source_name"] == "titan_architecture.txt"
    assert data_a["source_citations"][0]["similarity_score"] > 0
    assert data_a["execution_time_ms"] > 0

    # 5. Tenant B asks the exact same question
    rag_res_b = await client.post("/api/v1/rag/query", headers=headers_b, json=query_payload)
    assert rag_res_b.status_code == 200
    data_b = rag_res_b.json()

    # Tenant B has no access to Tenant A's documents or graph!
    assert "insufficient information" in data_b["answer"].lower()
    assert len(data_b["source_citations"]) == 0
    assert len(data_b["graph_citations"]) == 0

    # 6. Unauthenticated check
    unauth_res = await client.post("/api/v1/rag/query", json=query_payload)
    assert unauth_res.status_code == 401
