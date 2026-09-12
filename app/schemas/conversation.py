import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ChatMessageRead(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    citations: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_with_citations(cls, msg) -> "ChatMessageRead":
        c_dict = None
        if msg.citations_json:
            try:
                c_dict = json.loads(msg.citations_json)
            except Exception:
                pass
        return cls(
            id=msg.id,
            conversation_id=msg.conversation_id,
            role=msg.role,
            content=msg.content,
            citations=c_dict,
            created_at=msg.created_at,
        )


class ChatMessageSendRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User question or statement")
    top_k_chunks: Optional[int] = Field(None, ge=1, le=20)
    max_graph_hops: Optional[int] = Field(None, ge=1, le=3)


class ConversationCreate(BaseModel):
    title: Optional[str] = Field(default="New Conversation", max_length=200)


class ConversationListItem(BaseModel):
    id: int
    tenant_id: int
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ConversationRead(BaseModel):
    id: int
    tenant_id: int
    title: str
    created_at: datetime
    updated_at: datetime
    messages: List[ChatMessageRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class PublicChatMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, description="Visitor question")
    history: Optional[List[Dict[str, str]]] = Field(default_factory=list, description="Prior conversation turns")

