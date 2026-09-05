from fastapi import APIRouter, Depends
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.graph import (
    GraphNeighborhoodQuery,
    GraphNeighborhoodResponse,
    GraphStatsResponse,
)
from app.services.graph import get_graph_store

router = APIRouter(prefix="/graph", tags=["Knowledge Graph (Neo4j & Relationships)"])


@router.post(
    "/neighborhood",
    response_model=GraphNeighborhoodResponse,
    summary="Query multi-hop graph neighborhood for seed entities (strictly tenant-isolated)"
)
async def query_neighborhood(
    payload: GraphNeighborhoodQuery,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user)
):
    """
    Traverse the knowledge graph starting from seed entity names up to max_hops away.
    Returns connected nodes and directed relationships strictly scoped to the active tenant.
    """
    graph_store = await get_graph_store()
    return await graph_store.get_neighborhood(
        tenant_id=tenant.id,
        entity_names=payload.entity_names,
        max_hops=payload.max_hops,
        limit=payload.limit
    )


@router.get(
    "/stats",
    response_model=GraphStatsResponse,
    summary="Get total entity and relationship count for the active tenant"
)
async def get_graph_stats(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user)
):
    """
    Returns graph statistics (node count and edge count) strictly scoped to the active tenant.
    """
    graph_store = await get_graph_store()
    return await graph_store.get_stats(tenant_id=tenant.id)
