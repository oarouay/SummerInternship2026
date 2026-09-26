from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class PersonaCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="e.g. Engineering Assistant")
    role: str = Field(..., min_length=3, max_length=150, description="Role title")
    purpose: str = Field(..., min_length=5, description="Primary responsibility and tasks")
    audience: List[str] = Field(default_factory=lambda: ["Mixed"], description="Target user groups")
    tone: str = Field("professional", description="e.g. technical, professional, friendly, concise")
    verbosity: str = Field("balanced", description="concise, balanced, or detailed")
    expertise_level: str = Field("intermediate", description="beginner, intermediate, advanced, expert")
    step_by_step: bool = Field(True, description="Provide step-by-step guidance for procedures")
    define_specialized_terms: bool = Field(False, description="Define specialized terms or assume familiarity")
    include_examples: bool = Field(True, description="Include code/concrete examples")
    is_default: bool = Field(False, description="Whether this is the default persona for the organization")


class PersonaUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    purpose: Optional[str] = None
    audience: Optional[List[str]] = None
    tone: Optional[str] = None
    verbosity: Optional[str] = None
    expertise_level: Optional[str] = None
    step_by_step: Optional[bool] = None
    define_specialized_terms: Optional[bool] = None
    include_examples: Optional[bool] = None
    is_default: Optional[bool] = None


class PersonaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tenant_id: int
    profile_id: int
    name: str
    role: str
    purpose: str
    audience: List[str]
    tone: str
    verbosity: str
    expertise_level: str
    step_by_step: bool
    define_specialized_terms: bool
    include_examples: bool
    is_default: bool
    created_at: datetime
    updated_at: datetime


class AIProfileTestRequest(BaseModel):
    question: str = Field(..., min_length=2, description="Test question to run against active profile")
    persona_id: Optional[int] = Field(None, description="Optional persona to test; defaults to active default persona")
    profile_id: Optional[int] = Field(None, description="Optional profile ID to test; defaults to active profile")


class AIProfileTestCitation(BaseModel):
    evidence_id: str
    document_title: str
    page: Optional[int] = None
    snippet: str
    authority_score: float
    retrieval_score: float


class AIProfileTestResponse(BaseModel):
    answer: str
    evidence_status: str  # sufficient, partial, insufficient, conflicting
    citations: List[AIProfileTestCitation]
    retrieved_chunks_count: int
    graph_entities_count: int
    graph_paths: List[str]
    active_profile_version: int
    active_persona_name: str
    retrieval_strategy: str
    execution_time_ms: float
    why_answered_this_way: Dict[str, Any]
