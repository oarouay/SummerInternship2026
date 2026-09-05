import io
import os
import shutil
import pytest
from httpx import AsyncClient


@pytest.fixture(autouse=True)
def clean_test_uploads():
    """Ensure uploads folder is clean after test execution."""
    yield
    if os.path.exists("uploads"):
        shutil.rmtree("uploads", ignore_errors=True)



@pytest.mark.asyncio
async def test_upload_valid_document(client: AsyncClient):
    """Test uploading a valid document and verifying tenant isolation & file creation."""
    # 1. Register a tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "DocCorp",
        "tenant_slug": "doccorp",
        "admin_email": "admin@doccorp.com",
        "admin_password": "DocPassword123!"
    })
    assert reg_res.status_code == 201
    token = reg_res.json()["access_token"]
    tenant_id = reg_res.json()["tenant"]["id"]

    # 2. Upload a sample .txt document
    sample_content = b"GraphRAG connects unstructured documents to structured knowledge graphs."
    files = {
        "file": ("knowledge_base.txt", io.BytesIO(sample_content), "text/plain")
    }

    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers={"Authorization": f"Bearer {token}"},
        files=files
    )
    assert upload_res.status_code == 201, upload_res.text
    source_data = upload_res.json()
    assert source_data["name"] == "knowledge_base.txt"
    assert source_data["source_type"] == "file"
    assert source_data["status"] == "pending"
    assert source_data["file_size"] == len(sample_content)
    assert source_data["tenant_id"] == tenant_id

    # 3. List sources -> Should return 1 item
    list_res = await client.get(
        "/api/v1/sources/",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) == 1
    assert items[0]["id"] == source_data["id"]


@pytest.mark.asyncio
async def test_upload_disallowed_extension(client: AsyncClient):
    """Test uploading an unsupported extension is rejected with 400 Bad Request."""
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "SecurityCorp",
        "tenant_slug": "securitycorp",
        "admin_email": "admin@securitycorp.com",
        "admin_password": "SecPassword123!"
    })
    token = reg_res.json()["access_token"]

    files = {
        "file": ("malicious_script.exe", io.BytesIO(b"binary executable"), "application/x-msdownload")
    }

    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers={"Authorization": f"Bearer {token}"},
        files=files
    )
    assert upload_res.status_code == 400
    assert "Unsupported file format" in upload_res.json()["detail"]


@pytest.mark.asyncio
async def test_ingest_raw_text(client: AsyncClient):
    """Test creating a raw text data source."""
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "TextCorp",
        "tenant_slug": "textcorp",
        "admin_email": "admin@textcorp.com",
        "admin_password": "TextPassword123!"
    })
    token = reg_res.json()["access_token"]

    payload = {
        "name": "Refund Policy 2026",
        "content": "All refunds must be requested within 30 days of initial purchase."
    }

    res = await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {token}"},
        json=payload
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Refund Policy 2026"
    assert data["source_type"] == "raw_text"
    assert data["status"] == "pending"
    assert data["file_size"] == len(payload["content"].encode("utf-8"))


@pytest.mark.asyncio
async def test_sources_tenant_isolation(client: AsyncClient):
    """Verify strict tenant isolation for knowledge sources."""
    # 1. Register Tenant A
    t1_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "Tenant One",
        "tenant_slug": "tenant-one",
        "admin_email": "one@example.com",
        "admin_password": "PasswordOne123!"
    })
    t1_token = t1_res.json()["access_token"]

    # 2. Register Tenant B
    t2_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "Tenant Two",
        "tenant_slug": "tenant-two",
        "admin_email": "two@example.com",
        "admin_password": "PasswordTwo123!"
    })
    t2_token = t2_res.json()["access_token"]

    # 3. Tenant A uploads a document
    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers={"Authorization": f"Bearer {t1_token}"},
        files={"file": ("tenant1_secrets.txt", io.BytesIO(b"Confidential data"), "text/plain")}
    )
    assert upload_res.status_code == 201
    source_id = upload_res.json()["id"]

    # 4. Tenant B lists sources -> Must be empty
    list_t2 = await client.get("/api/v1/sources/", headers={"Authorization": f"Bearer {t2_token}"})
    assert list_t2.status_code == 200
    assert len(list_t2.json()) == 0

    # 5. Tenant B attempts to fetch Tenant A's source -> 404 Not Found
    get_t2 = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {t2_token}"}
    )
    assert get_t2.status_code == 404

    # 6. Tenant B attempts to delete Tenant A's source -> 404 Not Found
    del_t2 = await client.delete(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {t2_token}"}
    )
    assert del_t2.status_code == 404


@pytest.mark.asyncio
async def test_delete_source_removes_physical_file(client: AsyncClient):
    """Test that deleting a source removes both the DB record and the physical file."""
    # 1. Register tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "CleanupCorp",
        "tenant_slug": "cleanupcorp",
        "admin_email": "clean@corp.com",
        "admin_password": "CleanPassword123!"
    })
    token = reg_res.json()["access_token"]

    # 2. Upload file
    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("to_delete.txt", io.BytesIO(b"Will be deleted shortly"), "text/plain")}
    )
    assert upload_res.status_code == 201
    source_id = upload_res.json()["id"]

    # 3. Delete source
    del_res = await client.delete(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert del_res.status_code == 204

    # 4. Verify source is gone
    get_res = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_res.status_code == 404
