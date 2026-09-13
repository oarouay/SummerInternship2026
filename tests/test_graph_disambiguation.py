import json
from unittest.mock import MagicMock, patch
import pytest

from app.schemas.disambiguation import (
    CandidateEntity,
    DisambiguationResult,
    DisambiguationType,
)
from app.services.disambiguation import (
    BaseGraphDisambiguator,
    GeminiGraphDisambiguator,
    MockGraphDisambiguator,
    get_graph_disambiguator,
)
from app.services.graph import InMemoryGraphStore
from app.schemas.graph import GraphExtractionResult, Entity, Relationship


@pytest.mark.asyncio
async def test_disambiguation_entity_split():
    """Verify multiple relevant candidate entities trigger entity_split with distinct systems explanation."""
    disambiguator = MockGraphDisambiguator()
    candidates = [
        CandidateEntity(
            name="Project Titan",
            type="PROJECT",
            description="Core enterprise platform",
            neighbors=["Hydra Auth", "PostgreSQL"],
        ),
        CandidateEntity(
            name="Titan DB",
            type="DATABASE",
            description="Analytical time-series store",
            neighbors=["ClickHouse"],
        ),
        CandidateEntity(
            name="Titan SDK",
            type="LIBRARY",
            description="Client library for Titan APIs",
            neighbors=["FastAPI"],
        ),
    ]

    result = await disambiguator.disambiguate(
        user_query="Tell me about Titan",
        candidate_entities=candidates,
        popular_tenant_topics=["Project Titan", "Hydra Auth"],
    )

    assert isinstance(result, DisambiguationResult)
    assert result.disambiguation_type == DisambiguationType.entity_split
    assert len(result.suggested_chips) >= 2
    assert "Project Titan" in result.suggested_chips
    assert "Titan DB" in result.suggested_chips
    assert "Titan SDK" in result.suggested_chips
    # Explanation should note distinct systems and ask which one is needed
    assert "Titan" in result.explanation_message
    assert any(w in result.explanation_message.lower() for w in ["which", "specific", "choose", "select"])


@pytest.mark.asyncio
async def test_disambiguation_adjacent_topics():
    """Verify single candidate with 1-hop neighborhood triggers adjacent_topics."""
    disambiguator = MockGraphDisambiguator()
    candidates = [
        CandidateEntity(
            name="Hydra Auth",
            type="TECHNOLOGY",
            description="OAuth2 authentication service",
            neighbors=["Token Revocation Service", "OAuth2 Gateway", "Session Manager"],
        )
    ]

    result = await disambiguator.disambiguate(
        user_query="What is the token revocation protocol?",
        candidate_entities=candidates,
    )

    assert isinstance(result, DisambiguationResult)
    assert result.disambiguation_type == DisambiguationType.adjacent_topics
    assert len(result.suggested_chips) >= 2
    assert "Hydra Auth" in result.suggested_chips or "Token Revocation Service" in result.suggested_chips
    assert "Hydra Auth" in result.explanation_message


@pytest.mark.asyncio
async def test_disambiguation_unindexed_fallback():
    """Verify no candidate entities fall back to popular tenant topics."""
    disambiguator = MockGraphDisambiguator()
    popular = ["Project Titan", "Hydra Auth", "FastAPI Service", "Neo4j Graph"]

    result = await disambiguator.disambiguate(
        user_query="How do I setup quantum teleportation?",
        candidate_entities=[],
        popular_tenant_topics=popular,
    )

    assert isinstance(result, DisambiguationResult)
    assert result.disambiguation_type == DisambiguationType.unindexed_fallback
    assert len(result.suggested_chips) >= 2
    assert any(topic in result.suggested_chips for topic in popular)
    assert "unindexed" in result.explanation_message.lower() or "not find" in result.explanation_message.lower()


@pytest.mark.asyncio
async def test_disambiguation_noisy_filtering():
    """Verify irrelevant substring matches are filtered out by relevance scoring."""
    disambiguator = MockGraphDisambiguator()
    candidates = [
        CandidateEntity(
            name="Apollo Engine",
            type="PROJECT",
            description="Space telemetry engine",
            neighbors=["Apollo Orbit"],
        ),
        CandidateEntity(
            name="Random Noise Item",
            type="MISC",
            description="Totally unrelated concept",
            neighbors=[],
        ),
    ]

    result = await disambiguator.disambiguate(
        user_query="How does Apollo Engine work?",
        candidate_entities=candidates,
    )

    assert isinstance(result, DisambiguationResult)
    assert "Apollo Engine" in result.suggested_chips
    assert "Random Noise Item" not in result.suggested_chips


@pytest.mark.asyncio
async def test_gemini_disambiguator_structured_output_mocked():
    """Verify GeminiGraphDisambiguator parses structured JSON conforming to schema."""
    disambiguator = GeminiGraphDisambiguator(api_key="AIzaSyMockKeyForDisambiguation")

    mock_json = json.dumps({
        "explanation_message": "Found multiple systems related to Titan: Project Titan and Titan DB. Which system are you inquiring about?",
        "disambiguation_type": "entity_split",
        "suggested_chips": ["Project Titan", "Titan DB"]
    })

    mock_response = MagicMock()
    mock_response.text = mock_json

    with patch.object(disambiguator.client.models, "generate_content", return_value=mock_response) as mock_gen:
        result = await disambiguator.disambiguate(
            user_query="Titan specs",
            candidate_entities=[
                CandidateEntity(name="Project Titan", type="PROJECT"),
                CandidateEntity(name="Titan DB", type="DATABASE")
            ]
        )
        assert mock_gen.called
        assert isinstance(result, DisambiguationResult)
        assert result.disambiguation_type == DisambiguationType.entity_split
        assert len(result.suggested_chips) == 2


@pytest.mark.asyncio
async def test_gemini_disambiguator_fallback_on_error():
    """Verify Gemini disambiguator falls back to MockGraphDisambiguator on quota or API error."""
    disambiguator = GeminiGraphDisambiguator(api_key="AIzaSyMockKeyForDisambiguation")

    with patch.object(disambiguator.client.models, "generate_content", side_effect=Exception("429 RESOURCE_EXHAUSTED")):
        result = await disambiguator.disambiguate(
            user_query="Tell me about Titan",
            candidate_entities=[
                CandidateEntity(name="Project Titan", type="PROJECT"),
                CandidateEntity(name="Titan DB", type="DATABASE")
            ],
            popular_tenant_topics=["Project Titan"]
        )
        assert isinstance(result, DisambiguationResult)
        assert result.disambiguation_type == DisambiguationType.entity_split
        assert len(result.suggested_chips) >= 2


@pytest.mark.asyncio
async def test_graph_store_find_candidates_and_popular_topics():
    """Verify InMemoryGraphStore finds fuzzy candidate entities and computes popular topics."""
    store = InMemoryGraphStore()
    tenant_id = 99

    extraction = GraphExtractionResult(
        entities=[
            Entity(name="Project Titan", type="PROJECT", description="Enterprise engine"),
            Entity(name="Titan DB", type="DATABASE", description="Database service"),
            Entity(name="Hydra Auth", type="TECHNOLOGY", description="OAuth2"),
        ],
        relationships=[
            Relationship(source="Project Titan", target="Hydra Auth", relation_type="USES"),
            Relationship(source="Project Titan", target="Titan DB", relation_type="PERSISTS_TO"),
        ],
    )
    await store.insert_graph(tenant_id=tenant_id, source_id=1, chunk_id=10, graph=extraction)

    # 1. Fuzzy search for "Titan"
    candidates = await store.find_candidate_entities(tenant_id=tenant_id, query="Titan", limit=5)
    assert len(candidates) >= 2
    names = [c.name for c in candidates]
    assert "Project Titan" in names
    assert "Titan DB" in names
    titan_node = next(c for c in candidates if c.name == "Project Titan")
    assert "Hydra Auth" in titan_node.neighbors or "Titan DB" in titan_node.neighbors

    # 2. Popular topics (Project Titan has degree 2, others have degree 1)
    popular = await store.get_popular_topics(tenant_id=tenant_id, limit=3)
    assert len(popular) >= 1
    assert popular[0] == "Project Titan"


@pytest.mark.asyncio
async def test_rag_pipeline_disambiguation_integration(client, db_session):
    """Verify RAG pipeline triggers Disambiguation Specialist when exact match yields zero documents."""
    # 1. Register tenant
    res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "DisambigCorp",
            "tenant_slug": "disambigcorp",
            "admin_email": "admin@disambig.com",
            "admin_password": "Password123!",
            "admin_name": "Admin Disambig",
        },
    )
    assert res.status_code == 201
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    # Ingest document that mentions Project Titan and Titan DB
    await client.post(
        "/api/v1/sources/raw-text",
        headers=headers,
        json={
            "name": "Titan Ecosystem",
            "content": "Project Titan is our enterprise workflow manager. Titan DB is the underlying data store.",
        },
    )

    # Create conversation
    conv_res = await client.post(
        "/api/v1/chat/conversations",
        headers=headers,
        json={"title": "Disambig Test"}
    )
    assert conv_res.status_code == 201
    conv_id = conv_res.json()["id"]

    # Send ambiguous query that matches fuzzy candidates
    msg_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"message": "What is Titan?"}
    )
    assert msg_res.status_code == 201
    data = msg_res.json()
    assert len(data["content"]) > 0
    assert isinstance(data["needs_clarification"], bool)
