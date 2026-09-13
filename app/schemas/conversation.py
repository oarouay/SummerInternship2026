import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ChatMessageRead(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    action: Optional[str] = Field(default=None, description="Router action: 'direct_response', 'clarify', or 'retrieve'")
    clarification_options: List[str] = Field(default_factory=list, description="Interactive clarification choices if action is clarify")
    follow_up_suggestions: List[str] = Field(default_factory=list, description="Forward-looking follow-up suggestions or related entity paths")
    needs_clarification: bool = Field(default=False, description="True if response is a partial match or zero match requiring clarification")
    citations: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_with_citations(cls, msg) -> "ChatMessageRead":
        c_dict = None
        action = None
        clarification_options = []
        follow_up_suggestions = []
        needs_clarification = False
        if msg.citations_json:
            try:
                c_dict = json.loads(msg.citations_json)
                action = c_dict.get("action")
                clarification_options = c_dict.get("clarification_options", [])
                follow_up_suggestions = c_dict.get("follow_up_suggestions", [])
                needs_clarification = c_dict.get("needs_clarification", False)
            except Exception:
                pass
        return cls(
            id=msg.id,
            conversation_id=msg.conversation_id,
            role=msg.role,
            content=msg.content,
            action=action,
            clarification_options=clarification_options,
            follow_up_suggestions=follow_up_suggestions,
            needs_clarification=needs_clarification,
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

