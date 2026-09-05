from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ChatbotConfigRead(BaseModel):
    id: int
    tenant_id: int
    name: str = Field(description="Display name of the chatbot")
    avatar_url: Optional[str] = Field(None, description="URL or data URI for chatbot avatar")
    welcome_message: str = Field(description="Initial greeting shown to users")
    tone: str = Field(description="Tone persona: professional, technical, friendly, concise")
    system_prompt: Optional[str] = Field(None, description="Custom instruction prompt")
    default_top_k: int = Field(description="Default number of vector chunks to retrieve")
    default_max_hops: int = Field(description="Default graph traversal depth")
    temperature: float = Field(description="LLM generation temperature")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatbotConfigUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)
    welcome_message: Optional[str] = Field(None, min_length=1, max_length=500)
    tone: Optional[str] = Field(None, pattern="^(professional|technical|friendly|concise)$")
    system_prompt: Optional[str] = Field(None, max_length=2000)
    default_top_k: Optional[int] = Field(None, ge=1, le=20)
    default_max_hops: Optional[int] = Field(None, ge=1, le=3)
    temperature: Optional[float] = Field(None, ge=0.0, le=1.0)
