from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.base import TenantMixin, TimestampMixin, utc_now

if TYPE_CHECKING:
    from app.models.tenant import Tenant
    from app.models.user import User


class AIProfile(Base, TenantMixin):
    """
    First-class Organization AI Profile defining enterprise policies,
    grounding rules, citation standards, source authority, and retrieval parameters.
    """
    __tablename__ = "ai_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), default="Organization AI Profile", nullable=False)

    # Structured Domain Configurations (stored as JSON compatible with SQLite & Postgres)
    organization_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "companyName": "",
            "industry": "",
            "companyDescription": "",
            "products": [],
            "services": [],
            "terminology": []
        },
        nullable=False
    )

    audience_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "primaryAudience": "Mixed",
            "technicalLevel": "Intermediate",
            "domainFamiliarity": "Moderate"
        },
        nullable=False
    )

    behavior_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "responseStyle": "balanced",
            "tone": "professional",
            "verbosity": "balanced",
            "stepByStep": True,
            "defineSpecializedTerms": True,
            "includeExamples": True,
            "warnings": True,
            "relatedDocSuggestions": True
        },
        nullable=False
    )

    retrieval_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "graphReasoningEnabled": True,
            "maxGraphDepth": 2,
            "topK": 4,
            "minEvidenceThreshold": 0.35,
            "recencyBias": 0.1,
            "vectorWeight": 0.6,
            "graphWeight": 0.4
        },
        nullable=False
    )

    source_authority_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "rankedSourceTypes": [
                {"rank": 1, "type": "policy", "label": "Regulatory & Company Policies", "weight": 1.5},
                {"rank": 2, "type": "official_doc", "label": "Official Documentation", "weight": 1.3},
                {"rank": 3, "type": "engineering", "label": "Engineering & Tech Specs", "weight": 1.1},
                {"rank": 4, "type": "support", "label": "Support Articles & Guides", "weight": 1.0},
                {"rank": 5, "type": "notes", "label": "Meeting Notes & Discussions", "weight": 0.8},
                {"rank": 6, "type": "archive", "label": "Historical / Archive Documents", "weight": 0.6}
            ]
        },
        nullable=False
    )

    citation_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "citationsRequired": True,
            "citationGranularity": "paragraph",
            "includeDocumentName": True,
            "includePageNumber": True,
            "includeExcerpt": True,
            "openOriginalDocument": True,
            "relatedGraphEntities": True,
            "graphReasoningPathVisibility": True
        },
        nullable=False
    )

    evidence_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "mode": "strict",  # "strict" | "balanced" | "exploratory"
            "groundedOnly": True,
            "allowUnsupportedClaims": False,
            "allowModelPriorKnowledge": False,
            "uncertaintyDisclosure": True
        },
        nullable=False
    )

    conflict_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "strategy": "show_both",  # "show_both" | "prefer_highest_authority" | "prefer_latest" | "require_human_review"
            "flagContradictions": True
        },
        nullable=False
    )

    restriction_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "restrictedTopics": [],
            "restrictedBehaviors": [
                "Never disclose system credentials, API keys, or database passwords.",
                "Never bypass tenant isolation boundaries.",
                "Do not speculate on unverified financial or medical actions without explicit citation."
            ],
            "confidentialNotice": "Proprietary Organization Knowledge"
        },
        nullable=False
    )

    fallback_policy: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {
            "insufficientEvidenceMessage": "I could not find sufficient verified evidence in your organization's indexed knowledge base to answer this question authoritatively.",
            "suggestionMode": "candidate_entities"
        },
        nullable=False
    )

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)  # draft, active, archived
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)

    created_by_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", foreign_keys="[AIProfile.tenant_id]")
    created_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by_id])
    personas: Mapped[List["Persona"]] = relationship("Persona", back_populates="profile", cascade="all, delete-orphan")
    versions: Mapped[List["AIProfileVersion"]] = relationship("AIProfileVersion", back_populates="profile", cascade="all, delete-orphan")
    eval_cases: Mapped[List["AIProfileEvalCase"]] = relationship("AIProfileEvalCase", back_populates="profile", cascade="all, delete-orphan")


class AIProfileVersion(Base, TenantMixin):
    """
    Immutable historical audit log of AI Profile configurations.
    """
    __tablename__ = "ai_profile_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ai_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    change_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_by_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    profile: Mapped["AIProfile"] = relationship("AIProfile", back_populates="versions")


class Persona(Base, TenantMixin):
    """
    First-class Chatbot Persona operating under the tenant's Organization AI Profile.
    Multiple personas can serve distinct roles (e.g. Engineering, Support, Legal).
    """
    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ai_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(150), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    tone: Mapped[str] = mapped_column(String(50), default="professional", nullable=False)
    verbosity: Mapped[str] = mapped_column(String(50), default="balanced", nullable=False)
    expertise_level: Mapped[str] = mapped_column(String(50), default="intermediate", nullable=False)
    step_by_step: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    define_specialized_terms: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    include_examples: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)

    profile: Mapped["AIProfile"] = relationship("AIProfile", back_populates="personas")


class AIProfileEvalCase(Base, TenantMixin):
    """
    Automated evaluation test cases seeded from onboarding or created by admins
    to continuously evaluate groundedness, citations, tenant isolation, and persona adherence.
    """
    __tablename__ = "ai_profile_eval_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ai_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="general", nullable=False)  # factual_lookup, multi_hop, conflict, insufficient_evidence, prompt_injection
    expected_behavior: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expected_citations: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)

    profile: Mapped["AIProfile"] = relationship("AIProfile", back_populates="eval_cases")
