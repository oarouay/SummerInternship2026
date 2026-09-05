from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.chatbot import ChatbotConfig
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.chatbot import ChatbotConfigRead, ChatbotConfigUpdate

router = APIRouter(prefix="/chatbot", tags=["Chatbot Configuration & Personalization"])


@router.get(
    "/settings",
    response_model=ChatbotConfigRead,
    summary="Get chatbot configuration and persona for active tenant"
)
async def get_chatbot_settings(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the chatbot settings for the calling tenant.
    If no settings exist yet, automatically initializes default settings.
    """
    stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    res = await db.execute(stmt)
    config = res.scalar_one_or_none()

    if not config:
        config = ChatbotConfig(tenant_id=tenant.id)
        db.add(config)
        await db.commit()
        await db.refresh(config)

    return config


@router.put(
    "/settings",
    response_model=ChatbotConfigRead,
    summary="Update chatbot persona, tone, welcome message, and retrieval parameters"
)
async def update_chatbot_settings(
    payload: ChatbotConfigUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates chatbot persona settings (tone, welcome message, system prompt, default Top-K).
    """
    stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    res = await db.execute(stmt)
    config = res.scalar_one_or_none()

    if not config:
        config = ChatbotConfig(tenant_id=tenant.id)
        db.add(config)

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(config, k, v)

    await db.commit()
    await db.refresh(config)
    return config
