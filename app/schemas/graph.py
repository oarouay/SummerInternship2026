from typing import List, Optional
from pydantic import BaseModel, Field


class Entity(BaseModel):
    name: str = Field(..., description="Canonical entity name (e.g. 'FastAPI', 'Alice')")
    type: str = Field(default="CONCEPT", description="Entity category (e.g. 'PERSON', 'PROJECT', 'TECHNOLOGY', 'ORGANIZATION', 'CONCEPT')")
    description: Optional[str] = Field(default="", description="Brief summary of the entity in context")


class Relationship(BaseModel):
    source: str = Field(..., description="Source entity name")
    target: str = Field(..., description="Target entity name")
    relation_type: str = Field(..., description="Relationship verb/type in UPPERCASE (e.g. 'MANAGES', 'DEPENDS_ON', 'USES')")
    description: Optional[str] = Field(default="", description="Contextual explanation of this relationship")


class GraphExtractionResult(BaseModel):
    entities: List[Entity] = Field(default_factory=list, description="Extracted distinct entities")
    relationships: List[Relationship] = Field(default_factory=list, description="Extracted directed relationships between entities")


class GraphNeighborhoodQuery(BaseModel):
    entity_names: List[str] = Field(..., min_length=1, description="Seed entity names to start graph traversal from")
    max_hops: int = Field(default=1, ge=1, le=3, description="Number of graph hops to explore (1-3)")
    limit: int = Field(default=25, ge=1, le=100, description="Maximum number of connections to return")


class GraphNode(BaseModel):
    name: str
    type: str
    description: str = ""
    chunk_ids: List[int] = Field(default_factory=list)


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str
    description: str = ""
    weight: int = 1


class GraphNeighborhoodResponse(BaseModel):
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)


class GraphStatsResponse(BaseModel):
    node_count: int
    edge_count: int
    tenant_id: int
