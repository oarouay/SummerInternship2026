from fastapi import APIRouter
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.tenants import router as tenants_router
from app.api.v1.endpoints.items import router as items_router
from app.api.v1.endpoints.sources import router as sources_router
from app.api.v1.endpoints.graph import router as graph_router
from app.api.v1.endpoints.rag import router as rag_router

api_v1_router = APIRouter()

api_v1_router.include_router(auth_router)
api_v1_router.include_router(tenants_router)
api_v1_router.include_router(items_router)
api_v1_router.include_router(sources_router)
api_v1_router.include_router(graph_router)
api_v1_router.include_router(rag_router)


