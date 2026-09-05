from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class DocumentChunkResponse(BaseModel):
    id: int
    source_id: int
    chunk_index: int
    content: str
    char_count: int
    token_count: int
    metadata_json: Optional[str] = None
    tenant_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
