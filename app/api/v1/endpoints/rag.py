from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.rag import RAGQueryRequest, RAGQueryResponse
from app.services.synthesis import RAGPipelineService

router = APIRouter(prefix="/rag", tags=["Hybrid GraphRAG Synthesis"])


@router.post(
    "/query",
    response_model=RAGQueryResponse,
    summary="Ask a question and synthesize an answer combining pgvector and Neo4j Knowledge Graph"
)
async def query_graphrag(
    payload: RAGQueryRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Executes the full Hybrid GraphRAG pipeline:
    1. Extracts entities from the query question.
    2. Runs vector semantic search in PostgreSQL (`pgvector`) using Cosine Distance.
    3. Runs multi-hop graph traversal in Neo4j to find connected entity relationships.
    4. Fuses both knowledge representations into a unified context prompt.
    5. Synthesizes a grounded answer with verifiable document and graph citations.
    """
    return await RAGPipelineService.answer_query(
        db=db,
        tenant_id=tenant.id,
        query=payload.query,
        top_k_chunks=payload.top_k_chunks,
        max_graph_hops=payload.max_graph_hops,
        temperature=payload.temperature,
        source_id=payload.source_id,
        tenant_name=tenant.name,
    )
