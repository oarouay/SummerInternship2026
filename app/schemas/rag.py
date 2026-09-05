from typing import List, Optional
from pydantic import BaseModel, Field


class RAGQueryRequest(BaseModel):
    """Payload for submitting a question to the Hybrid GraphRAG engine."""
    query: str = Field(..., min_length=2, description="The natural language question to answer")
    top_k_chunks: int = Field(default=4, ge=1, le=20, description="Max semantic text chunks to retrieve")
    max_graph_hops: int = Field(default=2, ge=1, le=3, description="Depth of graph neighborhood traversal")
    temperature: float = Field(default=0.2, ge=0.0, le=1.0, description="LLM sampling temperature")
    source_id: Optional[int] = Field(default=None, description="Optional filter to scope retrieval to a specific document")


class RAGSourceCitation(BaseModel):
    """Verifiable reference to a specific document chunk retrieved from pgvector."""
    source_id: int
    source_name: str
    chunk_id: int
    snippet: str
    similarity_score: float


class RAGGraphCitation(BaseModel):
    """Verifiable relational triple retrieved from the Neo4j Knowledge Graph."""
    source_entity: str
    relation: str
    target_entity: str
    description: Optional[str] = None


class RAGQueryResponse(BaseModel):
    """Grounded answer synthesized from hybrid vector and graph knowledge."""
    query: str
    answer: str
    source_citations: List[RAGSourceCitation] = Field(default_factory=list)
    graph_citations: List[RAGGraphCitation] = Field(default_factory=list)
    entities_detected: List[str] = Field(default_factory=list)
    execution_time_ms: float
