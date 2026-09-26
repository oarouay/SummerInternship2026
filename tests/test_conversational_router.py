import json
from unittest.mock import MagicMock, patch
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.router import ConversationalRouteResult, RouterAction
from app.services.router import (
    BaseConversationalRouter,
    GeminiConversationalRouter,
    MockConversationalRouter,
    get_conversational_router,
)


@pytest.mark.asyncio
async def test_router_direct_response_on_greetings():
    """Verify greetings, gratitude, and closings yield direct_response without retrieval."""
    router = MockConversationalRouter()

    greetings = ["Hi", "Hello there!", "Thanks a lot!", "Goodbye"]
    for query in greetings:
        result = await router.route(query=query)
        assert isinstance(result, ConversationalRouteResult)
        assert result.action == RouterAction.DIRECT_RESPONSE
        assert result.standalone_query is None
        assert result.direct_or_clarification_message is not None
        assert len(result.direct_or_clarification_message) > 0
        assert result.clarification_options == []
        assert result.seed_entities == []


@pytest.mark.asyncio
async def test_router_clarify_on_ambiguous_queries():
    """Verify broad, underspecified queries yield clarify action with clickable options."""
    router = MockConversationalRouter()

    ambiguous_queries = [
        "How do I deploy?",
        "Show me the logs",
        "Fix the bug",
    ]
    for query in ambiguous_queries:
        result = await router.route(query=query)
        assert isinstance(result, ConversationalRouteResult)
        assert result.action == RouterAction.CLARIFY
        assert result.standalone_query is None
        assert result.direct_or_clarification_message is not None
        assert len(result.clarification_options) >= 2
        assert result.seed_entities == []


@pytest.mark.asyncio
async def test_router_retrieve_focused_query():
    """Verify focused domain query yields retrieve action with standalone query and entities."""
    router = MockConversationalRouter()

    query = "What security features are supported in Hydra Auth?"
    result = await router.route(query=query)

    assert isinstance(result, ConversationalRouteResult)
    assert result.action == RouterAction.RETRIEVE
    assert result.standalone_query is not None
    assert "Hydra Auth" in result.standalone_query
    assert result.direct_or_clarification_message is None
    assert result.clarification_options == []
    assert any("Hydra Auth" in ent for ent in result.seed_entities)


@pytest.mark.asyncio
async def test_router_coreference_resolution_with_history():
    """Verify pronouns ('it', 'they') are replaced with explicit entities from history."""
    router = MockConversationalRouter()

    history = [
        {"role": "user", "content": "Tell me about Project Titan."},
        {"role": "assistant", "content": "Project Titan is our core authentication gateway managed by Alice."},
    ]
    follow_up = "Is it secure against token revocation?"
    result = await router.route(query=follow_up, conversation_history=history)

    assert isinstance(result, ConversationalRouteResult)
    assert result.action == RouterAction.RETRIEVE
    assert result.standalone_query is not None
    assert "Project Titan" in result.standalone_query
    assert any("Project Titan" in ent for ent in result.seed_entities)


@pytest.mark.asyncio
async def test_router_seed_entity_normalization():
    """Verify casing normalization (Title Case for systems/names, UPPERCASE for acronyms)."""
    router = MockConversationalRouter()

    query = "Does hydra auth support jwt and cve remediation?"
    result = await router.route(query=query)

    assert isinstance(result, ConversationalRouteResult)
    assert result.action == RouterAction.RETRIEVE
    # Acronyms should be normalized to UPPERCASE
    assert "JWT" in result.seed_entities or any("JWT" in ent for ent in result.seed_entities)
    assert "CVE" in result.seed_entities or any("CVE" in ent for ent in result.seed_entities)


@pytest.mark.asyncio
async def test_gemini_router_structured_output_mocked():
    """Verify GeminiConversationalRouter correctly invokes LLM and parses JSON schema."""
    router = GeminiConversationalRouter(api_key="AIzaSyMockKeyForRoutingEngineTests")

    mock_llm_json = json.dumps({
        "action": "retrieve",
        "standalone_query": "What security vulnerabilities exist for Project Titan?",
        "seed_entities": ["Project Titan", "CVE"],
        "direct_or_clarification_message": None,
        "clarification_options": []
    })

    mock_response = MagicMock()
    mock_response.text = mock_llm_json

    with patch.object(router.client.models, "generate_content", return_value=mock_response) as mock_gen:
        result = await router.route(
            query="Is it secure?",
            conversation_history=[
                {"role": "user", "content": "Tell me about Project Titan."},
                {"role": "assistant", "content": "Project Titan is an authentication service."}
            ]
        )
        assert mock_gen.called
        assert result.action == RouterAction.RETRIEVE
        assert result.standalone_query == "What security vulnerabilities exist for Project Titan?"
        assert "Project Titan" in result.seed_entities
        assert "CVE" in result.seed_entities


@pytest.mark.asyncio
async def test_gemini_router_fallback_on_error():
    """Verify Gemini router falls back gracefully to Mock router on 429 quota or network errors."""
    router = GeminiConversationalRouter(api_key="AIzaSyMockKeyForRoutingEngineTests")

    with patch.object(router.client.models, "generate_content", side_effect=Exception("429 RESOURCE_EXHAUSTED")):
        result = await router.route(query="Hi!")
        assert isinstance(result, ConversationalRouteResult)
        assert result.action == RouterAction.DIRECT_RESPONSE
        assert result.direct_or_clarification_message is not None


def test_get_conversational_router_factory():
    """Verify factory returns appropriate router based on keys, else Mock router."""
    with patch("app.services.router.settings.GEMINI_API_KEY", ""), patch("app.services.router.settings.OPENAI_API_KEY", ""):
        mock_r = get_conversational_router(api_key=None)
        assert isinstance(mock_r, MockConversationalRouter)

    openai_r = get_conversational_router(api_key="sk-test-key")
    from app.services.router import OpenAIConversationalRouter
    assert isinstance(openai_r, OpenAIConversationalRouter)

    gemini_r = get_conversational_router(api_key="test-key")
    assert isinstance(gemini_r, GeminiConversationalRouter)


@pytest.mark.asyncio
async def test_conversational_routing_chat_endpoints(client: AsyncClient, db_session: AsyncSession):
    """Verify full end-to-end routing behavior in authenticated multi-turn chat endpoint."""
    # 1. Register tenant
    res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "RoutingCorp",
            "tenant_slug": "routingcorp",
            "admin_email": "admin@routingcorp.com",
            "admin_password": "Password123!",
            "admin_name": "Admin Routing",
        },
    )
    assert res.status_code == 201
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    # Ingest document
    await client.post(
        "/api/v1/sources/raw-text",
        headers=headers,
        json={
            "name": "Infra Specs",
            "content": "Project Titan handles OAuth2 authentication. It depends on Hydra Auth.",
        },
    )

    # 2. Create conversation
    conv_res = await client.post(
        "/api/v1/chat/conversations",
        headers=headers,
        json={"title": "Routing Test"}
    )
    assert conv_res.status_code == 201
    conv_id = conv_res.json()["id"]

    # 3. Send Turn 1: Greeting -> should get direct_response
    t1_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"message": "Hello there!"}
    )
    assert t1_res.status_code == 201
    t1_data = t1_res.json()
    assert t1_data["action"] == "direct_response"
    assert t1_data["clarification_options"] == []
    assert "assist" in t1_data["content"].lower() or "hello" in t1_data["content"].lower()

    # 4. Send Turn 2: Ambiguous query -> should get clarify
    t2_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"message": "How do I deploy?"}
    )
    assert t2_res.status_code == 201
    t2_data = t2_res.json()
    assert t2_data["action"] == "clarify"
    assert len(t2_data["clarification_options"]) >= 2

    # 5. Send Turn 3: Focused query -> should get retrieve
    t3_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"message": "Tell me about Project Titan."}
    )
    assert t3_res.status_code == 201
    t3_data = t3_res.json()
    assert t3_data["action"] == "retrieve"

    # 6. Send Turn 4: Follow-up with coreference -> should resolve "it" to "Project Titan"
    t4_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"message": "What does it depend on?"}
    )
    assert t4_res.status_code == 201
    t4_data = t4_res.json()
    assert t4_data["action"] == "retrieve"
    # Citations should reflect standalone query or retrieved sources
    assert t4_data["citations"]["standalone_query"] is not None
    assert "Project Titan" in t4_data["citations"]["standalone_query"]


@pytest.mark.asyncio
async def test_conversational_routing_public_endpoint(client: AsyncClient, db_session: AsyncSession):
    """Verify routing behavior on public website widget endpoint."""
    # 1. Register tenant
    res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "PublicCorp",
            "tenant_slug": "publiccorp",
            "admin_email": "admin@publiccorp.com",
            "admin_password": "Password123!",
            "admin_name": "Admin Public",
        },
    )
    assert res.status_code == 201

    # 2. Visitor sends greeting
    pub_greet = await client.post(
        "/api/v1/chat/public/publiccorp/message",
        json={"message": "Hi!"}
    )
    assert pub_greet.status_code == 200
    greet_data = pub_greet.json()
    assert greet_data["action"] == "direct_response"
    assert len(greet_data["source_citations"]) == 0

    # 3. Visitor sends ambiguous prompt
    pub_clarify = await client.post(
        "/api/v1/chat/public/publiccorp/message",
        json={"message": "Show me the logs"}
    )
    assert pub_clarify.status_code == 200
    clarify_data = pub_clarify.json()
    assert clarify_data["action"] == "clarify"
    assert len(clarify_data["clarification_options"]) >= 2
