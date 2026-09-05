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

## 9. Summary Table of Architectural Decisions & Tradeoffs

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
