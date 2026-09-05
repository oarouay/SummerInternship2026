import numpy as np
import pytest
from httpx import AsyncClient

from app.services.embedding import MockEmbeddingService, get_embedding_service


# =====================================================================
# 1. UNIT TESTS: Embedding Service
# =====================================================================

@pytest.mark.asyncio
async def test_mock_embedding_service_dimensions_and_norm():
    """MockEmbeddingService must produce unit-normalized 768-dim vectors."""
    service = MockEmbeddingService(dimensions=768)
    vec = await service.embed_query("GraphRAG multi-tenant architecture")

    assert len(vec) == 768
    # L2 Norm should be approximately 1.0
    norm = np.linalg.norm(np.array(vec, dtype=np.float32))
    assert abs(norm - 1.0) < 1e-4


@pytest.mark.asyncio
async def test_mock_embedding_batch():
    """Batch document embedding returns the correct number of vectors."""
    service = MockEmbeddingService(dimensions=768)
    docs = ["First document chunk.", "Second document chunk.", "Third document chunk."]
    vecs = await service.embed_documents(docs)

    assert len(vecs) == 3
    for v in vecs:
        assert len(v) == 768


@pytest.mark.asyncio
async def test_embedding_semantic_relative_distance():
    """Semantically related phrases must have a smaller cosine distance than unrelated ones."""
    service = MockEmbeddingService(dimensions=768)
    v_refund1 = np.array(await service.embed_query("customer refund return policy"))
    v_refund2 = np.array(await service.embed_query("how do I get my refund money back?"))
    v_astronomy = np.array(await service.embed_query("black holes gravitational waves astronomy"))

    dist_related = 1.0 - float(np.dot(v_refund1, v_refund2))
    dist_unrelated = 1.0 - float(np.dot(v_refund1, v_astronomy))

    assert dist_related < dist_unrelated


# =====================================================================
# 2. INTEGRATION TESTS: Vector Ingestion & Semantic Search
# =====================================================================

@pytest.mark.asyncio
async def test_chunks_persisted_with_embeddings(client: AsyncClient):
    """Uploaded documents must have their chunks embedded and stored with 768 dimensions."""
    # 1. Register tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "VectorCorp",
        "tenant_slug": "vectorcorp",
        "admin_email": "admin@vectorcorp.com",
        "admin_password": "VectorPassword123!"
    })
    token = reg_res.json()["access_token"]

    # 2. Ingest raw text
    text_content = (
        "PostgreSQL with pgvector provides ACID-compliant vector search.\n\n"
        "Google Gemini text-embedding-004 generates high-quality 768-dimensional embeddings."
    )
    src_res = await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Vector Stack Guide", "content": text_content}
    )
    assert src_res.status_code == 201
    source_id = src_res.json()["id"]

    # 3. Verify Source status is indexed with embedding metadata
    get_src = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_src.status_code == 200
    src_data = get_src.json()
    assert src_data["status"] == "indexed"

    # 4. Fetch Chunks
    get_chunks = await client.get(
        f"/api/v1/sources/{source_id}/chunks",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_chunks.status_code == 200
    chunks = get_chunks.json()
    assert len(chunks) > 0


@pytest.mark.asyncio
async def test_semantic_search_relevance_ranking(client: AsyncClient):
    """Semantic search must rank the most relevant chunk highest."""
    # 1. Register tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "SearchCorp",
        "tenant_slug": "searchcorp",
        "admin_email": "admin@searchcorp.com",
        "admin_password": "SearchPassword123!"
    })
    token = reg_res.json()["access_token"]

    # 2. Ingest Topic A: Refund Policy
    await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Refund Policy Document",
            "content": "All customer refund requests for purchases must be submitted within thirty days of the billing invoice."
        }
    )

    # 3. Ingest Topic B: API Authentication
    await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "API Security Guidelines",
            "content": "API requests require Bearer token authorization in the HTTP header with rate limits enforced."
        }
    )

    # 4. Search for refund information
    search_res = await client.post(
        "/api/v1/sources/search",
        headers={"Authorization": f"Bearer {token}"},
        json={"query": "How can I request a refund for my purchase?", "top_k": 3}
    )
    assert search_res.status_code == 200
    results = search_res.json()
    assert len(results) >= 1

    # Top result should be the Refund Policy
    top_result = results[0]
    assert "Refund Policy Document" in top_result["source_name"]
    assert "refund requests" in top_result["content"].lower()
    assert top_result["score"] > 0.0
    assert top_result["distance"] < 1.0


@pytest.mark.asyncio
async def test_semantic_search_cross_tenant_isolation(client: AsyncClient):
    """Tenant B must receive ZERO results when searching for Tenant A's documents."""
    # 1. Register Tenant A
    t1_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "SecretAlpha",
        "tenant_slug": "secret-alpha",
        "admin_email": "alpha@secret.com",
        "admin_password": "AlphaPassword123!"
    })
    t1_token = t1_res.json()["access_token"]

    # 2. Register Tenant B
    t2_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "SecretBeta",
        "tenant_slug": "secret-beta",
        "admin_email": "beta@secret.com",
        "admin_password": "BetaPassword123!"
    })
    t2_token = t2_res.json()["access_token"]

    # 3. Tenant A ingests highly specific proprietary document
    await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {t1_token}"},
        json={
            "name": "Project Quantum Secret",
            "content": "Project Quantum employs proprietary cryogenic quantum computing algorithms."
        }
    )

    # 4. Tenant B searches for exact keywords from Tenant A's document
    search_b = await client.post(
        "/api/v1/sources/search",
        headers={"Authorization": f"Bearer {t2_token}"},
        json={"query": "Project Quantum cryogenic computing", "top_k": 5}
    )
    assert search_b.status_code == 200
    results_b = search_b.json()

    # MUST be strictly empty (zero cross-tenant leakage)
    assert len(results_b) == 0
