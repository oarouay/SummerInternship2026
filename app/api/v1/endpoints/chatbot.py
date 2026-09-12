from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.chatbot import ChatbotConfig
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.chatbot import (
    ChatbotConfigRead,
    ChatbotConfigUpdate,
    GeminiKeyValidationRequest,
    GeminiKeyValidationResponse,
)

router = APIRouter(prefix="/chatbot", tags=["Chatbot Configuration & Personalization"])


def _to_read_schema(config: ChatbotConfig) -> ChatbotConfigRead:
    key = config.gemini_api_key
    has_key = bool(key and key.strip())
    preview = None
    if has_key:
        cleaned = key.strip()
        preview = f"••••••••{cleaned[-4:]}" if len(cleaned) >= 4 else "••••••••"

    sys_configured = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip())

    return ChatbotConfigRead(
        id=config.id,
        tenant_id=config.tenant_id,
        name=config.name,
        avatar_url=config.avatar_url,
        welcome_message=config.welcome_message,
        tone=config.tone,
        system_prompt=config.system_prompt,
        default_top_k=config.default_top_k,
        default_max_hops=config.default_max_hops,
        temperature=config.temperature,
        has_custom_api_key=has_key,
        gemini_api_key_preview=preview,
        system_api_key_configured=sys_configured,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


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

    return _to_read_schema(config)


@router.put(
    "/settings",
    response_model=ChatbotConfigRead,
    summary="Update chatbot persona, tone, welcome message, retrieval parameters, and Gemini API key"
)
async def update_chatbot_settings(
    payload: ChatbotConfigUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates chatbot persona settings (tone, welcome message, system prompt, default Top-K, Gemini API key).
    """
    stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    res = await db.execute(stmt)
    config = res.scalar_one_or_none()

    if not config:
        config = ChatbotConfig(tenant_id=tenant.id)
        db.add(config)

    update_data = payload.model_dump(exclude_unset=True)

    # Handle gemini_api_key explicitly (empty string unsets key to revert to system default)
    if "gemini_api_key" in update_data:
        raw_key = update_data.pop("gemini_api_key")
        if raw_key is not None:
            cleaned = raw_key.strip()
            config.gemini_api_key = cleaned if cleaned else None

    for k, v in update_data.items():
        setattr(config, k, v)

    await db.commit()
    await db.refresh(config)
    return _to_read_schema(config)


@router.post(
    "/validate-gemini-key",
    response_model=GeminiKeyValidationResponse,
    summary="Test and validate a Gemini API key live against Google Generative AI"
)
async def validate_gemini_key(
    payload: GeminiKeyValidationRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Tests either the provided Gemini API key, or the active tenant key, or the system default.
    Performs a lightweight validation ping against the Gemini API.
    """
    key_to_test = payload.api_key.strip() if payload.api_key else None

    if not key_to_test:
        stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
        res = await db.execute(stmt)
        cfg = res.scalar_one_or_none()
        if cfg and cfg.gemini_api_key:
            key_to_test = cfg.gemini_api_key.strip()
        elif settings.GEMINI_API_KEY:
            key_to_test = settings.GEMINI_API_KEY.strip()

    if not key_to_test:
        return GeminiKeyValidationResponse(
            valid=False,
            model=settings.LLM_MODEL,
            message="No Gemini API key provided or configured in tenant settings or .env."
        )

    try:
        from google import genai
        client = genai.Client(api_key=key_to_test)
        response = client.models.generate_content(
            model=settings.LLM_MODEL,
            contents="Respond with OK"
        )
        if response and response.text:
            return GeminiKeyValidationResponse(
                valid=True,
                model=settings.LLM_MODEL,
                message="Gemini API Key is valid and active."
            )
        return GeminiKeyValidationResponse(
            valid=False,
            model=settings.LLM_MODEL,
            message="Gemini API returned an empty response."
        )
    except Exception as e:
        err_msg = str(e)
        if "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg:
            return GeminiKeyValidationResponse(
                valid=True,
                model=settings.LLM_MODEL,
                message="Gemini API Key is valid (active Google quota reached, ready for generation)."
            )
        return GeminiKeyValidationResponse(
            valid=False,
            model=settings.LLM_MODEL,
            message=f"Gemini API Error: {err_msg}"
        )

