from fastapi import APIRouter
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.tenants import router as tenants_router
from app.api.v1.endpoints.items import router as items_router
from app.api.v1.endpoints.sources import router as sources_router
from app.api.v1.endpoints.graph import router as graph_router
from app.api.v1.endpoints.rag import router as rag_router
from app.api.v1.endpoints.chatbot import router as chatbot_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.ai_profiles import router as ai_profiles_router
from app.api.v1.endpoints.personas import router as personas_router

api_v1_router = APIRouter()

api_v1_router.include_router(auth_router)
api_v1_router.include_router(tenants_router)
api_v1_router.include_router(items_router)
api_v1_router.include_router(sources_router)
api_v1_router.include_router(graph_router)
api_v1_router.include_router(rag_router)
api_v1_router.include_router(chatbot_router)
api_v1_router.include_router(chat_router)
api_v1_router.include_router(ai_profiles_router)
api_v1_router.include_router(personas_router)


