from typing import Optional
from pydantic import BaseModel, Field


class SearchQuery(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        examples=["How does the refund policy work?"],
        description="Natural language question or search query"
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Number of most relevant chunks to return"
    )
    source_id: Optional[int] = Field(
        default=None,
        description="Optional filter to restrict search to a single document"
    )


class SearchResult(BaseModel):
    chunk_id: int
    source_id: int
    source_name: str
    chunk_index: int
    content: str
    score: float = Field(description="Semantic similarity score between 0.0 and 1.0 (higher is more similar)")
    distance: float = Field(description="Cosine distance (lower means closer)")
