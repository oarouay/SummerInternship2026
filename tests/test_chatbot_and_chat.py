import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import patch, AsyncMock

from app.services.pipeline import process_source_pipeline


@pytest.mark.asyncio
async def test_chatbot_settings_crud_and_isolation(client: AsyncClient, db_session: AsyncSession):
    """Verify GET and PUT /api/v1/chatbot/settings with tenant isolation."""
    # Register Tenant A
    res_a = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "SettingsCorp A",
            "tenant_slug": "settingsa",
            "admin_email": "admin_a@settings.com",
            "admin_password": "Password123!",
            "admin_name": "Admin A",
        },
    )
    token_a = res_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # Register Tenant B
    res_b = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "SettingsCorp B",
            "tenant_slug": "settingsb",
            "admin_email": "admin_b@settings.com",
            "admin_password": "Password123!",
            "admin_name": "Admin B",
        },
    )
    token_b = res_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 1. Get default settings for Tenant A
    get_res = await client.get("/api/v1/chatbot/settings", headers=headers_a)
    assert get_res.status_code == 200
    cfg = get_res.json()
    assert cfg["name"] == "OmniGraph Assistant"
    assert cfg["tone"] == "professional"

    # 2. Update settings for Tenant A including custom Gemini API key
    update_payload = {
        "name": "TitanBot",
        "tone": "technical",
        "welcome_message": "Welcome to Titan security engineering.",
        "default_top_k": 6,
        "default_max_hops": 3,
        "gemini_api_key": "AIzaSyDummyTestKey12345",
    }
    put_res = await client.put("/api/v1/chatbot/settings", headers=headers_a, json=update_payload)
    assert put_res.status_code == 200
    updated_cfg = put_res.json()
    assert updated_cfg["name"] == "TitanBot"
    assert updated_cfg["tone"] == "technical"
    assert updated_cfg["default_top_k"] == 6
    assert updated_cfg["has_custom_api_key"] is True
    assert updated_cfg["gemini_api_key_preview"] == "••••••••2345"
    assert "AIzaSyDummyTestKey12345" not in str(updated_cfg)  # Ensure raw secret is never leaked

    # 3. Verify Tenant B's settings remain untouched
    b_cfg_res = await client.get("/api/v1/chatbot/settings", headers=headers_b)
    assert b_cfg_res.status_code == 200
    b_cfg = b_cfg_res.json()
    assert b_cfg["name"] == "OmniGraph Assistant"
    assert b_cfg["tone"] == "professional"
    assert b_cfg["has_custom_api_key"] is False

    # 4. Revert key for Tenant A
    revert_res = await client.put("/api/v1/chatbot/settings", headers=headers_a, json={"gemini_api_key": ""})
    assert revert_res.status_code == 200
    assert revert_res.json()["has_custom_api_key"] is False

    # 5. Test validate-gemini-key endpoint (empty / no key case)
    val_res = await client.post("/api/v1/chatbot/validate-gemini-key", headers=headers_a, json={})
    assert val_res.status_code == 200


@pytest.mark.asyncio
async def test_multi_turn_conversations_and_isolation(client: AsyncClient, db_session: AsyncSession):
    """Verify multi-turn chat sessions, conversation memory, and cross-tenant isolation."""
    # Register Tenant A and B
    res_a = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "ChatCorp A",
            "tenant_slug": "chata",
            "admin_email": "chat_a@corp.com",
            "admin_password": "Password123!",
            "admin_name": "Chat A",
        },
    )
    headers_a = {"Authorization": f"Bearer {res_a.json()['access_token']}"}

    res_b = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "ChatCorp B",
            "tenant_slug": "chatb",
            "admin_email": "chat_b@corp.com",
            "admin_password": "Password123!",
            "admin_name": "Chat B",
        },
    )
    headers_b = {"Authorization": f"Bearer {res_b.json()['access_token']}"}

    # Ingest document for Tenant A
    await client.post(
        "/api/v1/sources/raw-text",
        headers=headers_a,
        json={
            "name": "Cloud Infra",
            "content": "Project Titan is overseen by Alice. It depends on Hydra Auth for token security.",
        },
    )

    # 1. Create a conversation
    conv_res = await client.post(
        "/api/v1/chat/conversations",
        headers=headers_a,
        json={"title": "Titan Architecture Discussion"}
    )
    assert conv_res.status_code == 201
    conv_id = conv_res.json()["id"]

    # 2. Send Turn 1
    msg1_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers_a,
        json={"message": "Who oversees Project Titan?"}
    )
    assert msg1_res.status_code == 201
    msg1_data = msg1_res.json()
    assert msg1_data["role"] == "assistant"
    assert len(msg1_data["content"]) > 0

    # 3. Send Turn 2 (follow-up referencing context)
    msg2_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers_a,
        json={"message": "And what does it depend on?"}
    )
    assert msg2_res.status_code == 201
    msg2_data = msg2_res.json()
    assert msg2_data["role"] == "assistant"

    # 4. Fetch conversation history -> should contain 4 messages (2 user + 2 assistant)
    detail_res = await client.get(f"/api/v1/chat/conversations/{conv_id}", headers=headers_a)
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert len(detail["messages"]) == 4
    assert detail["messages"][0]["role"] == "user"
    assert detail["messages"][1]["role"] == "assistant"
    assert detail["messages"][2]["role"] == "user"
    assert detail["messages"][3]["role"] == "assistant"

    # 5. Cross-tenant check: Tenant B cannot access Tenant A's conversation
    b_get_res = await client.get(f"/api/v1/chat/conversations/{conv_id}", headers=headers_b)
    assert b_get_res.status_code == 404

    b_msg_res = await client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=headers_b,
        json={"message": "Hacking conversation"}
    )
    assert b_msg_res.status_code == 404

    # 6. Delete conversation
    del_res = await client.delete(f"/api/v1/chat/conversations/{conv_id}", headers=headers_a)
    assert del_res.status_code == 200

    # Verify 404 after deletion
    after_del = await client.get(f"/api/v1/chat/conversations/{conv_id}", headers=headers_a)
    assert after_del.status_code == 404


@pytest.mark.asyncio
async def test_url_crawling_and_ssrf_protection(client: AsyncClient, db_session: AsyncSession):
    """Verify URL crawling endpoint with strict SSRF protection."""
    # Register tenant
    reg_res = await client.post(
        "/api/v1/auth/register-tenant",
        json={
            "tenant_name": "WebCorp",
            "tenant_slug": "webcorp",
            "admin_email": "web@corp.com",
            "admin_password": "Password123!",
            "admin_name": "Web Admin",
        },
    )
    headers = {"Authorization": f"Bearer {reg_res.json()['access_token']}"}

    # 1. SSRF Attack: Localhost
    ssrf_local = await client.post(
        "/api/v1/sources/crawl",
        headers=headers,
        json={"url": "http://localhost:8000/health"}
    )
    assert ssrf_local.status_code == 400
    assert "localhost" in ssrf_local.text.lower() or "restricted" in ssrf_local.text.lower()

    # 2. SSRF Attack: Loopback IP
    ssrf_ip = await client.post(
        "/api/v1/sources/crawl",
        headers=headers,
        json={"url": "http://127.0.0.1:7687"}
    )
    assert ssrf_ip.status_code == 400

    # 3. SSRF Attack: Cloud metadata
    ssrf_meta = await client.post(
        "/api/v1/sources/crawl",
        headers=headers,
        json={"url": "http://169.254.169.254/latest/meta-data"}
    )
    assert ssrf_meta.status_code == 400

    # 4. Valid Web Crawl with Mocked fetch
    mock_html_content = (
        "FastAPI is a modern, fast web framework for building APIs with Python. "
        "It supports asynchronous request handling and automated OpenAPI documentation."
    )
    with patch("app.api.v1.endpoints.sources.fetch_and_clean_url", new=AsyncMock(return_value=("FastAPI Documentation", mock_html_content))):
        crawl_res = await client.post(
            "/api/v1/sources/crawl",
            headers=headers,
            json={"url": "https://fastapi.tiangolo.com/tutorial/"}
        )
        assert crawl_res.status_code == 201
        source_data = crawl_res.json()
        assert source_data["name"] == "FastAPI Documentation"
        assert source_data["source_type"] == "url"
        assert source_data["status"] == "pending"

        # Run pipeline
        await process_source_pipeline(source_id=source_data["id"])

        # Check detail
        get_src = await client.get(f"/api/v1/sources/{source_data['id']}", headers=headers)
        assert get_src.status_code == 200
        assert get_src.json()["status"] == "indexed"
