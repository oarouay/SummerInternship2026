import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Test health check endpoint."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_register_tenant_and_login(client: AsyncClient):
    """Test onboarding a tenant and subsequent login."""
    # 1. Register Tenant A
    reg_payload = {
        "tenant_name": "Acme Corp",
        "tenant_slug": "acme",
        "tenant_description": "First tenant organization",
        "admin_email": "admin@acme.com",
        "admin_password": "StrongPassword123!",
        "admin_name": "Alice Acme"
    }
    reg_res = await client.post("/api/v1/auth/register-tenant", json=reg_payload)
    assert reg_res.status_code == 201, reg_res.text
    data = reg_res.json()
    assert data["tenant"]["slug"] == "acme"
    assert data["user"]["email"] == "admin@acme.com"
    assert "access_token" in data

    # 2. Login as Admin A
    login_payload = {
        "email": "admin@acme.com",
        "password": "StrongPassword123!"
    }
    login_res = await client.post("/api/v1/auth/login", json=login_payload)
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert "access_token" in token_data
    token = token_data["access_token"]

    # 3. Fetch /auth/me
    me_res = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["user"]["email"] == "admin@acme.com"
    assert me_data["tenant"]["slug"] == "acme"


@pytest.mark.asyncio
async def test_tenant_isolation(client: AsyncClient):
    """Verify strict tenant data isolation between two distinct tenants."""
    # 1. Onboard Tenant 1
    t1_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "Company Alpha",
        "tenant_slug": "alpha",
        "admin_email": "alpha@example.com",
        "admin_password": "AlphaPassword123!"
    })
    assert t1_res.status_code == 201
    t1_token = t1_res.json()["access_token"]

    # 2. Onboard Tenant 2
    t2_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "Company Beta",
        "tenant_slug": "beta",
        "admin_email": "beta@example.com",
        "admin_password": "BetaPassword123!"
    })
    assert t2_res.status_code == 201
    t2_token = t2_res.json()["access_token"]

    # 3. Create Item under Tenant 1 (Alpha)
    item_res = await client.post(
        "/api/v1/items/",
        headers={"Authorization": f"Bearer {t1_token}"},
        json={"title": "Alpha Secret Document", "description": "Confidential"}
    )
    assert item_res.status_code == 201
    alpha_item_id = item_res.json()["id"]

    # 4. List items for Tenant 1 -> Should contain 1 item
    list_t1 = await client.get("/api/v1/items/", headers={"Authorization": f"Bearer {t1_token}"})
    assert list_t1.status_code == 200
    assert len(list_t1.json()) == 1
    assert list_t1.json()[0]["title"] == "Alpha Secret Document"

    # 5. List items for Tenant 2 (Beta) -> Must be EMPTY (strict isolation)
    list_t2 = await client.get("/api/v1/items/", headers={"Authorization": f"Bearer {t2_token}"})
    assert list_t2.status_code == 200
    assert len(list_t2.json()) == 0

    # 6. Tenant 2 tries to directly access Tenant 1's item ID -> Should return 404
    get_cross_tenant = await client.get(
        f"/api/v1/items/{alpha_item_id}",
        headers={"Authorization": f"Bearer {t2_token}"}
    )
    assert get_cross_tenant.status_code == 404
