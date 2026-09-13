import json
from unittest.mock import MagicMock, patch
import pytest

from app.schemas.graph import GraphEdge, GraphNeighborhoodResponse, GraphNode
from app.schemas.search import SearchResult
from app.schemas.synthesis import SynthesisResult
from app.services.synthesis import (
    BaseRAGSynthesizer,
    GeminiRAGSynthesizer,
    MockRAGSynthesizer,
    get_rag_synthesizer,
)


@pytest.mark.asyncio
async def test_synthesizer_complete_match():
    """Verify complete match synthesizes chunks and graph edges with follow-up suggestions."""
    synthesizer = MockRAGSynthesizer()

    chunks = [
        SearchResult(
            chunk_id=1,
            source_id=10,
            source_name="Architecture Guide",
            content="Project Titan manages core API token security with Hydra Auth.",
            score=0.95,
            distance=0.05,
            chunk_index=0,
        )
    ]
    graph = GraphNeighborhoodResponse(
        nodes=[GraphNode(name="Project Titan", type="PROJECT"), GraphNode(name="Hydra Auth", type="TECHNOLOGY")],
        edges=[GraphEdge(source="Project Titan", target="Hydra Auth", type="DEPENDS_ON", weight=1)],
    )

    result = await synthesizer.synthesize(
        query="How does Project Titan handle security?",
        chunks=chunks,
        graph=graph,
    )

    assert isinstance(result, SynthesisResult)
    assert result.match_type == "complete"
    assert result.needs_clarification is False
    assert len(result.follow_up_suggestions) >= 2
    assert "Architecture Guide" in result.answer
    assert "Hydra Auth" in result.answer


@pytest.mark.asyncio
async def test_synthesizer_partial_match_delineation():
    """Verify partial match delineates confirmed facts versus missing details with clarifying question."""
    synthesizer = MockRAGSynthesizer()

    # Chunks provided, but no graph edges confirming relationships
    chunks = [
        SearchResult(
            chunk_id=2,
            source_id=12,
            source_name="Deployment Doc",
            content="Staging deployment runs on port 8080.",
            score=0.82,
            distance=0.18,
            chunk_index=0,
        )
    ]
    empty_graph = GraphNeighborhoodResponse(nodes=[], edges=[])

    result = await synthesizer.synthesize(
        query="What is the production deployment port and database replica topology?",
        chunks=chunks,
        graph=empty_graph,
    )

    assert isinstance(result, SynthesisResult)
    assert result.match_type == "partial"
    assert result.needs_clarification is True
    assert "Based on your organization's documentation" in result.answer
    assert "However, the records do not detail" in result.answer
    assert len(result.follow_up_suggestions) >= 1


@pytest.mark.asyncio
async def test_synthesizer_zero_match_with_candidate_concepts():
    """Verify zero match bridges knowledge gap using candidate concepts and avoids generic refusal."""
    synthesizer = MockRAGSynthesizer()

    empty_chunks = []
    empty_graph = GraphNeighborhoodResponse(nodes=[], edges=[])
    candidates = ["Project Titan", "Hydra Auth", "OAuth2 Gateway"]

    query = "How do I configure quantum encryption in our clusters?"
    result = await synthesizer.synthesize(
        query=query,
        chunks=empty_chunks,
        graph=empty_graph,
        candidate_concepts=candidates,
    )

    assert isinstance(result, SynthesisResult)
    assert result.match_type == "zero_match"
    assert result.needs_clarification is True
    # Rule 3: Must NOT state generic non-answers like "I don't know" or "Insufficient information."
    assert "insufficient information" not in result.answer.lower()
    assert "i don't know" not in result.answer.lower()
    # Must state clear missing notice and bridge to candidate entities
    assert "I could not find records directly answering" in result.answer
    assert "related entities in your knowledge graph" in result.answer
    assert any("Project Titan" in s for s in result.follow_up_suggestions)


@pytest.mark.asyncio
async def test_synthesizer_zero_match_without_candidate_concepts():
    """Verify zero match without candidate concepts returns clean missing notice without generic refusal."""
    synthesizer = MockRAGSynthesizer()

    result = await synthesizer.synthesize(
        query="What is the moon flight schedule?",
        chunks=[],
        graph=GraphNeighborhoodResponse(),
        candidate_concepts=[],
    )

    assert isinstance(result, SynthesisResult)
    assert result.match_type == "zero_match"
    assert result.needs_clarification is True
    assert "I could not find records directly answering" in result.answer
    assert "insufficient information" not in result.answer.lower()


@pytest.mark.asyncio
async def test_gemini_synthesizer_structured_output_mocked():
    """Verify GeminiRAGSynthesizer parses structured JSON conforming to SynthesisResult."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForSynthesisTests")

    mock_json = json.dumps({
        "answer": "Project Titan integrates Hydra Auth for OAuth2 security.",
        "follow_up_suggestions": [
            "Explore Hydra Auth token revocation policies",
            "Inspect Project Titan rate limiting configurations"
        ],
        "needs_clarification": False,
        "match_type": "complete"
    })

    mock_response = MagicMock()
    mock_response.text = mock_json

    with patch.object(synthesizer.client.models, "generate_content", return_value=mock_response) as mock_gen:
        result = await synthesizer.synthesize(
            query="Tell me about Project Titan security",
            chunks=[],
            graph=GraphNeighborhoodResponse(),
            persona_tone="technical",
        )
        assert mock_gen.called
        assert isinstance(result, SynthesisResult)
        assert result.match_type == "complete"
        assert result.needs_clarification is False
        assert len(result.follow_up_suggestions) == 2


@pytest.mark.asyncio
async def test_gemini_synthesizer_fallback_on_error():
    """Verify Gemini synthesizer falls back to MockRAGSynthesizer on API error or quota limit."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForSynthesisTests")

    with patch.object(synthesizer.client.models, "generate_content", side_effect=Exception("429 RESOURCE_EXHAUSTED")):
        result = await synthesizer.synthesize(
            query="Any questions?",
            chunks=[],
            graph=GraphNeighborhoodResponse(),
            candidate_concepts=["Project Titan"]
        )
        assert isinstance(result, SynthesisResult)
        assert result.match_type == "zero_match"
        assert "I could not find records directly answering" in result.answer


@pytest.mark.asyncio
async def test_grounded_synthesis_chat_endpoints(client, db_session):
    """Verify follow_up_suggestions and needs_clarification in authenticated multi-turn chat endpoint."""
    # 1. Register tenant
    res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "SynthesisCorp",
            "tenant_slug": "synthesiscorp",
            "admin_email": "admin@synth.com",
            "admin_password": "Password123!",
            "admin_name": "Admin Synth",
        },
    )
    assert res.status_code == 201
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    # Ingest document
    await client.post(
        "/api/v1/sources/raw-text",
        headers=headers,
        json={
            "name": "Infra Security",
            "content": "Project Titan integrates Hydra Auth for OAuth2 security.",
        },
    )

    # 2. Create conversation
    conv_res = await client.post(
        "/api/v1/chat/conversations",
        headers=headers,
        json={"title": "Synthesis Test"}
    )
    assert conv_res.status_code == 201
    conv_id = conv_res.json()["id"]

    # 3. Ask question matching ingested document -> Partial or Complete match with follow-up suggestions
    msg_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"message": "What does Project Titan use for authentication?"}
    )
    assert msg_res.status_code == 201
    data = msg_res.json()
    assert len(data["content"]) > 0
    assert len(data["follow_up_suggestions"]) >= 1
    assert "needs_clarification" in data
