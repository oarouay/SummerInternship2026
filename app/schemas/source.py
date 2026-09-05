from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field
from app.models.source import SourceType, SourceStatus


class RawTextCreate(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        examples=["Company Refund Policy"],
        description="Title or descriptive name of the raw knowledge source"
    )
    content: str = Field(
        ...,
        min_length=1,
        examples=["All customer refund requests submitted within 30 days are processed automatically."],
        description="Raw textual content to be ingested and converted into chunks/embeddings"
    )


class SourceResponse(BaseModel):
    id: int
    name: str
    source_type: str
    status: str
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    error_message: Optional[str] = None
    tenant_id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SourceStatusUpdate(BaseModel):
    status: SourceStatus
    error_message: Optional[str] = None
