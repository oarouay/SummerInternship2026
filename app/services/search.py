from typing import List, Optional
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import DocumentChunk
from app.models.source import Source
from app.schemas.search import SearchResult


def _calculate_cosine_distance(vec_a: List[float], vec_b: List[float]) -> float:
    """Calculates cosine distance (1.0 - cosine_similarity) between two vectors."""
    a = np.array(vec_a, dtype=np.float32)
    b = np.array(vec_b, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 1.0
    similarity = float(np.dot(a, b) / (norm_a * norm_b))
    return float(max(0.0, 1.0 - similarity))


async def search_similar_chunks(
    db: AsyncSession,
    tenant_id: int,
    query_vector: List[float],
    top_k: int = 5,
    source_id: Optional[int] = None
) -> List[SearchResult]:
    """
    Performs tenant-isolated vector semantic search using Cosine Distance.
    Uses native pgvector `<=>` on PostgreSQL, with an in-memory numpy fallback on SQLite.
    """
    # Detect dialect
    bind = db.bind or getattr(db.sync_session, "bind", None)
    is_postgres = bool(bind and "postgres" in str(bind.dialect.name).lower())

    if is_postgres:
        # Native pgvector Cosine Distance (<=>)
        stmt = (
            select(
                DocumentChunk,
                Source.name.label("source_name"),
                DocumentChunk.embedding.cosine_distance(query_vector).label("distance")
            )
            .join(Source, DocumentChunk.source_id == Source.id)
            .where(
                DocumentChunk.tenant_id == tenant_id,
                DocumentChunk.embedding.is_not(None)
            )
        )
        if source_id:
            stmt = stmt.where(DocumentChunk.source_id == source_id)

        stmt = stmt.order_by("distance").limit(top_k)
        result = await db.execute(stmt)
        rows = result.all()

        results = []
        for chunk, src_name, dist in rows:
            dist_val = float(dist)
            score = max(0.0, round(1.0 - dist_val, 4))
            results.append(
                SearchResult(
                    chunk_id=chunk.id,
                    source_id=chunk.source_id,
                    source_name=src_name,
                    chunk_index=chunk.chunk_index,
                    content=chunk.content,
                    score=score,
                    distance=round(dist_val, 4)
                )
            )
        return results

    else:
        # In-memory numpy fallback for SQLite tests and offline dev
        stmt = (
            select(DocumentChunk, Source.name.label("source_name"))
            .join(Source, DocumentChunk.source_id == Source.id)
            .where(
                DocumentChunk.tenant_id == tenant_id,
                DocumentChunk.embedding.is_not(None)
            )
        )
        if source_id:
            stmt = stmt.where(DocumentChunk.source_id == source_id)

        result = await db.execute(stmt)
        rows = result.all()

        candidates = []
        for chunk, src_name in rows:
            if chunk.embedding is not None:
                # Convert embedding if stored as pgvector Vector or list
                emb = list(chunk.embedding) if hasattr(chunk.embedding, "__iter__") else []
                if len(emb) == len(query_vector):
                    dist = _calculate_cosine_distance(query_vector, emb)
                    score = max(0.0, round(1.0 - dist, 4))
                    candidates.append((chunk, src_name, dist, score))

        # Sort by distance ascending (closest first)
        candidates.sort(key=lambda x: x[2])
        top_candidates = candidates[:top_k]

        return [
            SearchResult(
                chunk_id=chunk.id,
                source_id=chunk.source_id,
                source_name=src_name,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                score=score,
                distance=round(dist, 4)
            )
            for chunk, src_name, dist, score in top_candidates
        ]
