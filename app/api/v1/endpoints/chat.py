import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.chatbot import ChatbotConfig
from app.models.conversation import ChatMessage, Conversation
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.conversation import (
    ChatMessageRead,
    ChatMessageSendRequest,
    ConversationCreate,
    ConversationListItem,
    ConversationRead,
)
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

    return ConversationRead(
        id=conv.id,
        tenant_id=conv.tenant_id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[ChatMessageRead.from_orm_with_citations(m) for m in conv.messages]
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

    # 2. Fetch ChatbotConfig for tenant
    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    top_k = payload.top_k_chunks or (config.default_top_k if config else 4)
    max_hops = payload.max_graph_hops or (config.default_max_hops if config else 2)
    tone = config.tone if config else "professional"
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

    # 5. Call RAG Pipeline with conversation history
    rag_response = await RAGPipelineService.answer_query(
        db=db,
        tenant_id=tenant.id,
        query=payload.message,
        top_k_chunks=top_k,
        max_graph_hops=max_hops,
        temperature=temperature,
        conversation_history=history,
        persona_tone=tone,
        custom_system_prompt=sys_prompt
    )

    # 6. Save Assistant response with citations
    citations_data = {
        "sources": [s.model_dump() for s in rag_response.source_citations],
        "graph": [g.model_dump() for g in rag_response.graph_citations],
        "entities_detected": rag_response.entities_detected,
        "execution_time_ms": rag_response.execution_time_ms,
    }
    assistant_msg = ChatMessage(
        tenant_id=tenant.id,
        conversation_id=conversation_id,
        role="assistant",
        content=rag_response.answer,
        citations_json=json.dumps(citations_data)
    )
    db.add(assistant_msg)

    # 7. Update title if first message
    if conv.title == "New Conversation":
        snippet = payload.message[:35].strip()
        conv.title = snippet + ("..." if len(payload.message) > 35 else "")

    await db.commit()
    await db.refresh(assistant_msg)

    return ChatMessageRead.from_orm_with_citations(assistant_msg)


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
