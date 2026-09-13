from typing import List, Optional
from pydantic import BaseModel, Field


class SynthesisResult(BaseModel):
    """
    Structured outcome of the Grounded Synthesis Engine.
    Enforces complete/partial/zero-match handling, citations, and forward-looking suggestions.
    """
    answer: str = Field(
        ...,
        description="Markdown synthesized response using strictly verified document passages and graph triples."
    )
    follow_up_suggestions: List[str] = Field(
        default_factory=list,
        description="2 to 3 intelligent suggestions or candidate entity paths guiding user exploration."
    )
    needs_clarification: bool = Field(
        default=False,
        description="True if response is a partial match or zero match requiring clarification."
    )
    match_type: str = Field(
        default="complete",
        description="Context match tier: 'complete', 'partial', or 'zero_match'."
    )

    def __contains__(self, item: str) -> bool:
        return item in self.answer

    def __str__(self) -> str:
        return self.answer

    def lower(self) -> str:
        return self.answer.lower()
