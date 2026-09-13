from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class RouterAction(str, Enum):
    DIRECT_RESPONSE = "direct_response"
    CLARIFY = "clarify"
    RETRIEVE = "retrieve"


class ConversationalRouteResult(BaseModel):
    """
    Structured outcome of the Conversational Routing Engine.
    Conforms strictly to the platform routing specification.
    """
    action: RouterAction = Field(
        ...,
        description="Execution path: 'direct_response', 'clarify', or 'retrieve'"
    )
    standalone_query: Optional[str] = Field(
        default=None,
        description="Standalone rewritten query with coreferences resolved. Populated only when action is 'retrieve'."
    )
    seed_entities: List[str] = Field(
        default_factory=list,
        description="High-value domain nouns, system titles, code repos, technologies, or people extracted from standalone_query."
    )
    direct_or_clarification_message: Optional[str] = Field(
        default=None,
        description="Polite chitchat response or clarification inquiry presented directly to the user."
    )
    clarification_options: List[str] = Field(
        default_factory=list,
        description="2 to 4 brief, clickable choices presented when action is 'clarify'."
    )
    execution_time_ms: float = Field(
        default=0.0,
        description="Time taken by the router in milliseconds."
    )
