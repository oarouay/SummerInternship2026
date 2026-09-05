# FastAPI Multi-Tenant Backend with Auth & Tenant Isolation

A modular, production-ready foundation for FastAPI featuring JWT Authentication, Role-based Access Control (RBAC), and Tenant Data Isolation.

---

## 🏗️ Architecture & Features

- **FastAPI**: Modern, async RESTful API framework.
- **Multi-Tenant Isolation**: Row-level tenant isolation using SQLAlchemy `TenantMixin` (`tenant_id`), where every tenant query is isolated via dependency injection.
- **JWT Authentication & Security**: Fast, secure password hashing (`bcrypt`) and signed token issuance (`pyjwt`) embedding both user and tenant context.
- **Async Database Layer**: SQLAlchemy 2.0 with async engine support (`aiosqlite` for zero-setup SQLite, ready for `asyncpg` / PostgreSQL).
- **Interactive Documentation**: Swagger UI at `/docs` with OAuth2 password flow support.
- **Test Suite**: Async tests using `pytest` and `httpx` verifying cross-tenant security and authentication flows.

---

## 📁 Project Structure

```
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   ├── auth.py          # /register-tenant, /login, /me
│   │       │   ├── tenants.py       # /current, /users
│   │       │   ├── sources.py       # /sources (upload, raw-text, chunks, reprocess)
│   │       │   └── items.py         # Sample tenant-isolated resource
│   │       └── router.py            # Aggregated v1 endpoints
│   ├── core/
│   │   ├── config.py                # Pydantic Settings & environment loader
│   │   ├── database.py              # Async SQLAlchemy engine & session factory
│   │   └── security.py              # Bcrypt hashing & JWT utilities
│   ├── dependencies/
│   │   ├── auth.py                  # get_current_user & role checks
│   │   └── tenant.py                # get_current_tenant & TenantContext
│   ├── models/
│   │   ├── base.py                  # Base model & TenantMixin
│   │   ├── tenant.py                # Tenant model
│   │   ├── user.py                  # User model
│   │   ├── source.py                # Knowledge Source model
│   │   ├── chunk.py                 # DocumentChunk model (tenant-isolated)
│   │   └── item.py                  # Example tenant-isolated model
│   ├── schemas/
│   │   ├── auth.py                  # Token & Login schemas
│   │   ├── tenant.py                # Tenant schemas
│   │   ├── user.py                  # User schemas
│   │   ├── source.py                # Source & raw-text schemas
│   │   ├── chunk.py                 # DocumentChunk schemas
│   │   ├── search.py                # Semantic Search schemas
│   │   └── item.py                  # Resource schemas
│   ├── services/
│   │   ├── storage.py               # Tenant-isolated file storage & streaming
│   │   ├── parser.py                # Strategy parser (PDF, DOCX, TXT/MD/CSV)
│   │   ├── chunking.py              # RecursiveTextSplitter with sliding overlap
│   │   ├── embedding.py             # Google Gemini text-embedding-004 & mock
│   │   ├── search.py                # pgvector Cosine Distance search service
│   │   └── pipeline.py              # Async BackgroundTasks ingestion worker
│   └── main.py                      # Application entrypoint & lifespan
├── tests/
│   ├── conftest.py                  # Pytest async fixtures & memory DB
│   ├── test_auth_and_tenant.py      # Auth & Tenant isolation test suite
│   ├── test_sources.py              # Data sources & upload isolation tests
│   ├── test_pipeline.py             # Parsing, chunking & background pipeline tests
│   └── test_embeddings_and_search.py # Vector embeddings & semantic search tests
├── .env.example                     # Environment template
├── .env                             # Local environment configuration
├── requirements.txt                 # Dependencies
└── README.md
```

---

## 🚀 Quickstart Guide

### 1. Create and Activate Virtual Environment

```powershell
# In PowerShell (Windows)
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Development Server

```bash
uvicorn app.main:app --reload --port 8000
```

- API Base URL: `http://localhost:8000`
- Interactive API Docs (Swagger UI): `http://localhost:8000/docs`
- Alternative Docs (ReDoc): `http://localhost:8000/redoc`

---

## 🔒 How Tenant Isolation Works

1. **Onboarding a Tenant**:
   Call `POST /api/v1/auth/register-tenant` with tenant details and the initial admin user. This returns an access token stamped with the `tenant_id`.

2. **Issuing Tokens**:
   When logging in via `POST /api/v1/auth/login`, the issued JWT contains:
   ```json
   {
     "sub": "1",
     "tenant_id": "1",
     "role": "admin",
     "exp": 1740672000
   }
   ```

3. **Enforcing Isolation in Endpoints**:
   Add `tenant: Tenant = Depends(get_current_tenant)` or `context: TenantContext = Depends(get_tenant_context)` to your endpoint dependencies:
   ```python
   @router.get("/items")
   async def list_items(
       tenant: Tenant = Depends(get_current_tenant),
       db: AsyncSession = Depends(get_db)
   ):
       # Data is strictly scoped to the active tenant
       stmt = select(Item).where(Item.tenant_id == tenant.id)
       result = await db.execute(stmt)
       return result.scalars().all()
   ```

---

## 📂 Data Source Management & Ingestion Pipeline (Epic 2)

Tenants can upload knowledge sources to build their GraphRAG index:

* **Upload Document**: `POST /api/v1/sources/upload` (`multipart/form-data` with `.pdf`, `.docx`, `.txt`, `.csv`, `.md`)
  * Validates file size (up to 25MB) and supported extensions.
  * Streams file to tenant-isolated disk storage (`uploads/{tenant_id}/{uuid}_{filename}`).
  * Automatically enqueues background processing via `BackgroundTasks`.
* **Ingest Raw Text**: `POST /api/v1/sources/raw-text` (`{"name": "...", "content": "..."}`)
  * Directly indexes FAQs, knowledge notes, and policies without requiring a physical file.
* **List Sources**: `GET /api/v1/sources/` (strictly scoped to calling tenant).
* **Get Source Detail**: `GET /api/v1/sources/{source_id}` (includes status: `pending`, `processing`, `indexed`, `failed`).
* **Inspect Chunks**: `GET /api/v1/sources/{source_id}/chunks` (view semantic passages with estimated token counts).
* **Semantic Vector Search**: `POST /api/v1/sources/search` (`{"query": "...", "top_k": 5}`)
  * Converts the query into a 768-dimensional vector using Google Gemini.
  * Finds the closest matching document chunks using **Cosine Distance (`<=>`)**.
  * Strictly filters by `tenant_id`, guaranteeing zero cross-tenant data leakage.
* **Reprocess Source**: `POST /api/v1/sources/{source_id}/reprocess` (re-runs parsing, chunking & embedding).
* **Delete Source**: `DELETE /api/v1/sources/{source_id}` (cascades: deletes DB record, chunks, vectors, and physical file).

### 🧩 Document Parsing & Recursive Chunking Architecture
* **Parsers** (`app/services/parser.py`):
  * **PDF**: `pypdf` with empty / scanned document detection (flags image-only PDFs for OCR).
  * **Word**: `python-docx` extracting paragraphs and Markdown-style tables.
  * **Text/CSV**: Multi-encoding fallback (`utf-8`, `utf-8-sig`, `latin-1`, `cp1252`).
* **Recursive Chunker** (`app/services/chunking.py`):
  * Hierarchical separators: `["\n\n", "\n", ". ", "? ", "! ", " ", ""]`.
  * Configurable `chunk_size` (default: 1,000 characters / ~250 tokens).
  * Sliding-window `chunk_overlap` (default: 200 characters / ~50 tokens).

### ⚡ Vector Storage (`pgvector`) & Google Gemini Embeddings
* **Model**: Google Gemini `text-embedding-004` producing **768-dimensional unit-normalized vectors**.
* **Vector Store**: `pgvector` extension inside PostgreSQL directly on `document_chunks.embedding`.
* **Distance Metric**: **Cosine Distance (`<=>`)**, ranking chunks where `score = 1.0 - distance`.
* **Testing & Offline Support**: Built-in deterministic mock embedding service for zero-cost testing and offline development.

---

## 🕸️ Knowledge Graph Construction with Neo4j (Epic 3)

The platform pairs vector search with an explicit **Knowledge Graph** stored in **Neo4j 5.26**:

* **Docker Infrastructure**: Neo4j Community running on port `7474` (Web Browser UI) and `7687` (Async Bolt Protocol).
* **LLM Extraction**: `GeminiGraphExtractor` automatically extracts canonical entities and typed relationships (`MANAGES`, `DEPENDS_ON`, `USES`) from document chunks using `gemini-2.5-flash` with structured JSON output.
* **Graph Multi-Tenancy**: Guaranteed via composite unique constraints `(e.tenant_id, e.name)` and tenant-stamped relationships.
* **Neighborhood Traversal**: `POST /api/v1/graph/neighborhood` queries multi-hop connections up to $N$ hops away for seed entities.
* **Tenant Graph Stats**: `GET /api/v1/graph/stats` returns total entity and relationship counts.

---

## 📚 In-Depth Learning Guide

For a comprehensive educational breakdown of the architecture, trade-offs, vector mathematics, and Cypher graph traversals, read:
👉 **[Comprehensive Architecture & Learning Guide](file:///c:/Users/USER/Desktop/Oussama/stage%20d%27ete%20premier/docs/LEARNING_GUIDE.md)**

---

## 🧪 Running Tests

The test suite runs 28 async unit and integration tests across the entire platform:

```bash
.\venv\Scripts\python.exe -m pytest tests/
```

