from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


# Sub-policy Schemas
class TerminologyItem(BaseModel):
    term: str = Field(..., description="Acronym or proprietary company term")
    definition: str = Field(..., description="Clear definition or expansion of the term")


class OrganizationProfile(BaseModel):
    companyName: str = Field("", description="Name of the company / organization")
    industry: str = Field("", description="Primary industry or domain (e.g. FinTech, Healthcare, Cybersecurity)")
    companyDescription: str = Field("", description="High level summary of what the company does")
    products: List[str] = Field(default_factory=list, description="Core products or platforms")
    services: List[str] = Field(default_factory=list, description="Core services provided")
    terminology: List[TerminologyItem] = Field(default_factory=list, description="Domain specific acronyms/terms")


class AudienceProfile(BaseModel):
    primaryAudience: str = Field("Mixed", description="Target users (e.g. Customers, Employees, Engineers, Executives)")
    technicalLevel: str = Field("Intermediate", description="Expected technical expertise: Beginner, Intermediate, Advanced, Expert, Adaptive")
    domainFamiliarity: str = Field("Moderate", description="Familiarity with company terminology: Low, Moderate, High")


class BehaviorProfile(BaseModel):
    responseStyle: str = Field("balanced", description="concise, balanced, or detailed")
    tone: str = Field("professional", description="professional, technical, friendly, or formal")
    verbosity: str = Field("balanced", description="concise, balanced, or detailed")
    stepByStep: bool = Field(True, description="Provide step-by-step guidance for procedures")
    defineSpecializedTerms: bool = Field(True, description="Define acronyms or technical concepts on first mention")
    includeExamples: bool = Field(True, description="Include practical code/process examples when applicable")
    warnings: bool = Field(True, description="Include security and operational warning callouts")
    relatedDocSuggestions: bool = Field(True, description="Proactively suggest adjacent documentation or topics")


class RetrievalPolicy(BaseModel):
    graphReasoningEnabled: bool = Field(True, description="Enable multi-hop knowledge graph traversal")
    maxGraphDepth: int = Field(2, ge=1, le=4, description="Maximum hops in graph neighborhood expansion")
    topK: int = Field(4, ge=1, le=20, description="Top-k vector semantic passages to retrieve")
    minEvidenceThreshold: float = Field(0.35, ge=0.0, le=1.0, description="Minimum relevance score threshold")
    recencyBias: float = Field(0.1, ge=0.0, le=1.0, description="Weight multiplier favoring newer documentation")
    vectorWeight: float = Field(0.6, ge=0.0, le=1.0, description="Relative retrieval weight for vector search")
    graphWeight: float = Field(0.4, ge=0.0, le=1.0, description="Relative retrieval weight for graph traversal")


class SourceAuthorityRank(BaseModel):
    rank: int = Field(..., ge=1, description="Priority rank (1 is highest authority)")
    type: str = Field(..., description="Document source type identifier (policy, official_doc, engineering, support, notes, archive)")
    label: str = Field(default="", description="Human readable label")
    weight: float = Field(1.0, ge=0.1, le=3.0, description="Authority score multiplier")


class SourceAuthorityPolicy(BaseModel):
    rankedSourceTypes: List[SourceAuthorityRank] = Field(
        default_factory=lambda: [
            SourceAuthorityRank(rank=1, type="policy", label="Regulatory & Company Policies", weight=1.5),
            SourceAuthorityRank(rank=2, type="official_doc", label="Official Documentation", weight=1.3),
            SourceAuthorityRank(rank=3, type="engineering", label="Engineering & Tech Specs", weight=1.1),
            SourceAuthorityRank(rank=4, type="support", label="Support Articles & Guides", weight=1.0),
            SourceAuthorityRank(rank=5, type="notes", label="Meeting Notes & Discussions", weight=0.8),
            SourceAuthorityRank(rank=6, type="archive", label="Historical / Archive Documents", weight=0.6),
        ]
    )


class CitationPolicy(BaseModel):
    citationsRequired: bool = Field(True, description="Mandatory inline citations for factual claims")
    citationGranularity: str = Field("paragraph", description="sentence, paragraph, or chunk")
    includeDocumentName: bool = Field(True, description="Display source document title in citation")
    includePageNumber: bool = Field(True, description="Display page/section number if available")
    includeExcerpt: bool = Field(True, description="Include verifiable excerpt snippet")
    openOriginalDocument: bool = Field(True, description="Provide deep link to original document")
    relatedGraphEntities: bool = Field(True, description="Display linked graph entities in citations")
    graphReasoningPathVisibility: bool = Field(True, description="Expose multi-hop graph path to authorized users")


class EvidencePolicy(BaseModel):
    mode: Literal["strict", "balanced", "exploratory"] = Field("strict", description="Evidence strictness mode")
    groundedOnly: bool = Field(True, description="Rely strictly on retrieved evidence, no ungrounded speculation")
    allowUnsupportedClaims: bool = Field(False, description="Never generate claims unsupported by evidence")
    allowModelPriorKnowledge: bool = Field(False, description="Disallow parametric prior knowledge when groundedOnly is active")
    uncertaintyDisclosure: bool = Field(True, description="Explicitly disclose knowledge gaps or missing facts")


class ConflictPolicy(BaseModel):
    strategy: Literal["show_both", "prefer_highest_authority", "prefer_latest", "require_human_review"] = Field(
        "show_both", description="Conflict resolution strategy for contradictory sources"
    )
    flagContradictions: bool = Field(True, description="Explicitly flag disagreements in synthesized answer")


class RestrictionPolicy(BaseModel):
    restrictedTopics: List[str] = Field(default_factory=list, description="Blacklisted topics the assistant must decline to discuss")
    restrictedBehaviors: List[str] = Field(
        default_factory=lambda: [
            "Never disclose system credentials, API keys, or database passwords.",
            "Never bypass tenant isolation boundaries.",
            "Do not speculate on unverified financial or medical actions without explicit citation."
        ],
        description="Mandatory behavioral guardrails"
    )
    confidentialNotice: str = Field("Proprietary Organization Knowledge", description="Classification header")


class FallbackPolicy(BaseModel):
    insufficientEvidenceMessage: str = Field(
        "I could not find sufficient verified evidence in your organization's indexed knowledge base to answer this question authoritatively.",
        description="Deterministic response when evidence is below threshold"
    )
    suggestionMode: str = Field("candidate_entities", description="candidate_entities, popular_topics, or ask_admin")


# Onboarding Wizard Submission Schema
class OnboardingStep1Company(BaseModel):
    companyName: str
    industry: str
    companyDescription: str
    products: List[str] = Field(default_factory=list)
    services: List[str] = Field(default_factory=list)
    terminology: List[TerminologyItem] = Field(default_factory=list)


class OnboardingStep2Purpose(BaseModel):
    selectedPurposes: List[str] = Field(
        ...,
        description="List of roles e.g. Internal knowledge search, Technical troubleshooting, Customer support"
    )
    customPurpose: Optional[str] = None
    exampleQuestions: List[str] = Field(
        default_factory=list,
        description="Representative questions for evaluation and prompt calibration"
    )


class OnboardingStep3Audience(BaseModel):
    primaryAudience: str = "Mixed"
    technicalLevel: str = "Intermediate"


class OnboardingStep4Style(BaseModel):
    responseStyle: str = "balanced"  # concise, balanced, detailed
    tone: str = "professional"        # professional, technical, friendly, formal
    stepByStep: bool = True
    defineSpecializedTerms: bool = True
    includeExamples: bool = True
    warnings: bool = True
    relatedDocSuggestions: bool = True


class OnboardingStep5Evidence(BaseModel):
    mode: Literal["strict", "balanced", "exploratory"] = "strict"
    uncertaintyDisclosure: bool = True


class OnboardingStep6Authority(BaseModel):
    rankedSourceTypes: Optional[List[SourceAuthorityRank]] = None


class OnboardingStep7Citations(BaseModel):
    citationsRequired: bool = True
    citationGranularity: str = "paragraph"
    includeExcerpt: bool = True
    graphReasoningPathVisibility: bool = True


class OnboardingSubmissionRequest(BaseModel):
    step1_company: OnboardingStep1Company
    step2_purpose: OnboardingStep2Purpose
    step3_audience: OnboardingStep3Audience
    step4_style: OnboardingStep4Style
    step5_evidence: OnboardingStep5Evidence
    step6_authority: Optional[OnboardingStep6Authority] = None
    step7_citations: Optional[OnboardingStep7Citations] = None
    createDefaultPersona: bool = True


# Profile CRUD and Lifecycle Schemas
class AIProfileCreate(BaseModel):
    name: str = "Organization AI Profile"
    organization_data: Optional[OrganizationProfile] = None
    audience_data: Optional[AudienceProfile] = None
    behavior_data: Optional[BehaviorProfile] = None
    retrieval_policy: Optional[RetrievalPolicy] = None
    source_authority_policy: Optional[SourceAuthorityPolicy] = None
    citation_policy: Optional[CitationPolicy] = None
    evidence_policy: Optional[EvidencePolicy] = None
    conflict_policy: Optional[ConflictPolicy] = None
    restriction_policy: Optional[RestrictionPolicy] = None
    fallback_policy: Optional[FallbackPolicy] = None


class AIProfileUpdate(BaseModel):
    name: Optional[str] = None
    organization_data: Optional[OrganizationProfile] = None
    audience_data: Optional[AudienceProfile] = None
    behavior_data: Optional[BehaviorProfile] = None
    retrieval_policy: Optional[RetrievalPolicy] = None
    source_authority_policy: Optional[SourceAuthorityPolicy] = None
    citation_policy: Optional[CitationPolicy] = None
    evidence_policy: Optional[EvidencePolicy] = None
    conflict_policy: Optional[ConflictPolicy] = None
    restriction_policy: Optional[RestrictionPolicy] = None
    fallback_policy: Optional[FallbackPolicy] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None
    change_reason: Optional[str] = None


class AIProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tenant_id: int
    name: str
    organization_data: Dict[str, Any]
    audience_data: Dict[str, Any]
    behavior_data: Dict[str, Any]
    retrieval_policy: Dict[str, Any]
    source_authority_policy: Dict[str, Any]
    citation_policy: Dict[str, Any]
    evidence_policy: Dict[str, Any]
    conflict_policy: Dict[str, Any]
    restriction_policy: Dict[str, Any]
    fallback_policy: Dict[str, Any]
    version: int
    status: str
    is_active: bool
    created_by_id: Optional[int]
    created_at: datetime
    updated_at: datetime


class AIProfileVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    tenant_id: int
    version: int
    snapshot_json: Dict[str, Any]
    change_reason: Optional[str]
    created_by_id: Optional[int]
    created_at: datetime


class ProfileValidationResult(BaseModel):
    valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
