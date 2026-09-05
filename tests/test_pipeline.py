import io
import os
import shutil
import pytest
from httpx import AsyncClient
from docx import Document
from pypdf import PdfWriter

from app.services.chunking import RecursiveTextSplitter
from app.services.parser import DocxParser, PDFParser, TextParser, parse_document


@pytest.fixture(autouse=True)
def clean_test_uploads():
    """Ensure uploads directory is clean before and after tests."""
    yield
    if os.path.exists("uploads"):
        shutil.rmtree("uploads", ignore_errors=True)


# =====================================================================
# 1. UNIT TESTS: RecursiveTextSplitter
# =====================================================================

def test_recursive_splitter_short_text():
    """Short text smaller than chunk_size should produce exactly one chunk."""
    splitter = RecursiveTextSplitter(chunk_size=500, chunk_overlap=50)
    text = "This is a brief piece of text that easily fits in one chunk."
    chunks = splitter.split_text(text)
    assert len(chunks) == 1
    assert chunks[0]["chunk_index"] == 0
    assert chunks[0]["content"] == text
    assert chunks[0]["char_count"] == len(text)
    assert chunks[0]["token_count"] > 0


def test_recursive_splitter_paragraphs_and_overlap():
    """Multi-paragraph text should split on double newlines and maintain overlap."""
    p1 = "Paragraph one discusses the architectural foundations of multi-tenant SaaS systems."
    p2 = "Paragraph two focuses on row-level security and tenant isolation using foreign keys."
    p3 = "Paragraph three explains the mechanics of vector embeddings and knowledge graph generation."
    full_text = f"{p1}\n\n{p2}\n\n{p3}"

    # Set chunk_size small enough to force splitting per paragraph
    splitter = RecursiveTextSplitter(chunk_size=120, chunk_overlap=30)
    chunks = splitter.split_text(full_text)

    assert len(chunks) >= 2
    # Verify sequential numbering
    for idx, c in enumerate(chunks):
        assert c["chunk_index"] == idx
        assert len(c["content"]) <= 150  # reasonably bounded


def test_recursive_splitter_invalid_overlap():
    """Overlap equal to or greater than chunk_size must raise ValueError."""
    with pytest.raises(ValueError):
        RecursiveTextSplitter(chunk_size=100, chunk_overlap=100)

    with pytest.raises(ValueError):
        RecursiveTextSplitter(chunk_size=100, chunk_overlap=120)


# =====================================================================
# 2. UNIT TESTS: Document Parsers
# =====================================================================

def test_text_parser_txt_and_csv(tmp_path):
    """Test TextParser handling standard text, markdown, and csv."""
    # Test .txt
    txt_file = tmp_path / "sample.txt"
    txt_file.write_text("Line 1\nLine 2\nLine 3", encoding="utf-8")
    assert "Line 1\nLine 2\nLine 3" == TextParser().parse(str(txt_file))

    # Test .csv
    csv_file = tmp_path / "sample.csv"
    csv_file.write_text("Name,Role,Team\nAlice,Admin,Core\nBob,Member,AI", encoding="utf-8")
    parsed_csv = TextParser().parse(str(csv_file))
    assert "Alice, Admin, Core" in parsed_csv
    assert "Bob, Member, AI" in parsed_csv


def test_docx_parser(tmp_path):
    """Test DocxParser extracting text from paragraphs and tables."""
    docx_file = tmp_path / "sample.docx"
    doc = Document()
    doc.add_heading("GraphRAG Platform", level=1)
    doc.add_paragraph("This is a test paragraph for Word document ingestion.")
    
    table = doc.add_table(rows=2, cols=2)
    table.rows[0].cells[0].text = "Header A"
    table.rows[0].cells[1].text = "Header B"
    table.rows[1].cells[0].text = "Val A"
    table.rows[1].cells[1].text = "Val B"
    
    doc.save(str(docx_file))

    parsed = DocxParser().parse(str(docx_file))
    assert "GraphRAG Platform" in parsed
    assert "This is a test paragraph" in parsed
    assert "Header A | Header B" in parsed
    assert "Val A | Val B" in parsed


# =====================================================================
# 3. INTEGRATION TESTS: Background Ingestion Pipeline
# =====================================================================

@pytest.mark.asyncio
async def test_pipeline_raw_text_ingestion(client: AsyncClient):
    """Ingesting raw text should automatically trigger background chunking and index the source."""
    # 1. Register tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "PipelineCorp",
        "tenant_slug": "pipelinecorp",
        "admin_email": "admin@pipelinecorp.com",
        "admin_password": "PipePassword123!"
    })
    token = reg_res.json()["access_token"]

    # 2. Ingest raw text
    text_content = (
        "FastAPI is a modern, fast (high-performance), web framework for building APIs with Python.\n\n"
        "SQLAlchemy is the Python SQL toolkit and Object Relational Mapper that gives application developers "
        "the full power and flexibility of SQL.\n\n"
        "GraphRAG combines vector databases and knowledge graphs to deliver highly accurate retrieval."
    )
    res = await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Tech Architecture Notes", "content": text_content}
    )
    assert res.status_code == 201
    source_id = res.json()["id"]

    # 3. Verify Source status reached INDEXED
    get_src = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_src.status_code == 200
    assert get_src.json()["status"] == "indexed"

    # 4. Fetch Chunks
    get_chunks = await client.get(
        f"/api/v1/sources/{source_id}/chunks",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_chunks.status_code == 200
    chunks = get_chunks.json()
    assert len(chunks) > 0
    assert chunks[0]["source_id"] == source_id
    assert "FastAPI" in chunks[0]["content"]


@pytest.mark.asyncio
async def test_pipeline_file_upload_ingestion(client: AsyncClient):
    """Uploading a document should asynchronously extract text and create chunks."""
    # 1. Register tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "FileChunkCorp",
        "tenant_slug": "filechunkcorp",
        "admin_email": "admin@filechunk.com",
        "admin_password": "ChunkPassword123!"
    })
    token = reg_res.json()["access_token"]

    # 2. Upload file
    doc_text = "Knowledge Source Section 1.\n\nKnowledge Source Section 2.\n\nKnowledge Source Section 3."
    upload_res = await client.post(
        "/api/v1/sources/upload",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("knowledge.txt", io.BytesIO(doc_text.encode("utf-8")), "text/plain")}
    )
    assert upload_res.status_code == 201
    source_id = upload_res.json()["id"]

    # 3. Verify Indexed
    get_src = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_src.status_code == 200
    assert get_src.json()["status"] == "indexed"

    # 4. Verify Chunks
    get_chunks = await client.get(
        f"/api/v1/sources/{source_id}/chunks",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_chunks.status_code == 200
    assert len(get_chunks.json()) > 0


@pytest.mark.asyncio
async def test_pipeline_chunks_tenant_isolation(client: AsyncClient):
    """Tenant B must not be able to read Tenant A's chunks."""
    # Tenant A
    t1_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "AlphaPipeline",
        "tenant_slug": "alphapipe",
        "admin_email": "alpha@pipe.com",
        "admin_password": "AlphaPipe123!"
    })
    t1_token = t1_res.json()["access_token"]

    # Tenant B
    t2_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "BetaPipeline",
        "tenant_slug": "betapipe",
        "admin_email": "beta@pipe.com",
        "admin_password": "BetaPipe123!"
    })
    t2_token = t2_res.json()["access_token"]

    # Tenant A ingests raw text
    src_res = await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {t1_token}"},
        json={"name": "Alpha Secrets", "content": "Confidential Alpha Information"}
    )
    t1_source_id = src_res.json()["id"]

    # Tenant B attempts to access Tenant A's chunks -> 404
    t2_access = await client.get(
        f"/api/v1/sources/{t1_source_id}/chunks",
        headers={"Authorization": f"Bearer {t2_token}"}
    )
    assert t2_access.status_code == 404


def test_pdf_parser_scanned_detection(tmp_path):
    """Test that a PDF with blank or non-extractable text raises a clear scanned document error."""
    blank_pdf = tmp_path / "scanned_doc.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    with open(blank_pdf, "wb") as f:
        writer.write(f)

    with pytest.raises(ValueError) as exc_info:
        PDFParser().parse(str(blank_pdf))
    assert "Scanned or image-only PDF detected" in str(exc_info.value)


@pytest.mark.asyncio
async def test_reprocess_source(client: AsyncClient):
    """Test re-triggering the background ingestion pipeline for an existing source."""
    # 1. Register tenant
    reg_res = await client.post("/api/v1/auth/register-tenant", json={
        "tenant_name": "ReprocessCorp",
        "tenant_slug": "reprocesscorp",
        "admin_email": "reprocess@corp.com",
        "admin_password": "ReprocessPassword123!"
    })
    token = reg_res.json()["access_token"]

    # 2. Ingest raw text
    src_res = await client.post(
        "/api/v1/sources/raw-text",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Reprocess Test", "content": "Initial content for reprocessing."}
    )
    source_id = src_res.json()["id"]

    # 3. Call reprocess endpoint
    reproc_res = await client.post(
        f"/api/v1/sources/{source_id}/reprocess",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert reproc_res.status_code == 200

    # 4. Verify source re-indexed
    get_src = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_src.status_code == 200
    assert get_src.json()["status"] == "indexed"

