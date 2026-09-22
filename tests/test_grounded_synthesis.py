import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.schemas.graph import GraphEdge, GraphExtractionResult, GraphNeighborhoodResponse, GraphNode
from app.schemas.search import SearchResult
from app.schemas.synthesis import SynthesisResult
from app.services.synthesis import (
    BaseRAGSynthesizer,
    GeminiRAGSynthesizer,
    MockRAGSynthesizer,
    get_rag_synthesizer,
)


@pytest.fixture(autouse=True)
def reset_gemini_quota():
    GeminiRAGSynthesizer._quota_cooldown_until = 0.0
    yield
    GeminiRAGSynthesizer._quota_cooldown_until = 0.0


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
    """Verify partial match states confirmed facts directly without asking clarifying questions when coverage is adequate."""
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
        ),
        SearchResult(
            chunk_id=3,
            source_id=13,
            source_name="Env Specs",
            content="Production gateway runs on port 443 with TLS.",
            score=0.79,
            distance=0.21,
            chunk_index=1,
        ),
    ]
    empty_graph = GraphNeighborhoodResponse(nodes=[], edges=[])

    result = await synthesizer.synthesize(
        query="What is the production deployment port and database replica topology?",
        chunks=chunks,
        graph=empty_graph,
    )

    assert isinstance(result, SynthesisResult)
    assert result.match_type == "partial"
    assert result.needs_clarification is False
    assert "Based on your organization's documentation" in result.answer
    assert "Deployment Doc" in result.answer
    assert "Env Specs" in result.answer
    assert "Which specific component" not in result.answer
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


@pytest.mark.asyncio
async def test_gemini_synthesizer_503_retry_success():
    """Verify Gemini synthesizer retries on 503/UNAVAILABLE and succeeds if second attempt passes."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForSynthesisTests")

    mock_success = MagicMock()
    mock_success.text = json.dumps({
        "answer": "Project Titan operates with TLS encryption.",
        "follow_up_suggestions": ["Explore TLS settings"],
        "needs_clarification": False,
        "match_type": "complete"
    })

    side_effects = [Exception("503 UNAVAILABLE: Server busy"), mock_success]

    with patch.object(synthesizer.client.models, "generate_content", side_effect=side_effects) as mock_gen:
        with patch("asyncio.sleep", return_value=None) as mock_sleep:
            result = await synthesizer.synthesize(
                query="Tell me about TLS in Titan",
                chunks=[],
                graph=GraphNeighborhoodResponse(),
            )
            assert mock_gen.call_count == 2
            mock_sleep.assert_called_once_with(0.8)
            assert isinstance(result, SynthesisResult)
            assert result.match_type == "complete"
            assert "TLS encryption" in result.answer


@pytest.mark.asyncio
async def test_gemini_synthesizer_503_retry_exhausted():
    """Verify Gemini synthesizer retries on 503 and falls back to mock after exhausting retry."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForSynthesisTests")

    side_effects = [Exception("503 UNAVAILABLE"), Exception("503 UNAVAILABLE")]

    with patch.object(synthesizer.client.models, "generate_content", side_effect=side_effects) as mock_gen:
        with patch("asyncio.sleep", return_value=None) as mock_sleep:
            result = await synthesizer.synthesize(
                query="Tell me about Titan",
                chunks=[
                    SearchResult(
                        chunk_id=1,
                        source_id=1,
                        source_name="Titan Specs",
                        content="Titan is an internal platform.",
                        score=0.9,
                        distance=0.1,
                        chunk_index=0,
                    )
                ],
                graph=GraphNeighborhoodResponse(),
            )
            assert mock_gen.call_count == 2
            mock_sleep.assert_called_once_with(0.8)
            assert isinstance(result, SynthesisResult)
            assert result.match_type == "partial"
            assert "Titan Specs" in result.answer


@pytest.mark.asyncio
async def test_rag_pipeline_fuzzy_entity_fallback(db_session):
    """Verify RAGPipelineService calls find_candidate_entities when detected_entities is empty."""
    from app.services.synthesis import RAGPipelineService
    from app.schemas.disambiguation import CandidateEntity
    from app.schemas.router import ConversationalRouteResult, RouterAction

    mock_router_res = ConversationalRouteResult(
        action=RouterAction.RETRIEVE,
        standalone_query="Tell me about Titan",
        seed_entities=[],
    )

    candidate = CandidateEntity(name="Project Titan", type="PROJECT", description="Auth platform")

    with patch("app.services.synthesis.get_conversational_router") as mock_gr:
        mock_r = MagicMock()
        mock_r.route = AsyncMock(return_value=mock_router_res)
        mock_gr.return_value = mock_r

        with patch("app.services.synthesis.get_graph_extractor") as mock_ge:
            mock_ext = MagicMock()
            mock_ext.extract_graph = AsyncMock(return_value=GraphExtractionResult(entities=[], relationships=[]))
            mock_ge.return_value = mock_ext

            with patch("app.services.synthesis.get_graph_store") as mock_ggs:
                mock_store = MagicMock()
                mock_store.find_candidate_entities = AsyncMock(return_value=[candidate])
                mock_store.get_neighborhood = AsyncMock(return_value=GraphNeighborhoodResponse(
                    nodes=[GraphNode(name="Project Titan", type="PROJECT")],
                    edges=[GraphEdge(source="Project Titan", target="Hydra", type="USES")]
                ))
                mock_ggs.return_value = mock_store

                with patch("app.services.synthesis.get_embedding_service") as mock_emb:
                    mock_emb.return_value.embed_query = AsyncMock(return_value=[0.1] * 768)

                    with patch("app.services.synthesis.search_similar_chunks", return_value=[]):
                        resp = await RAGPipelineService.answer_query(
                            db=db_session,
                            tenant_id=1,
                            query="Tell me about Titan"
                        )
                        mock_store.find_candidate_entities.assert_called()
                        mock_store.get_neighborhood.assert_called_with(
                            tenant_id=1,
                            entity_names=["Project Titan"],
                            max_hops=2,
                            limit=25
                        )
                        assert "Project Titan" in resp.entities_detected


@pytest.mark.asyncio
async def test_rag_pipeline_zero_match_retry_succeeds(db_session):
    """Verify zero-match triggers retry with top candidate entity and succeeds if retry returns chunks/edges."""
    from app.services.synthesis import RAGPipelineService
    from app.schemas.disambiguation import CandidateEntity
    from app.schemas.router import ConversationalRouteResult, RouterAction

    mock_router_res = ConversationalRouteResult(
        action=RouterAction.RETRIEVE,
        standalone_query="How to use the gateway?",
        seed_entities=[],
    )

    candidate = CandidateEntity(name="API Gateway", type="SERVICE", description="Entrypoint")
    retry_chunk = SearchResult(
        chunk_id=99,
        source_id=10,
        source_name="Gateway Manual",
        content="The API Gateway routes all requests to internal microservices.",
        score=0.88,
        distance=0.12,
        chunk_index=0,
    )

    with patch("app.services.synthesis.get_conversational_router") as mock_gr:
        mock_r = MagicMock()
        mock_r.route = AsyncMock(return_value=mock_router_res)
        mock_gr.return_value = mock_r

        with patch("app.services.synthesis.get_graph_extractor") as mock_ge:
            mock_ext = MagicMock()
            mock_ext.extract_graph = AsyncMock(return_value=GraphExtractionResult(entities=[], relationships=[]))
            mock_ge.return_value = mock_ext

            with patch("app.services.synthesis.get_graph_store") as mock_ggs:
                mock_store = MagicMock()
                mock_store.find_candidate_entities = AsyncMock(side_effect=[[], [candidate], []])
                mock_store.get_neighborhood = AsyncMock(return_value=GraphNeighborhoodResponse(nodes=[], edges=[]))
                mock_ggs.return_value = mock_store

                with patch("app.services.synthesis.get_embedding_service") as mock_emb:
                    mock_emb.return_value.embed_query = AsyncMock(return_value=[0.1] * 768)

                    with patch("app.services.synthesis.search_similar_chunks", side_effect=[[], [retry_chunk]]) as mock_search:
                        resp = await RAGPipelineService.answer_query(
                            db=db_session,
                            tenant_id=1,
                            query="How to use the gateway?"
                        )
                        assert mock_search.call_count == 2
                        assert len(resp.source_citations) >= 1
                        assert resp.source_citations[0].source_name == "Gateway Manual"
                        assert "Gateway Manual" in resp.answer


@pytest.mark.asyncio
async def test_rag_pipeline_zero_match_retry_also_fails(db_session):
    """Verify zero-match falls through to chip-list disambiguation when retry retrieval also fails."""
    from app.services.synthesis import RAGPipelineService
    from app.schemas.disambiguation import CandidateEntity, DisambiguationResult
    from app.schemas.router import ConversationalRouteResult, RouterAction

    mock_router_res = ConversationalRouteResult(
        action=RouterAction.RETRIEVE,
        standalone_query="Unknown topic query",
        seed_entities=[],
    )

    candidate = CandidateEntity(name="Obscure Concept", type="CONCEPT", description="No docs")

    with patch("app.services.synthesis.get_conversational_router") as mock_gr:
        mock_r = MagicMock()
        mock_r.route = AsyncMock(return_value=mock_router_res)
        mock_gr.return_value = mock_r

        with patch("app.services.synthesis.get_graph_extractor") as mock_ge:
            mock_ext = MagicMock()
            mock_ext.extract_graph = AsyncMock(return_value=GraphExtractionResult(entities=[], relationships=[]))
            mock_ge.return_value = mock_ext

            with patch("app.services.synthesis.get_graph_store") as mock_ggs:
                mock_store = MagicMock()
                mock_store.find_candidate_entities = AsyncMock(return_value=[candidate])
                mock_store.get_popular_topics = AsyncMock(return_value=["Topic Alpha"])
                mock_store.get_neighborhood = AsyncMock(return_value=GraphNeighborhoodResponse(nodes=[], edges=[]))
                mock_ggs.return_value = mock_store

                with patch("app.services.synthesis.get_embedding_service") as mock_emb:
                    mock_emb.return_value.embed_query = AsyncMock(return_value=[0.1] * 768)

                    with patch("app.services.synthesis.search_similar_chunks", side_effect=[[], []]) as mock_search:
                        with patch("app.services.synthesis.get_graph_disambiguator") as mock_gd:
                            from app.schemas.disambiguation import DisambiguationType
                            mock_dis = MagicMock()
                            mock_dis.disambiguate = AsyncMock(return_value=DisambiguationResult(
                                explanation_message="I found related entities in your knowledge graph.",
                                disambiguation_type=DisambiguationType.adjacent_topics,
                                suggested_chips=["Obscure Concept", "Topic Alpha"],
                            ))
                            mock_gd.return_value = mock_dis

                            resp = await RAGPipelineService.answer_query(
                                db=db_session,
                                tenant_id=1,
                                query="Unknown topic query"
                            )
                            assert mock_search.call_count == 2
                            assert len(resp.source_citations) == 0
                            assert len(resp.graph_citations) == 0
                            assert resp.needs_clarification is True
                            assert "Obscure Concept" in resp.follow_up_suggestions or any("Obscure Concept" in s for s in resp.follow_up_suggestions)
