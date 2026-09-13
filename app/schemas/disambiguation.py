from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class DisambiguationType(str, Enum):
    entity_split = "entity_split"
    adjacent_topics = "adjacent_topics"
    unindexed_fallback = "unindexed_fallback"


class CandidateEntity(BaseModel):
    name: str
    type: str = "CONCEPT"
    description: Optional[str] = ""
    neighbors: List[str] = Field(default_factory=list)
    score: Optional[float] = 0.0


class DisambiguationResult(BaseModel):
    explanation_message: str
    disambiguation_type: DisambiguationType
    suggested_chips: List[str] = Field(default_factory=list)
