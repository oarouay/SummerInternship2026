# Enterprise GraphRAG Platform: Comprehensive Architecture & Learning Guide

> **Author**: Oussama Arouay  
> **Project**: Multi-Tenant GraphRAG Platform (Summer Internship 2026)  
> **Tech Stack**: FastAPI, PostgreSQL + `pgvector`, Neo4j, Google Gemini (`gemini-2.5-flash` & `text-embedding-004`), SQLAlchemy 2.0 Async, Docker

---

## 📑 Table of Contents

1. [Introduction to GraphRAG](#1-introduction-to-graphrag)
2. [Pillar 1: Multi-Tenancy & Row-Level Security](#2-pillar-1-multi-tenancy--row-level-security)
3. [Pillar 2: Document Ingestion, Streaming & File Storage](#3-pillar-2-document-ingestion-streaming--file-storage)
4. [Pillar 3: Text Parsing & Recursive Character Chunking](#4-pillar-3-text-parsing--recursive-character-chunking)
5. [Pillar 4: Vector Embeddings & Semantic Search (`pgvector`)](#5-pillar-4-vector-embeddings--semantic-search-pgvector)
6. [Pillar 5: Knowledge Graph Construction & Neo4j](#6-pillar-5-knowledge-graph-construction--neo4j)
7. [Pillar 6: Cypher Graph Traversal & Cross-Tenant Isolation](#7-pillar-6-cypher-graph-traversal--cross-tenant-isolation)
8. [Pillar 7: The Roadmap Ahead — Hybrid GraphRAG Query Synthesis](#8-pillar-7-the-roadmap-ahead--hybrid-graphrag-query-synthesis)
9. [Summary Table of Architectural Decisions & Tradeoffs](#9-summary-table-of-architectural-decisions--tradeoffs)

---

## 1. Introduction to GraphRAG

### The Problem with Traditional Vector-Only RAG
Standard Retrieval-Augmented Generation (RAG) relies exclusively on vector similarity search:
1. Documents are chopped into small text snippets (chunks).
2. Each chunk is passed through an embedding model to yield a high-dimensional vector.
3. When a user asks a question, the question is converted into a query vector, and top-$k$ chunks with the highest Cosine Similarity are fetched.
4. Chunks are stuffed into an LLM context window to answer the query.

#### Where Traditional RAG Breaks Down:
* **The "Multi-Hop" Problem**: Suppose Chunk A states *"Alice is the director of Project Titan"* and Chunk B states *"Project Titan uses Hydra for identity management"*, and Chunk C states *"Hydra has a critical CVE-2026 vulnerability"*. If a user asks *"Which projects managed by Alice have security vulnerabilities?"*, traditional vector search fails because no single chunk contains both "Alice" and "CVE vulnerability". Their semantic vector cosine similarity is negligible.
* **Global Topic Summarization**: Standard RAG cannot answer macro questions like *"What are the top 5 strategic initiatives described across all these 100 documents?"* because vector search only retrieves localized, micro fragments.

### The Solution: GraphRAG
**GraphRAG** combines the strengths of two distinct retrieval paradigms:
1. **Unstructured Vector Search (`pgvector`)**: Excellent at finding conceptually similar text passages, fuzzy keywords, and narrative explanations.
2. **Structured Knowledge Graph (Neo4j)**: Maps explicit entities (people, technologies, organizations) and their directed relationships (`MANAGES`, `DEPENDS_ON`, `USES`), enabling multi-hop associative reasoning.

```
┌───────────────────────────────────────────────────────────┐
│                     USER QUESTION                         │
└─────────────┬───────────────────────────────┬─────────────┘
              │                               │
              ▼                               ▼
     [Vector Embeddings]             [Entity Extraction]
              │                               │
              ▼                               ▼
    Top-K Similar Chunks             Seed Entity Nodes
    (PostgreSQL + pgvector)            (Neo4j Graph)
              │                               │
              │                               ▼
              │                     Multi-Hop Traversal
              │                   (Relationships & Triples)
              │                               │
              └───────────────┬───────────────┘
                              ▼
                [Context Fusion & Prompt]
                              ▼
                [Google Gemini 2.5 Flash]
                              ▼
                   Synthesized Answer
               (with Verifiable Citations)
```

---

## 2. Pillar 1: Multi-Tenancy & Row-Level Security

### Multi-Tenancy Architectural Models
When building an enterprise B2B platform, different client organizations ("Tenants") must store data on the same infrastructure without any possibility of cross-tenant data leakage.

| Architecture | Description | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Database per Tenant** | Separate physical database for each tenant. | Absolute isolation; easy backups per tenant. | Huge operational overhead; costly; difficult connection pooling with 1,000+ tenants. |
| **Schema per Tenant** | Shared DB, separate PostgreSQL schema per tenant. | Strong isolation; shared connection pool. | Schema migrations become a nightmare across hundreds of schemas. |
| **Row-Level Isolation (Our Choice)** | Shared DB and tables; every row is stamped with a `tenant_id`. | Resource-efficient, simple migrations, highly scalable. | Requires strict code-level enforcement to never omit `tenant_id`. |

### How We Enforced It in SQLAlchemy
We created a reusable `TenantMixin` in `app/models/base.py`:
```python
class TenantMixin:
    @declared_attr
    def tenant_id(cls) -> Mapped[int]:
        return mapped_column(
            ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True
        )
```
Every tenant-owned entity (`User`, `Source`, `DocumentChunk`, `Item`) inherits `TenantMixin`.

### FastAPI Dependency Injection Security Pipeline
FastAPI's dependency injection (`Depends`) guarantees that every API endpoint receives the verified tenant context extracted from the cryptographically signed JWT token:

```
[Incoming HTTP Request] 
       │ (Authorization: Bearer <JWT>)
       ▼
[get_current_user] 
       │ 1. Decodes JWT signature using SECRET_KEY & HS256
       │ 2. Validates expiration (`exp`)
       │ 3. Fetches user from DB
       ▼
[get_current_tenant]
       │ 1. Extracts `tenant_id` from token payload
       │ 2. Verifies user belongs to tenant
       │ 3. Verifies tenant is `is_active == True`
       ▼
[Route Handler] -> Queries strictly scoped to: `select(...).where(Model.tenant_id == tenant.id)`
```

---

## 3. Pillar 2: Document Ingestion, Streaming & File Storage

### Why `db.add()` and `await db.flush()` are Critical
During file upload (`POST /api/v1/sources/upload`), we needed to store the uploaded file at:
`uploads/tenant_{tenant_id}/source_{source_id}/{filename}`

* **The Problem**: When creating a new `Source` instance, its primary key `source.id` is `None` because the database generates auto-incrementing IDs.
* **The Solution**:
  ```python
  db.add(source)
  await db.flush()  # Sends INSERT to database transaction, populating source.id without committing!
  file_path = await storage_service.save_file(tenant_id, source.id, file)
  source.file_path = file_path
  await db.commit() # Now permanently commits the record with the correct path!
  ```
* **Why `flush()` over `commit()`**: If saving the file to disk fails (e.g. out of disk space or bad file format), the transaction rolls back cleanly without leaving an orphaned "ghost" record in the database.

### Streaming Uploads to Prevent Memory Denial-of-Service
Reading an entire 50MB PDF into server RAM via `await file.read()` is dangerous when multiple users upload simultaneously.
We implemented chunked streaming in `app/services/storage.py`:
```python
async with aiofiles.open(dest_path, "wb") as buffer:
    while chunk := await file.read(1024 * 1024): # Stream in 1MB chunks
        buffer.write(chunk)
```
This keeps server memory footprint constant ($\approx 1\text{MB}$) regardless of file size.

---

## 4. Pillar 3: Text Parsing & Recursive Character Chunking

### Document Parsers Strategy Pattern
Different file formats require specialized extraction logic:
* **PDF (`PdfDocumentParser`)**: Uses `pypdf` to extract text streams page by page.
* **DOCX (`DocxDocumentParser`)**: Uses `python-docx` to iterate through paragraphs and XML text nodes.
* **Plaintext/Markdown (`TextDocumentParser`)**: Auto-detects UTF-8 with fallback to Latin-1 encoding.

### The Mathematics & Logic of Recursive Character Chunking
Why not just cut text every 500 characters?
* If you cut text arbitrarily at character 500, you slice sentences in half: `"The revenue of Company X was $50 million, which is ... [CHUNK 1 END] ... a 20% decrease from last year [CHUNK 2 START]"`.
* Now, vector searching Chunk 1 suggests revenue is high, losing the crucial context in Chunk 2!

**Recursive Character Splitting** solves this by respecting natural human linguistic boundaries:
1. Try splitting on paragraph breaks (`\n\n`).
2. If a paragraph exceeds `chunk_size` (e.g. 500 chars), split on line breaks (`\n`).
3. If a line exceeds `chunk_size`, split on sentence boundaries (`. `).
4. If a sentence exceeds `chunk_size`, split on spaces (` `).
5. As an absolute last resort, split on characters (`""`).

```
                      Raw Extracted Text
                              │
                    Split by "\n\n" ?
                     ├── Yes ──> Paragraphs fit? ──> Complete Chunks
                     └── No (Too large)
                              │
                     Split by "\n" ?
                     ├── Yes ──> Lines fit? ───────> Complete Chunks
                     └── No (Too large)
                              │
                     Split by ". " ?
                     ├── Yes ──> Sentences fit? ───> Complete Chunks
                     └── No (Too large)
                              │
                     Split by " " ?
```

### Sliding Window Overlap
To guarantee context across chunk boundaries, consecutive chunks overlap by `chunk_overlap` characters (e.g. 50 characters):
* **Chunk 0**: Characters 0 to 500.
* **Chunk 1**: Characters 450 to 950.
* **Chunk 2**: Characters 900 to 1400.

### Asynchronous Background Processing
Document parsing and chunking takes time. If done synchronously inside an HTTP request, the client's browser would freeze for seconds.
We leveraged **FastAPI `BackgroundTasks`**:
1. The API receives the file, saves it, creates a `Source(status="pending")`, and returns `HTTP 201 Created` in milliseconds.
2. FastAPI triggers `process_source_pipeline(source_id)` on a background thread.
3. The background worker parses, chunks, embeds, extracts graph entities, and marks `status="indexed"`.

---

## 5. Pillar 4: Vector Embeddings & Semantic Search (`pgvector`)

### What is a Vector Embedding?
An embedding model converts a text string into an array of floating-point numbers:
$$\vec{v} \in \mathbb{R}^{768}$$
Where the coordinates position the text in a 768-dimensional geometric space such that texts with similar conceptual meaning are situated close to one another.

### Vector Distance Metrics Compared

```
                Cosine Angle (θ)                 Euclidean Distance (d)
                     v1                                    v1
                    ↗                                     ↗  \
                   /                                     /    \  d
                  /  θ                                  /      \
                 /─────> v2                            /────────> v2
```

1. **Euclidean Distance ($L_2$ Norm)**:
   $$d(\vec{u}, \vec{v}) = \sqrt{\sum_{i=1}^n (u_i - v_i)^2}$$
   * Measures direct straight-line distance.
   * **Flaw for RAG**: Sensitive to document length. A 10-word query will have a shorter vector magnitude than a 500-word document, artificially inflating Euclidean distance even if their topic is identical.
2. **Dot Product (Inner Product)**:
   $$\vec{u} \cdot \vec{v} = \sum_{i=1}^n u_i v_i$$
   * Fast, but strongly influenced by vector lengths.
3. **Cosine Distance (The Industry Standard for RAG)**:
   $$\text{Cosine Similarity} = \frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\| \|\vec{v}\|} = \cos(\theta)$$
   $$\text{Cosine Distance} = 1 - \cos(\theta)$$
   * Measures purely the **angle** ($\theta$) between the two vectors, completely normalizing for text length!
   * Google Gemini's `text-embedding-004` generates pre-normalized vectors ($\|\vec{v}\| = 1.0$), making Cosine Distance ultra-fast and numerically stable.

### PostgreSQL `pgvector` Integration
We defined the vector column in `app/models/chunk.py`:
```python
embedding: Mapped[Optional[List[float]]] = mapped_column(
    Vector(768),  # 768 dimensions for Gemini text-embedding-004
    nullable=True
)
```
In production PostgreSQL, searches execute via the native `<=>` Cosine Distance operator:
```sql
SELECT id, content, (embedding <=> :query_vector) AS distance
FROM document_chunks
WHERE tenant_id = :tenant_id
ORDER BY distance ASC
LIMIT :top_k;
```
For testing without requiring a PostgreSQL container, our `search.py` service includes an in-memory numpy Cosine Distance fallback.

---

## 6. Pillar 5: Knowledge Graph Construction & Neo4j

### Property Graph Model
Unlike relational tables (rows & foreign keys), Neo4j stores data as a **Labeled Property Graph**:
* **Nodes (`:Entity`)**: Represent nouns/concepts.
  * Labels: `:Entity`
  * Properties: `tenant_id`, `name`, `type` (e.g. `PERSON`, `TECHNOLOGY`, `PROJECT`), `description`, `chunk_ids`, `source_ids`.
* **Edges (`:RELATION`)**: Directed, typed connections between nodes.
  * Type: `MANAGES`, `DEPENDS_ON`, `USES`, `INTEGRATES_WITH`.
  * Properties: `tenant_id`, `type`, `description`, `weight`, `source_ids`.

```
(:Entity {name: 'Alice', type: 'PERSON'})
       │
       │ [:RELATION {type: 'MANAGES', weight: 1}]
       ▼
(:Entity {name: 'Project Titan', type: 'PROJECT'})
       │
       │ [:RELATION {type: 'DEPENDS_ON', weight: 2}]
       ▼
(:Entity {name: 'Hydra Auth', type: 'TECHNOLOGY'})
```

### Google Gemini Structured Graph Extraction
To transform unstructured text into graphs, we prompt `gemini-2.5-flash` using `response_mime_type="application/json"` and Pydantic schema validation:
```python
class Entity(BaseModel):
    name: str
    type: str  # PERSON, TECHNOLOGY, PROJECT, etc.
    description: str

class Relationship(BaseModel):
    source: str
    target: str
    relation_type: str
    description: str

class GraphExtractionResult(BaseModel):
    entities: List[Entity]
    relationships: List[Relationship]
```
Gemini reads the chunk text and returns validated JSON matching this exact structure.

---

## 7. Pillar 6: Cypher Graph Traversal & Cross-Tenant Isolation

### How Neo4j Handles Multi-Tenancy
Neo4j Community Edition does not have multiple isolated databases. We enforce multi-tenancy at the data layer:
1. **Composite Uniqueness Constraint**:
   ```cypher
   CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) 
   REQUIRE (e.tenant_id, e.name) IS UNIQUE
   ```
   * Tenant 1's "FastAPI" node is physically distinct from Tenant 2's "FastAPI" node!
2. **Idempotent Upsert (`MERGE` & `UNWIND`)**:
   ```cypher
   UNWIND $entities AS ent
   MERGE (e:Entity {tenant_id: $tenant_id, name: ent.name})
   ON CREATE SET e.type = ent.type, e.chunk_ids = [$chunk_id], e.source_ids = [$source_id]
   ON MATCH SET e.chunk_ids = CASE WHEN NOT $chunk_id IN e.chunk_ids THEN e.chunk_ids + $chunk_id ELSE e.chunk_ids END
   ```
3. **Tenant-Safe Multi-Hop Traversal**:
   ```cypher
   MATCH (start:Entity {tenant_id: $tenant_id})
   WHERE start.name IN $entity_names
   OPTIONAL MATCH path = (start)-[r:RELATION*1..{max_hops}]-(connected:Entity {tenant_id: $tenant_id})
   RETURN start, path
   LIMIT $limit
   ```
   Because every step along the path matches `{tenant_id: $tenant_id}`, it is mathematically impossible for traversals to cross tenant boundaries.

### Cascading Document Deletion in Graphs
When a source document is deleted, we don't want orphaned nodes cluttering the graph:
1. We filter all edges where `$source_id IN r.source_ids` and remove that ID. If no sources remain on the edge, it is deleted.
2. We filter all nodes where `$source_id IN e.source_ids`. If no sources remain on the node, it is deleted via `DETACH DELETE`.

---

## 8. Pillar 7: Hybrid GraphRAG Query Synthesis Engine

With both the Vector Store and the Knowledge Graph operational, the hybrid query synthesis engine unites both retrieval channels:

```
                              User Question
                 "What security system does Project Titan depend on?"
                                    │
                                    ├── Step 1: Query Analysis (Extract seed entities: ["Project Titan"])
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        [Vector Search (pgvector)]         [Graph Traversal (Neo4j)]
        Finds top 3 semantic chunks:        Traverses 2 hops from "Project Titan":
        - Chunk 12 (Titan security setup)   - (Alice)-[MANAGES]->(Project Titan)
        - Chunk 15 (Auth protocols)         - (Project Titan)-[DEPENDS_ON]->(Hydra Auth)
                  │                                   │
                  └─────────────────┬─────────────────┘
                                    ▼
                         [Context Fusion Engine]
         Creates an unified prompt with both text passages and graph triples
                                    ▼
                         [Google Gemini 2.5 Flash]
                                    ▼
                           Grounded Synthesis
             "According to your organization's knowledge base, Project Titan 
              depends on Hydra Auth for security and authentication protocols... 
              [Citations: titan_architecture.txt #1, (Titan -> DEPENDS_ON -> Hydra)]"
```

### Context Fusion Architecture
The context fusion function (`build_fusion_context` in `app/services/synthesis.py`) organizes the disparate retrieval outputs into clear, hierarchical markdown sections:
1. **Verified Knowledge Graph Relationships**: Direct relational triples `(Entity A) --[RELATION]--> (Entity B)` with descriptions and connection strengths.
2. **Verified Document Passages**: Full text chunks accompanied by source names, chunk IDs, and Cosine relevance scores.

### Strict Grounding & Anti-Hallucination Guardrails
To prevent the LLM from hallucinating answers when information is missing:
1. **System Directive**: The prompt explicitly enforces:
   *"Rely SOLELY on the provided Document Passages and Knowledge Graph Relationships. If the context does not contain enough information, respond: 'Based on your organization's knowledge base, there is insufficient information to answer this question.' Do NOT speculate or extrapolate."*
2. **Dual-Track Citations**:
   - `source_citations`: Document title, chunk ID, snippet, and numerical similarity score.
   - `graph_citations`: Explicit relational triples that justify the logical deduction.
3. **Cross-Tenant Guardrail**: If Tenant B queries concepts owned exclusively by Tenant A, the tenant filter in SQL and Cypher returns zero chunks and zero graph edges, causing the synthesizer to deterministically output the fallback message.

---

## 9. Pillar 8: Multi-Turn Conversation Memory & Chatbot Personalization

### Conversational Continuity
In an enterprise chatbot, questions rarely happen in isolation. Users naturally ask follow-up questions:
* Turn 1: *"What does Project Titan depend on?"* $\rightarrow$ *"It depends on Hydra Auth."*
* Turn 2: *"Is it vulnerable to any security issues?"*

Without conversation history, the LLM has no idea what "it" refers to.
We designed a two-tiered conversation model:
* **`Conversation`**: Maintains tenant ownership, user reference, title, and session timestamps.
* **`ChatMessage`**: Stores role (`user` vs `assistant`), text content, and `citations_json` serializing the exact vector chunk references and knowledge graph triples that informed that specific turn.

When the user asks a follow-up, the last $N$ turns are formatted and injected into the prompt, enabling seamless coreference resolution while keeping context window costs low.

### Tenant Persona & Custom Instructions
Different organizations require distinct communication styles:
* A financial services firm requires a formal, cautious, conservative tone.
* An internal engineering documentation bot requires a concise, technical, code-oriented tone.

`ChatbotConfig` enables per-tenant customization of:
* **Tone**: `professional`, `technical`, `friendly`, or `concise`.
* **System Prompt**: Custom directives injected into Gemini's instruction block.
* **Retrieval Hyperparameters**: Default `top_k_chunks` and `max_graph_hops` tuned to the tenant's data density.

---

## 10. Pillar 9: Web Page Ingestion & SSRF Protection (US-2.2)

### The Threat: Server-Side Request Forgery (SSRF)
When a platform allows users to input arbitrary URLs for the server to crawl, attackers often exploit this to probe internal infrastructure:
* Attempting `http://localhost:8000/docs` (attacking local backend).
* Attempting `http://127.0.0.1:7687` (attacking local Neo4j Bolt port).
* Attempting `http://169.254.169.254/latest/meta-data` (stealing AWS IAM role credentials).
* Attempting `http://192.168.1.1` (scanning local intranet routers).

### Our Multi-Layered SSRF Defense
In `app/services/crawler.py`, we implemented strict validation:
1. **Protocol Check**: Only `http` and `https` are accepted (blocking `file://`, `gopher://`, `ftp://`).
2. **DNS Resolution & IP Classification**:
   * The hostname is resolved to physical IP addresses via `socket.getaddrinfo`.
   * Each resolved IP is validated against `ipaddress.ip_address`:
     - `ip.is_private` (blocks `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
     - `ip.is_loopback` (blocks `127.0.0.1`, `::1`)
     - `ip.is_link_local` (blocks `169.254.0.0/16`)
     - `ip.is_reserved`, `ip.is_multicast`, `ip.is_unspecified`
   * Any restricted address immediately aborts with `HTTP 400 Bad Request` before any HTTP connection can be established!

---

## 11. Summary Table of Architectural Decisions & Tradeoffs

| Component | Choice Made | Alternatives Considered | Why We Chose It |
| :--- | :--- | :--- | :--- |
| **Multi-Tenancy** | Shared DB + Row-Level (`TenantMixin`) | Separate DB per tenant, Schema-per-tenant | Massive scalability, low resource cost, unified migrations. |
| **Document Parsing** | Native Python (`pypdf`, `python-docx`) | External OCR / Tesseract / Unstructured.io | Zero heavy external C-dependencies, instant test execution. |
| **Chunking** | Recursive Character Splitter with Overlap | Fixed character length, Sentence splitter | Preserves semantic paragraph integrity and boundary context. |
| **Async Tasks** | FastAPI `BackgroundTasks` | Celery + Redis, RabbitMQ | Simple, lightweight, zero extra broker containers needed for internship scope. |
| **Vector DB** | PostgreSQL + `pgvector` | Pinecone, Qdrant, ChromaDB, Milvus | ACID compliance in primary DB; unified transactions; no sync latency. |
| **Embedding Model** | Gemini `text-embedding-004` (768-dim) | OpenAI `text-embedding-3`, HuggingFace local | State-of-the-art retrieval benchmark scores; generous free tier. |
| **Graph DB** | Neo4j Community 5.26 (Docker) | Amazon Neptune, AWS Memgraph, NetworkX | Native Cypher query language, industry standard, visual Web UI. |
| **Entity Extraction** | Gemini 2.5 Flash (Structured JSON) | Spacy NER, Stanford NLP, Regex only | Discovers arbitrary custom entity and relationship types without pre-training. |
| **Graph Multi-Tenancy**| `tenant_id` stamping on Nodes & Edges | Neo4j Enterprise Multi-Database | Supported in free Neo4j Community edition; 100% strict data boundary. |
| **Chat Memory** | Relational `Conversation` & `ChatMessage` | In-memory Redis store | Durable session logs, verifiable historical citations, ACID integrity. |
| **Web Ingestion** | Async `httpx` + SSRF IP Filter | Selenium / Playwright headless browsers | Lightweight, fast text extraction, zero browser binary overhead. |
| **Frontend Framework** | React 19 + Vite 8 SPA | Next.js, Remix, Vanilla HTML/JS | Behind-auth dashboard requires no SSR/SEO; instant HMR; zero second Node server needed. |
| **Widget Isolation** | Pure Shadow DOM (`attachShadow`) | Standard `<iframe>`, Global script injection | 100% immune to host CSS/Tailwind collisions; full responsive freedom without iframe resize glitches. |
| **Graph Visualizer** | `vis-network` (ForceAtlas2 physics) | D3.js, Cytoscape.js, Three.js 3D | Built-in spring physics simulation; smooth zoom/pan; rich node click events. |

---

## 12. Pillar 10: React + Vite Frontend Architecture vs Next.js

### Why React + Vite Over Next.js for Enterprise Dashboards
When architecting the frontend for the GraphRAG platform, we evaluated whether to use **Next.js (App Router)** or a modern **React + Vite SPA**. We chose React + Vite for three decisive engineering reasons:

1. **Authentication Boundary (No SSR or SEO Needed)**:
   * Next.js specializes in Server-Side Rendering (SSR) and Static Site Generation (SSG) for search engine indexing (SEO) and fast first-contentful paint on public marketing pages.
   * An enterprise RAG studio, document manager, and graph visualizer live **100% behind authentication**. Search engines will never crawl these pages, eliminating any benefit of SSR while avoiding server-side hydration mismatches and cookie-forwarding complexity.

2. **Decoupled Architecture & Single Python Runtime**:
   * Next.js requires running a dedicated Node.js production server in addition to the FastAPI backend, doubling operational overhead, memory consumption, and Docker container orchestration.
   * Vite compiles into pure static assets (`HTML`, `JS`, `CSS`). These static assets can be served by NGINX, Cloudflare Pages, S3, or directly mounted inside FastAPI using `StaticFiles` — requiring zero additional runtime servers.

3. **Development Ergonomics**:
   * Vite leverages native browser ES Modules (ESM) and Rollup-based bundling. Hot Module Replacement (HMR) operates in milliseconds regardless of codebase scale.
   * Vite's built-in reverse proxy (`/api` $\rightarrow$ `http://127.0.0.1:8000`) completely circumvents browser Cross-Origin Resource Sharing (CORS) preflight friction during local development.

---

## 13. Pillar 11: Embeddable Micro-Frontend Widget & Shadow DOM Isolation

### The Third-Party Integration Challenge
A core capability of the OmniGraph platform is providing an embeddable customer-facing chatbot widget that clients can paste onto their existing websites via a simple snippet:

```html
<script 
  src="https://cdn.example.com/widget.js" 
  data-tenant-slug="acme-corp" 
  data-primary-color="#8B5CF6" 
  defer>
</script>
```

However, embedding arbitrary JavaScript on third-party websites presents severe styling and security challenges:
* Host websites run varied CSS frameworks (Tailwind CSS, Bootstrap, Material-UI, or legacy WordPress themes) that frequently use aggressive global style resets (e.g. `* { box-sizing: border-box; font-family: 'Comic Sans'; }`, `button { background: red !important; }`).
* If the chatbot widget was injected directly into the host page's regular DOM (`document.body`), the host site's CSS would override the widget's buttons, typography, and modal dialogs, breaking the user interface.
* Conversely, the widget's own stylesheets might inadvertently leak out and alter the host website's layout!

### The Solution: Shadow DOM Encapsulation
Rather than resorting to a clunky `<iframe>` (which suffers from rigid dimensions, mobile viewport clipping, and tricky cross-window messaging), we architected `widget.js` using the **Shadow DOM API**:

```javascript
// 1. Create host element
const host = document.createElement('div');
host.id = 'omnigraph-widget-container';
document.body.appendChild(host);

// 2. Attach an isolated Shadow Root
const shadow = host.attachShadow({ mode: 'open' });

// 3. Inject dedicated CSS strictly inside the shadow root
const style = document.createElement('style');
style.textContent = `...widget CSS...`;
shadow.appendChild(style);

// 4. Mount widget launcher bubble and chat modal inside shadow
shadow.appendChild(widgetDOM);
```

#### Why Shadow DOM is the Superior Architecture:
1. **Zero CSS Leakage**: Styles defined inside the shadow root *never* affect the outer host page.
2. **Complete Immunity to Host CSS**: Host site rules (even `!important` selectors) cannot penetrate the shadow boundary.
3. **Native DOM Integration**: Unlike an iframe, the widget remains part of the host browser window. It can dynamically expand from a $56\times56\text{px}$ floating launcher button into a $380\times580\text{px}$ chat window without requiring iframe height renegotiation postMessage calls.
4. **Lightweight (<15KB)**: Written in vanilla JavaScript using native browser APIs, requiring zero client-side dependencies.

### Unauthenticated Public Tenant Querying
Public website visitors do not possess administrative JWT credentials. To facilitate secure customer interactions without compromising multi-tenant security:
* We introduced public endpoints: `GET /api/v1/chat/public/{tenant_slug}/config` and `POST /api/v1/chat/public/{tenant_slug}/message`.
* The server resolves the active tenant via its unique slug, enforces active status checks, and executes `RAGPipelineService.answer_query` strictly scoped to that tenant's vector and graph boundaries.
* Administrative endpoints (document deletion, chunk re-indexing, user management) remain strictly protected by `Depends(get_current_user)`.

---

## 14. Pillar 12: Interactive Graph Visualization with `vis-network` & Dual Retrieval UX

### Force-Directed Physics Topology
To make the Neo4j knowledge graph intuitive and actionable for administrators, we integrated `vis-network` in `GraphExplorer.jsx`.
* **Physics Engine**: Employs the `ForceAtlas2` physics solver. Nodes repel one another based on configurable gravitational constants, while directed edges act as springs that pull connected concepts together.
* **Semantic Entity Categorization**: Entities are color-coded by category:
  - `PERSON`: Purple (`#8B5CF6`)
  - `PROJECT` / `SYSTEM`: Indigo (`#6366F1`)
  - `TECHNOLOGY` / `LANGUAGE`: Cyan (`#06B6D4`)
  - `ORGANIZATION` / `COMPANY`: Emerald (`#10B981`)
  - `CONCEPT` / `OTHER`: Amber (`#F59E0B`)
* **Dynamic Multi-Hop Expansion**: Clicking any node opens a deep-inspection drawer displaying all incoming and outgoing relational edges, along with an **"Expand Neighborhood from Here"** trigger that automatically queries Neo4j for the next hop.

### Dual-Retrieval UX (Demystifying the "Black Box" of RAG)
Traditional RAG interfaces output an answer without explaining how the model arrived at its conclusion. OmniGraph provides a **Dual Retrieval Citations Accordion** on every assistant message:
1. **Document Chunks (pgvector)**: Displays the exact source file name, chunk index, Cosine similarity score percentage, and verbatim chunk text.
2. **Relational Triples (Neo4j)**: Displays the explicit multi-hop graph paths (e.g. `(FastAPI) --[BUILT_WITH]--> (Python)`) and query entities extracted by Gemini.

This dual citation mechanism provides verifiable provenance, building enterprise trust and eliminating hallucinations.
