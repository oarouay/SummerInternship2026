"""Add pgvector HNSW ANN index on document_chunks.embedding and ensure tenant_id btree index

Revision ID: 0001_add_hnsw_index
Revises: 
Create Date: 2026-09-23 12:00:00.000000

"""
from typing import Sequence, Union
import logging

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

from app.core.config import settings

logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "0001_add_hnsw_index"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def get_pgvector_version(conn) -> str:
    """Detect installed pgvector extension version."""
    try:
        res = conn.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector';")).scalar()
        return str(res or "0.0.0")
    except Exception:
        return "0.0.0"


def version_tuple(v_str: str):
    clean = v_str.split("-")[0]
    parts = []
    for part in clean.split("."):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def upgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name.lower()

    if "postgres" not in dialect:
        logger.info(f"Skipping pgvector HNSW index creation for non-Postgres dialect: {dialect}")
        return

    # Ensure pgvector extension is created
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))

    # Ensure btree index on DocumentChunk.tenant_id exists for efficient tenant pre-filtering
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_tenant_id ON document_chunks (tenant_id);"))

    # Check pgvector version
    pgv_version = get_pgvector_version(conn)
    m_val = getattr(settings, "HNSW_M", 16)
    ef_const_val = getattr(settings, "HNSW_EF_CONSTRUCTION", 64)

    if version_tuple(pgv_version) >= (0, 5, 0):
        # HNSW index supported (pgvector >= 0.5.0)
        logger.info(f"Creating HNSW ANN index (pgvector {pgv_version}, m={m_val}, ef_construction={ef_const_val})...")
        conn.execute(text(
            f"""
            CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_hnsw
            ON document_chunks USING hnsw (embedding vector_cosine_ops)
            WITH (m = {m_val}, ef_construction = {ef_const_val});
            """
        ))
    else:
        # Fallback to IVFFlat for older pgvector (< 0.5.0)
        # Note: IVFFlat requires periodic REINDEX as data volume grows, unlike HNSW.
        lists_val = 100
        logger.warning(
            f"Installed pgvector version ({pgv_version}) does not support HNSW (requires >= 0.5.0). "
            f"Falling back to IVFFlat index (lists={lists_val}). Note: IVFFlat requires periodic REINDEX."
        )
        conn.execute(text(
            f"""
            CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_ivfflat
            ON document_chunks USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = {lists_val});
            """
        ))


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name.lower()
    if "postgres" in dialect:
        conn.execute(text("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw;"))
        conn.execute(text("DROP INDEX IF EXISTS ix_document_chunks_embedding_ivfflat;"))
        conn.execute(text("DROP INDEX IF EXISTS ix_document_chunks_tenant_id;"))
