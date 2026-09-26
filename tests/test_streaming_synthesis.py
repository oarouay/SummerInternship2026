import asyncio
import json
from unittest.mock import MagicMock, patch
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.graph import GraphEdge, GraphNeighborhoodResponse, GraphNode
from app.schemas.search import SearchResult
from app.services.synthesis import (
    GeminiRAGSynthesizer,
    MockRAGSynthesizer,
)


@pytest.fixture(autouse=True)
def reset_gemini_quota():
    GeminiRAGSynthesizer._quota_cooldown_until = 0.0
    yield
    GeminiRAGSynthesizer._quota_cooldown_until = 0.0


@pytest.mark.asyncio
async def test_mock_synthesizer_stream_tokens_and_metadata():
    """Verify MockRAGSynthesizer.synthesize_stream yields incremental tokens and exactly one final metadata event."""
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

    tokens = []
    metadata_events = []

    async for event in synthesizer.synthesize_stream(
        query="How does Project Titan handle security?",
        chunks=chunks,
        graph=graph,
    ):
        if event["type"] == "token":
            tokens.append(event["text"])
        elif event["type"] == "metadata":
            metadata_events.append(event)

    # 1. Incremental token delivery
    assert len(tokens) > 1
    streamed_answer = "".join(tokens)
    assert "Architecture Guide" in streamed_answer
    assert "Hydra Auth" in streamed_answer

    # Compare with non-streaming synthesize()
    static_result = await synthesizer.synthesize(
        query="How does Project Titan handle security?",
        chunks=chunks,
        graph=graph,
    )
    assert streamed_answer == static_result.answer

    # 2. Exactly one terminal metadata event
    assert len(metadata_events) == 1
    meta = metadata_events[0]
    assert meta["match_type"] == "complete"
    assert meta["needs_clarification"] is False
    assert len(meta["follow_up_suggestions"]) >= 2


@pytest.mark.asyncio
async def test_gemini_synthesizer_stream_mocked():
    """Verify GeminiRAGSynthesizer.synthesize_stream yields partial tokens from generate_content_stream and metadata from classification call."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForStreamingTests")

    # Mock chunk stream
    chunk1 = MagicMock()
    chunk1.text = "Project Titan uses "
    chunk2 = MagicMock()
    chunk2.text = "Hydra Auth for tokens."

    # Mock non-streaming classification call for metadata
    mock_meta_response = MagicMock()
    mock_meta_response.text = json.dumps({
        "match_type": "complete",
        "needs_clarification": False,
        "follow_up_suggestions": ["Explore Hydra Auth scopes", "Review Titan architecture"],
    })

    with patch.object(synthesizer.client.models, "generate_content_stream", return_value=[chunk1, chunk2]) as mock_stream, \
         patch.object(synthesizer.client.models, "generate_content", return_value=mock_meta_response) as mock_classify:

        tokens = []
        metadata_events = []

        async for event in synthesizer.synthesize_stream(
            query="Tell me about Project Titan",
            chunks=[],
            graph=GraphNeighborhoodResponse(),
            persona_tone="technical",
        ):
            if event["type"] == "token":
                tokens.append(event["text"])
            elif event["type"] == "metadata":
                metadata_events.append(event)

        assert mock_stream.called
        assert mock_classify.called
        assert tokens == ["Project Titan uses ", "Hydra Auth for tokens."]
        assert len(metadata_events) == 1
        meta = metadata_events[0]
        assert meta["match_type"] == "complete"
        assert meta["needs_clarification"] is False
        assert len(meta["follow_up_suggestions"]) == 2


@pytest.mark.asyncio
async def test_gemini_stream_429_quota_fallback():
    """Verify GeminiRAGSynthesizer falls back to Mock synthesizer stream and sets cooldown on 429 error."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForStreamingTests")

    with patch.object(
        synthesizer.client.models,
        "generate_content_stream",
        side_effect=Exception("429 RESOURCE_EXHAUSTED: Quota exceeded"),
    ):
        tokens = []
        metadata_events = []

        async for event in synthesizer.synthesize_stream(
            query="Test query",
            chunks=[],
            graph=GraphNeighborhoodResponse(),
        ):
            if event["type"] == "token":
                tokens.append(event["text"])
            elif event["type"] == "metadata":
                metadata_events.append(event)

        assert len(tokens) > 0
        assert len(metadata_events) == 1
        assert synthesizer._quota_cooldown_until > 0.0


@pytest.mark.asyncio
async def test_gemini_stream_503_retry_once():
    """Verify GeminiRAGSynthesizer retries once on 503 before succeeding."""
    synthesizer = GeminiRAGSynthesizer(api_key="AIzaSyMockKeyForStreamingTests")

    chunk = MagicMock()
    chunk.text = "Recovered answer from retry."

    mock_meta_response = MagicMock()
    mock_meta_response.text = json.dumps({
        "match_type": "partial",
        "needs_clarification": False,
        "follow_up_suggestions": ["Explore related topic"],
    })

    call_count = 0

    def mock_stream_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise Exception("503 UNAVAILABLE: Server overloaded")
        return [chunk]

    with patch.object(synthesizer.client.models, "generate_content_stream", side_effect=mock_stream_effect), \
         patch.object(synthesizer.client.models, "generate_content", return_value=mock_meta_response):

        tokens = []
        metadata_events = []

        async for event in synthesizer.synthesize_stream(
            query="Retry test",
            chunks=[],
            graph=GraphNeighborhoodResponse(),
        ):
            if event["type"] == "token":
                tokens.append(event["text"])
            elif event["type"] == "metadata":
                metadata_events.append(event)

        assert call_count == 2
        assert "".join(tokens) == "Recovered answer from retry."
        assert len(metadata_events) == 1


@pytest.mark.asyncio
async def test_sse_chat_conversation_streaming_endpoint(client: AsyncClient, db_session: AsyncSession):
    """Verify SSE streaming chat endpoint POST /conversations/{id}/messages/stream emits token, metadata, done events and persists message."""
    # 1. Register tenant
    res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "StreamCorp",
            "tenant_slug": "streamcorp",
            "admin_email": "admin@streamcorp.com",
            "admin_password": "Password123!",
            "admin_name": "Admin Stream",
        },
    )
    assert res.status_code == 201
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    # Ingest document
    await client.post(
        "/api/v1/sources/raw-text",
        headers=headers,
        json={
            "name": "Stream Specs",
            "content": "StreamCorp uses SSE protocol for real-time telemetry streaming.",
        },
    )

    # 2. Create conversation
    conv_res = await client.post(
        "/api/v1/chat/conversations",
        headers=headers,
        json={"title": "SSE Conversation"}
    )
    assert conv_res.status_code == 201
    conv_id = conv_res.json()["id"]

    # 3. Stream chat message
    events_received = []
    token_texts = []
    metadata_received = None

    async with client.stream(
        "POST",
        f"/api/v1/chat/conversations/{conv_id}/messages/stream",
        headers=headers,
        json={"message": "What protocol does StreamCorp use for telemetry?"}
    ) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

        current_event = None
        async for line in response.aiter_lines():
            line = line.strip()
            if not line:
                current_event = None
                continue
            if line.startswith("event:"):
                current_event = line.replace("event:", "").strip()
                events_received.append(current_event)
            elif line.startswith("data:"):
                raw_data = line.replace("data:", "").strip()
                data = json.loads(raw_data) if raw_data else {}
                if current_event == "token":
                    token_texts.append(data.get("text", ""))
                elif current_event == "metadata":
                    metadata_received = data

    assert "token" in events_received
    assert "metadata" in events_received
    assert "done" in events_received
    assert len(token_texts) > 0
    assert metadata_received is not None
    assert "follow_up_suggestions" in metadata_received

    # 4. Verify message persistence in conversation
    get_conv = await client.get(f"/api/v1/chat/conversations/{conv_id}", headers=headers)
    assert get_conv.status_code == 200
    conv_data = get_conv.json()
    assert len(conv_data["messages"]) == 2  # user + assistant
    assistant_msg = conv_data["messages"][1]
    assert assistant_msg["role"] == "assistant"
    assert len(assistant_msg["content"]) > 0
    assert "".join(token_texts) == assistant_msg["content"]


@pytest.mark.asyncio
async def test_sse_public_widget_streaming_endpoint(client: AsyncClient, db_session: AsyncSession):
    """Verify public widget SSE endpoint /api/v1/chat/public/{tenant_slug}/message/stream streams without authentication."""
    # 1. Register tenant
    res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "PublicWidgetCorp",
            "tenant_slug": "widgetcorp",
            "admin_email": "admin@widgetcorp.com",
            "admin_password": "Password123!",
            "admin_name": "Admin Widget",
        },
    )
    assert res.status_code == 201

    events_received = []
    async with client.stream(
        "POST",
        "/api/v1/chat/public/widgetcorp/message/stream",
        json={"message": "Hello from website visitor!", "history": []}
    ) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

        async for line in response.aiter_lines():
            line = line.strip()
            if line.startswith("event:"):
                events_received.append(line.replace("event:", "").strip())

    assert "token" in events_received
    assert "done" in events_received
