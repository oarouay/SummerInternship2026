import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.source import Source, SourceStatus, SourceType
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.graph import (
    Entity,
    GraphExtractionResult,
    Relationship,
)
from app.services.extractor import MockGraphExtractor
from app.services.graph import InMemoryGraphStore, Neo4jGraphStore, get_graph_store
from app.services.pipeline import process_source_pipeline


@pytest.mark.asyncio
async def test_mock_graph_extractor():
    """Verify rule-based entity extraction and heuristic classification."""
    extractor = MockGraphExtractor()
    text = "Alice manages Project Titan which depends on Postgres DB."
    res = await extractor.extract_graph(text)

    names = [e.name for e in res.entities]
    assert "Alice" in names
    assert any("Titan" in n for n in names)
    assert any("Postgres" in n or "DB" in n for n in names)
    assert len(res.relationships) >= 1


@pytest.mark.asyncio
async def test_in_memory_graph_store():
    """Verify in-memory graph store upsert, multi-hop BFS, and tenant isolation."""
    store = InMemoryGraphStore()

    tenant_a = 101
    tenant_b = 202

    # Graph 1: Alice -> Project Titan
    g1 = GraphExtractionResult(
        entities=[
            Entity(name="Alice", type="PERSON", description="Lead architect"),
            Entity(name="Project Titan", type="PROJECT", description="Migration initiative"),
        ],
        relationships=[
            Relationship(source="Alice", target="Project Titan", relation_type="MANAGES")
        ],
    )

    # Graph 2: Project Titan -> Hydra Auth
    g2 = GraphExtractionResult(
        entities=[
            Entity(name="Project Titan", type="PROJECT", description="Migration initiative"),
            Entity(name="Hydra Auth", type="TECHNOLOGY", description="OAuth2 identity engine"),
        ],
        relationships=[
            Relationship(source="Project Titan", target="Hydra Auth", relation_type="DEPENDS_ON")
        ],
    )

    await store.insert_graph(tenant_id=tenant_a, source_id=1, chunk_id=10, graph=g1)
    await store.insert_graph(tenant_id=tenant_a, source_id=2, chunk_id=11, graph=g2)

    # Verify deduplication and stats
    stats_a = await store.get_stats(tenant_a)
    assert stats_a.node_count == 3  # Alice, Project Titan, Hydra Auth
    assert stats_a.edge_count == 2  # MANAGES, DEPENDS_ON

    # 1-hop query from Alice
    hop1 = await store.get_neighborhood(tenant_id=tenant_a, entity_names=["Alice"], max_hops=1)
    hop1_names = {n.name for n in hop1.nodes}
    assert "Alice" in hop1_names
    assert "Project Titan" in hop1_names
    assert "Hydra Auth" not in hop1_names
    assert len(hop1.edges) == 1

    # 2-hop query from Alice
    hop2 = await store.get_neighborhood(tenant_id=tenant_a, entity_names=["Alice"], max_hops=2)
    hop2_names = {n.name for n in hop2.nodes}
    assert "Alice" in hop2_names
    assert "Project Titan" in hop2_names
    assert "Hydra Auth" in hop2_names
    assert len(hop2.edges) == 2

    # Strict Tenant Isolation: Tenant B must see nothing
    stats_b = await store.get_stats(tenant_b)
    assert stats_b.node_count == 0
    neigh_b = await store.get_neighborhood(tenant_id=tenant_b, entity_names=["Alice"], max_hops=2)
    assert len(neigh_b.nodes) == 0
    assert len(neigh_b.edges) == 0

    # Source-specific deletion
    await store.delete_tenant_source_graph(tenant_id=tenant_a, source_id=2)
    stats_a_after = await store.get_stats(tenant_a)
    # Hydra Auth had only source_id=2, so it should be pruned
    assert stats_a_after.node_count == 2
    assert stats_a_after.edge_count == 1

    # Purge entire tenant
    await store.delete_tenant_graph(tenant_a)
    stats_a_final = await store.get_stats(tenant_a)
    assert stats_a_final.node_count == 0


@pytest.mark.asyncio
async def test_neo4j_graph_store_if_available():
    """Verify live Neo4j store when Docker container is accessible."""
    try:
        store = Neo4jGraphStore(
            uri=settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        )
        await store.driver.verify_connectivity()
    except Exception:
        pytest.skip("Neo4j database not reachable; skipping live Neo4j integration test.")

    test_tenant = 99999
    try:
        g = GraphExtractionResult(
            entities=[
                Entity(name="NeoNode1", type="CONCEPT", description="First test node"),
                Entity(name="NeoNode2", type="TECHNOLOGY", description="Second test node"),
            ],
            relationships=[
                Relationship(source="NeoNode1", target="NeoNode2", relation_type="LINKS_TO")
            ],
        )
        await store.insert_graph(tenant_id=test_tenant, source_id=50, chunk_id=500, graph=g)

        stats = await store.get_stats(test_tenant)
        assert stats.node_count >= 2
        assert stats.edge_count >= 1

        neigh = await store.get_neighborhood(test_tenant, ["NeoNode1"], max_hops=1)
        names = {n.name for n in neigh.nodes}
        assert "NeoNode1" in names
        assert "NeoNode2" in names

        # Tenant isolation check
        isolated = await store.get_neighborhood(tenant_id=88888, entity_names=["NeoNode1"], max_hops=1)
        assert len(isolated.nodes) == 0
    finally:
        await store.delete_tenant_graph(test_tenant)
        await store.driver.close()


@pytest.mark.asyncio
async def test_graph_endpoints_and_cross_tenant_isolation(client: AsyncClient, db_session: AsyncSession):
    """Verify /graph/neighborhood and /graph/stats endpoints with multi-tenant isolation."""
    import io

    # 1. Register Tenant A and Tenant B
    res_a = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "GraphCorp Alpha",
            "tenant_slug": "alpha",
            "admin_email": "alpha_lead@corp.com",
            "admin_password": "Password123!",
            "admin_name": "Alpha Lead",
        },
    )
    assert res_a.status_code == 201
    token_a = res_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    res_b = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "GraphCorp Beta",
            "tenant_slug": "beta",
            "admin_email": "beta_lead@corp.com",
            "admin_password": "Password123!",
            "admin_name": "Beta Lead",
        },
    )
    assert res_b.status_code == 201
    token_b = res_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 2. Ingest a document for Tenant A that triggers graph extraction
    doc_text = "Alice leads Project Titan at GraphCorp Alpha. Project Titan uses Postgres DB for storage."
    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers=headers_a,
        files={"file": ("architecture.txt", io.BytesIO(doc_text.encode("utf-8")), "text/plain")},
    )
    assert upload_res.status_code == 201
    source_id = upload_res.json()["id"]

    # Background task or manual run
    await process_source_pipeline(source_id=source_id)

    # 3. Check /graph/stats for Tenant A
    stats_res = await client.get("/api/v1/graph/stats", headers=headers_a)
    assert stats_res.status_code == 200
    stats_data = stats_res.json()
    assert stats_data["node_count"] > 0

    # 4. Check /graph/neighborhood for Tenant A
    neigh_res = await client.post(
        "/api/v1/graph/neighborhood",
        headers=headers_a,
        json={"entity_names": ["Alice"], "max_hops": 2, "limit": 10},
    )
    assert neigh_res.status_code == 200
    neigh_data = neigh_res.json()
    node_names = [n["name"] for n in neigh_data["nodes"]]
    assert "Alice" in node_names

    # 5. Cross-Tenant Isolation: Tenant B querying for 'Alice' gets nothing
    b_neigh_res = await client.post(
        "/api/v1/graph/neighborhood",
        headers=headers_b,
        json={"entity_names": ["Alice"], "max_hops": 2, "limit": 10},
    )
    assert b_neigh_res.status_code == 200
    b_data = b_neigh_res.json()
    assert len(b_data["nodes"]) == 0
    assert len(b_data["edges"]) == 0

    # 6. Tenant B stats should be 0
    b_stats_res = await client.get("/api/v1/graph/stats", headers=headers_b)
    assert b_stats_res.status_code == 200
    assert b_stats_res.json()["node_count"] == 0
    assert b_stats_res.json()["edge_count"] == 0

    # 7. Unauthenticated check
    unauth = await client.get("/api/v1/graph/stats")
    assert unauth.status_code == 401
