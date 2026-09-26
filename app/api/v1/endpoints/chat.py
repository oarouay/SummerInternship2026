import json
import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.chatbot import ChatbotConfig
from app.models.conversation import ChatMessage, Conversation
from app.models.ai_profile import Persona
from app.services.ai_profile_service import AIProfileService
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.conversation import (
    ChatMessageRead,
    ChatMessageSendRequest,
    ConversationCreate,
    ConversationUpdate,
    ConversationListItem,
    ConversationRead,
    PublicChatMessageRequest,
)
from app.schemas.rag import RAGQueryResponse
from app.services.synthesis import RAGPipelineService

router = APIRouter(prefix="/chat", tags=["Multi-Turn Chat & Conversation Sessions"])


@router.post(
    "/conversations",
    response_model=ConversationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new multi-turn conversation session"
)
async def create_conversation(
    payload: ConversationCreate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Start a new chat session scoped to the active tenant."""
    conversation = Conversation(
        tenant_id=tenant.id,
        user_id=current_user.id,
        title=payload.title or "New Conversation"
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

    return ConversationRead(
        id=conversation.id,
        tenant_id=conversation.tenant_id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[]
    )


@router.get(
    "/conversations",
    response_model=List[ConversationListItem],
    summary="List all conversation sessions for the active tenant"
)
async def list_conversations(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List recent conversation sessions with message counts."""
    # Subquery for message counts
    count_subq = (
        select(ChatMessage.conversation_id, func.count(ChatMessage.id).label("msg_count"))
        .where(ChatMessage.tenant_id == tenant.id)
        .group_by(ChatMessage.conversation_id)
        .subquery()
    )

    stmt = (
        select(Conversation, func.coalesce(count_subq.c.msg_count, 0).label("message_count"))
        .outerjoin(count_subq, Conversation.id == count_subq.c.conversation_id)
        .where(Conversation.tenant_id == tenant.id)
        .order_by(Conversation.updated_at.desc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    items = []
    for conv, msg_count in rows:
        items.append(
            ConversationListItem(
                id=conv.id,
                tenant_id=conv.tenant_id,
                title=conv.title,
                created_at=conv.created_at,
                updated_at=conv.updated_at,
                message_count=msg_count
            )
        )
    return items


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    summary="Get conversation details and full message history"
)
async def get_conversation(
    conversation_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all messages and citations in a specific conversation session."""
    stmt = (
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.tenant_id == tenant.id)
    )
    res = await db.execute(stmt)
    conv = res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found in your organization."
        )

    msg_stmt = (
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id, ChatMessage.tenant_id == tenant.id)
        .order_by(ChatMessage.id.asc())
    )
    msg_res = await db.execute(msg_stmt)
    messages = msg_res.scalars().all()

    return ConversationRead(
        id=conv.id,
        tenant_id=conv.tenant_id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[ChatMessageRead.from_orm_with_citations(m) for m in messages]
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ChatMessageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Send a message in a conversation and receive a grounded GraphRAG response"
)
async def send_chat_message(
    conversation_id: int,
    payload: ChatMessageSendRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Submits a user prompt, retrieves relevant vector chunks and knowledge graph relationships
    with conversation memory context, and returns the assistant's answer with citations.
    """
    # 1. Fetch conversation
    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.tenant_id == tenant.id)
    )
    res = await db.execute(stmt)
    conv = res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found in your organization."
        )

    # 2. Resolve Active AIProfile and Persona for tenant
    profile = None
    active_persona = None
    try:
        profile, active_persona = await AIProfileService.get_or_create_default_profile(
            db=db, tenant_id=tenant.id, tenant_name=tenant.name
        )
        if payload.persona_id:
            p_stmt = select(Persona).where(Persona.id == payload.persona_id, Persona.tenant_id == tenant.id)
            p_res = await db.execute(p_stmt)
            req_p = p_res.scalar_one_or_none()
            if req_p:
                active_persona = req_p
    except Exception as prof_err:
        logger.warning(f"AI Profile resolution notice: {prof_err}")

    # Fetch ChatbotConfig for API key overrides and fallbacks
    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    top_k = payload.top_k_chunks or (profile.retrieval_policy.get("topK", 4) if profile else (config.default_top_k if config else 4))
    max_hops = payload.max_graph_hops or (profile.retrieval_policy.get("maxGraphDepth", 2) if profile else (config.default_max_hops if config else 2))
    tone = active_persona.tone if active_persona else (config.tone if config else "professional")
    sys_prompt = config.system_prompt if config else None
    temperature = config.temperature if config else 0.2

    # 3. Format past conversation history
    history = [{"role": m.role, "content": m.content} for m in conv.messages]

    # 4. Save User message
    user_msg = ChatMessage(
        tenant_id=tenant.id,
        conversation_id=conversation_id,
        role="user",
        content=payload.message
    )
    db.add(user_msg)
    conv.messages.append(user_msg)

    # 5. Call RAG Pipeline with conversation history and active AI Profile
    rag_response = await RAGPipelineService.answer_query(
        db=db,
        tenant_id=tenant.id,
        query=payload.message,
        top_k_chunks=top_k,
        max_graph_hops=max_hops,
        temperature=temperature,
        conversation_history=history,
        persona_tone=tone,
        custom_system_prompt=sys_prompt,
        gemini_api_key=config.gemini_api_key if config else None,
        tenant_name=tenant.name,
        openai_api_key=config.openai_api_key if config else None,
        ai_profile=profile,
        persona=active_persona,
    )

    # 6. Save Assistant response with citations, audit metadata, and router action
    citations_data = {
        "action": rag_response.action,
        "clarification_options": rag_response.clarification_options,
        "standalone_query": rag_response.standalone_query,
        "follow_up_suggestions": rag_response.follow_up_suggestions,
        "needs_clarification": rag_response.needs_clarification,
        "sources": [s.model_dump() for s in rag_response.source_citations],
        "graph": [g.model_dump() for g in rag_response.graph_citations],
        "entities_detected": rag_response.entities_detected,
        "execution_time_ms": rag_response.execution_time_ms,
        "evidence_status": rag_response.evidence_status,
        "ai_profile_version": rag_response.ai_profile_version,
        "persona_name": rag_response.persona_name,
    }
    assistant_msg = ChatMessage(
        tenant_id=tenant.id,
        conversation_id=conversation_id,
        role="assistant",
        content=rag_response.answer,
        citations_json=json.dumps(citations_data)
    )
    db.add(assistant_msg)
    conv.messages.append(assistant_msg)

    # 7. Update title if first message
    if conv.title == "New Conversation":
        snippet = payload.message[:35].strip()
        conv.title = snippet + ("..." if len(payload.message) > 35 else "")

    await db.commit()
    await db.refresh(assistant_msg)

    return ChatMessageRead.from_orm_with_citations(assistant_msg)


@router.post(
    "/conversations/{conversation_id}/messages/stream",
    summary="Send a message in a conversation and receive a streaming SSE response with grounded GraphRAG tokens"
)
async def send_chat_message_stream(
    conversation_id: int,
    payload: ChatMessageSendRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Submits a user prompt, retrieves relevant vector chunks and knowledge graph relationships
    with conversation memory context, and streams the assistant's answer token-by-token via SSE,
    finishing with a metadata event containing citations and follow-up suggestions.
    """
    # 1. Fetch conversation
    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.tenant_id == tenant.id)
    )
    res = await db.execute(stmt)
    conv = res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found in your organization."
        )

    # 2. Resolve Active AIProfile and Persona for tenant
    profile = None
    active_persona = None
    try:
        profile, active_persona = await AIProfileService.get_or_create_default_profile(
            db=db, tenant_id=tenant.id, tenant_name=tenant.name
        )
        if payload.persona_id:
            p_stmt = select(Persona).where(Persona.id == payload.persona_id, Persona.tenant_id == tenant.id)
            p_res = await db.execute(p_stmt)
            req_p = p_res.scalar_one_or_none()
            if req_p:
                active_persona = req_p
    except Exception as prof_err:
        logger.warning(f"AI Profile resolution notice: {prof_err}")

    # Fetch ChatbotConfig for API key overrides and fallbacks
    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    top_k = payload.top_k_chunks or (profile.retrieval_policy.get("topK", 4) if profile else (config.default_top_k if config else 4))
    max_hops = payload.max_graph_hops or (profile.retrieval_policy.get("maxGraphDepth", 2) if profile else (config.default_max_hops if config else 2))
    tone = active_persona.tone if active_persona else (config.tone if config else "professional")
    sys_prompt = config.system_prompt if config else None
    temperature = config.temperature if config else 0.2

    # 3. Format past conversation history
    history = [{"role": m.role, "content": m.content} for m in conv.messages]

    # 4. Save User message immediately
    user_msg = ChatMessage(
        tenant_id=tenant.id,
        conversation_id=conversation_id,
        role="user",
        content=payload.message
    )
    db.add(user_msg)
    conv.messages.append(user_msg)
    await db.commit()

    async def sse_event_generator():
        accumulated_text = []
        terminal_metadata = None
        try:
            async for event in RAGPipelineService.answer_query_stream(
                db=db,
                tenant_id=tenant.id,
                query=payload.message,
                top_k_chunks=top_k,
                max_graph_hops=max_hops,
                temperature=temperature,
                conversation_history=history,
                persona_tone=tone,
                custom_system_prompt=sys_prompt,
                gemini_api_key=config.gemini_api_key if config else None,
                tenant_name=tenant.name,
                openai_api_key=config.openai_api_key if config else None,
                ai_profile=profile,
                persona=active_persona,
            ):
                if event["type"] == "token":
                    accumulated_text.append(event["text"])
                    token_data = json.dumps({"text": event["text"]})
                    yield f"event: token\ndata: {token_data}\n\n"
                elif event["type"] == "metadata":
                    terminal_metadata = event
                    meta_payload = {k: v for k, v in event.items() if k != "type"}
                    yield f"event: metadata\ndata: {json.dumps(meta_payload)}\n\n"
        except Exception as e:
            logger.error(f"Error during SSE chat stream: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"
            return

        # 6. Save Assistant response with citations, audit metadata, and router action into database
        try:
            full_answer = "".join(accumulated_text)
            citations_data = {
                "action": terminal_metadata.get("action") if terminal_metadata else "retrieve",
                "clarification_options": terminal_metadata.get("clarification_options", []) if terminal_metadata else [],
                "standalone_query": terminal_metadata.get("standalone_query") if terminal_metadata else None,
                "follow_up_suggestions": terminal_metadata.get("follow_up_suggestions", []) if terminal_metadata else [],
                "needs_clarification": terminal_metadata.get("needs_clarification", False) if terminal_metadata else False,
                "sources": terminal_metadata.get("source_citations", []) if terminal_metadata else [],
                "graph": terminal_metadata.get("graph_citations", []) if terminal_metadata else [],
                "entities_detected": terminal_metadata.get("entities_detected", []) if terminal_metadata else [],
                "execution_time_ms": terminal_metadata.get("execution_time_ms", 0) if terminal_metadata else 0,
                "evidence_status": terminal_metadata.get("evidence_status", "sufficient") if terminal_metadata else "sufficient",
                "ai_profile_version": terminal_metadata.get("ai_profile_version") if terminal_metadata else (profile.version if profile else None),
                "persona_name": terminal_metadata.get("persona_name") if terminal_metadata else (active_persona.name if active_persona else None),
            }
            assistant_msg = ChatMessage(
                tenant_id=tenant.id,
                conversation_id=conversation_id,
                role="assistant",
                content=full_answer,
                citations_json=json.dumps(citations_data)
            )
            db.add(assistant_msg)
            if conv.title == "New Conversation":
                snippet = payload.message[:35].strip()
                conv.title = snippet + ("..." if len(payload.message) > 35 else "")
            await db.commit()
        except Exception as persist_err:
            logger.warning(f"Failed to persist streamed assistant message: {persist_err}")

        # 7. Final done event
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        sse_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationListItem,
    summary="Rename a conversation session"
)
async def rename_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Rename a conversation title, strictly validating tenant ownership."""
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.tenant_id == tenant.id
    )
    res = await db.execute(stmt)
    conv = res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found in your organization."
        )

    conv.title = payload.title.strip()
    await db.commit()
    await db.refresh(conv)

    return ConversationListItem(
        id=conv.id,
        tenant_id=conv.tenant_id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=0
    )


@router.delete(
    "/conversations/{conversation_id}",
    summary="Delete a conversation and all its messages"
)
async def delete_conversation(
    conversation_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Permanently delete a conversation session and all its messages."""
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.tenant_id == tenant.id
    )
    res = await db.execute(stmt)
    conv = res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found in your organization."
        )

    await db.delete(conv)
    await db.commit()
    return {"detail": "Conversation deleted successfully."}


@router.get(
    "/public/{tenant_slug}/config",
    summary="Public endpoint: Get chatbot branding & welcome config for website widget"
)
async def get_public_chatbot_config(
    tenant_slug: str,
    db: AsyncSession = Depends(get_db)
):
    """Returns public chatbot branding for website widget embedding without authentication."""
    stmt = select(Tenant).where(Tenant.slug == tenant_slug.lower(), Tenant.is_active == True)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization '{tenant_slug}' not found or is currently inactive."
        )

    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    return {
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "name": config.name if config else "Assistant",
        "avatar_url": config.avatar_url if config else None,
        "welcome_message": config.welcome_message if config else "Hello! How can I help you today?",
        "tone": config.tone if config else "professional"
    }


@router.post(
    "/public/{tenant_slug}/message",
    response_model=RAGQueryResponse,
    summary="Public endpoint: Answer website visitor message via GraphRAG"
)
async def public_chat_message(
    tenant_slug: str,
    payload: PublicChatMessageRequest,
    db: AsyncSession = Depends(get_db)
):
    """Executes tenant-scoped GraphRAG pipeline for website visitors without requiring admin JWT."""
    stmt = select(Tenant).where(Tenant.slug == tenant_slug.lower(), Tenant.is_active == True)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization '{tenant_slug}' not found or is currently inactive."
        )

    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    top_k = config.default_top_k if config else 4
    max_hops = config.default_max_hops if config else 2
    tone = config.tone if config else "professional"
    sys_prompt = config.system_prompt if config else None
    temperature = config.temperature if config else 0.2

    history = payload.history or []

    rag_response = await RAGPipelineService.answer_query(
        db=db,
        tenant_id=tenant.id,
        query=payload.message,
        top_k_chunks=top_k,
        max_graph_hops=max_hops,
        temperature=temperature,
        conversation_history=history,
        persona_tone=tone,
        custom_system_prompt=sys_prompt,
        gemini_api_key=config.gemini_api_key if config else None,
        tenant_name=tenant.name,
    )

    return rag_response


@router.post(
    "/public/{tenant_slug}/message/stream",
    summary="Public endpoint: Stream website visitor message via GraphRAG SSE"
)
async def public_chat_message_stream(
    tenant_slug: str,
    payload: PublicChatMessageRequest,
    db: AsyncSession = Depends(get_db)
):
    """Streams tenant-scoped GraphRAG response for website visitors via SSE without authentication."""
    stmt = select(Tenant).where(Tenant.slug == tenant_slug.lower(), Tenant.is_active == True)
    res = await db.execute(stmt)
    tenant = res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization '{tenant_slug}' not found or is currently inactive."
        )

    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    top_k = config.default_top_k if config else 4
    max_hops = config.default_max_hops if config else 2
    tone = config.tone if config else "professional"
    sys_prompt = config.system_prompt if config else None
    temperature = config.temperature if config else 0.2

    history = payload.history or []

    async def sse_event_generator():
        try:
            async for event in RAGPipelineService.answer_query_stream(
                db=db,
                tenant_id=tenant.id,
                query=payload.message,
                top_k_chunks=top_k,
                max_graph_hops=max_hops,
                temperature=temperature,
                conversation_history=history,
                persona_tone=tone,
                custom_system_prompt=sys_prompt,
                gemini_api_key=config.gemini_api_key if config else None,
                tenant_name=tenant.name,
            ):
                if event["type"] == "token":
                    token_data = json.dumps({"text": event["text"]})
                    yield f"event: token\ndata: {token_data}\n\n"
                elif event["type"] == "metadata":
                    meta_payload = {k: v for k, v in event.items() if k != "type"}
                    yield f"event: metadata\ndata: {json.dumps(meta_payload)}\n\n"
        except Exception as e:
            logger.error(f"Error during public SSE chat stream: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"
            return

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        sse_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
