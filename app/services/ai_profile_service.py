import copy
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.ai_profile import AIProfile, AIProfileEvalCase, AIProfileVersion, Persona
from app.models.chatbot import ChatbotConfig
from app.models.tenant import Tenant
from app.schemas.ai_profile import (
    AIProfileCreate,
    AIProfileUpdate,
    OnboardingSubmissionRequest,
    ProfileValidationResult,
)
from app.schemas.persona import AIProfileTestResponse, AIProfileTestCitation, PersonaCreate, PersonaUpdate
from app.services.ai_profile_generator import AIProfileGenerator
from app.services.ai_profile_validator import AIProfileValidator
from app.services.prompt_compiler import PromptCompiler

logger = logging.getLogger(__name__)


class AIProfileService:
    """
    Core management service for Organization AI Profiles, Versioning,
    and Multi-Persona Studio.
    """

    @classmethod
    async def get_or_create_default_profile(
        cls,
        db: AsyncSession,
        tenant_id: int,
        tenant_name: str
    ) -> Tuple[AIProfile, Persona]:
        """
        Retrieves the currently active AIProfile and default Persona for a tenant.
        If no profile exists yet, provides seamless backwards compatibility by
        auto-generating an enterprise profile based on existing ChatbotConfig.
        """
        stmt = (
            select(AIProfile)
            .options(selectinload(AIProfile.personas))
            .where(AIProfile.tenant_id == tenant_id, AIProfile.is_active == True)
            .order_by(AIProfile.version.desc())
        )
        res = await db.execute(stmt)
        profile = res.scalar_one_or_none()

        if profile:
            # Find default persona or first persona
            default_persona = next((p for p in profile.personas if p.is_default), None)
            if not default_persona and profile.personas:
                default_persona = profile.personas[0]
            if not default_persona:
                # Create a default persona for this profile
                default_persona = Persona(
                    tenant_id=tenant_id,
                    profile_id=profile.id,
                    name=f"{tenant_name} Assistant",
                    role=f"Enterprise knowledge assistant for {tenant_name}",
                    purpose="Assist authorized team members with finding information across indexed records.",
                    audience=["Mixed"],
                    tone=profile.behavior_data.get("tone", "professional"),
                    verbosity=profile.behavior_data.get("verbosity", "balanced"),
                    expertise_level=profile.audience_data.get("technicalLevel", "Intermediate").lower(),
                    step_by_step=True,
                    define_specialized_terms=True,
                    include_examples=True,
                    is_default=True
                )
                db.add(default_persona)
                await db.commit()
                await db.refresh(default_persona)
            return profile, default_persona

        # Backward compatibility bootstrap from existing ChatbotConfig
        cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant_id)
        cfg_res = await db.execute(cfg_stmt)
        config = cfg_res.scalar_one_or_none()

        tone = config.tone if config else "professional"
        top_k = config.default_top_k if config else 4
        max_hops = config.default_max_hops if config else 2

        profile = AIProfile(
            tenant_id=tenant_id,
            name=f"{tenant_name} Enterprise AI Profile",
            organization_data={
                "companyName": tenant_name,
                "industry": "Enterprise",
                "companyDescription": f"Organization workspace for {tenant_name}",
                "products": [],
                "services": [],
                "terminology": []
            },
            audience_data={
                "primaryAudience": "Mixed",
                "technicalLevel": "Intermediate",
                "domainFamiliarity": "Moderate"
            },
            behavior_data={
                "responseStyle": "balanced",
                "tone": tone,
                "verbosity": "balanced",
                "stepByStep": True,
                "defineSpecializedTerms": True,
                "includeExamples": True,
                "warnings": True,
                "relatedDocSuggestions": True
            },
            retrieval_policy={
                "graphReasoningEnabled": True,
                "maxGraphDepth": max_hops,
                "topK": top_k,
                "minEvidenceThreshold": 0.35,
                "recencyBias": 0.1,
                "vectorWeight": 0.6,
                "graphWeight": 0.4
            },
            source_authority_policy={
                "rankedSourceTypes": [
                    {"rank": 1, "type": "policy", "label": "Regulatory & Company Policies", "weight": 1.5},
                    {"rank": 2, "type": "official_doc", "label": "Official Documentation", "weight": 1.3},
                    {"rank": 3, "type": "engineering", "label": "Engineering & Tech Specs", "weight": 1.1},
                    {"rank": 4, "type": "support", "label": "Support Articles & Guides", "weight": 1.0},
                    {"rank": 5, "type": "notes", "label": "Meeting Notes & Discussions", "weight": 0.8},
                    {"rank": 6, "type": "archive", "label": "Historical / Archive Documents", "weight": 0.6}
                ]
            },
            citation_policy={
                "citationsRequired": True,
                "citationGranularity": "paragraph",
                "includeDocumentName": True,
                "includePageNumber": True,
                "includeExcerpt": True,
                "openOriginalDocument": True,
                "relatedGraphEntities": True,
                "graphReasoningPathVisibility": True
            },
            evidence_policy={
                "mode": "strict",
                "groundedOnly": True,
                "allowUnsupportedClaims": False,
                "allowModelPriorKnowledge": False,
                "uncertaintyDisclosure": True
            },
            conflict_policy={
                "strategy": "show_both",
                "flagContradictions": True
            },
            restriction_policy={
                "restrictedTopics": [],
                "restrictedBehaviors": [
                    "Never disclose system credentials, API keys, or database passwords.",
                    "Never bypass tenant isolation boundaries.",
                    "Do not speculate on unverified financial or medical actions without explicit citation."
                ],
                "confidentialNotice": f"Proprietary {tenant_name} Knowledge Base"
            },
            fallback_policy={
                "insufficientEvidenceMessage": f"I could not find sufficient verified evidence in {tenant_name}'s indexed knowledge base.",
                "suggestionMode": "candidate_entities"
            },
            version=1,
            status="active",
            is_active=True
        )
        db.add(profile)
        await db.flush()

        # Create initial Version 1 snapshot
        initial_snapshot = cls._serialize_profile_snapshot(profile)
        version_record = AIProfileVersion(
            tenant_id=tenant_id,
            profile_id=profile.id,
            version=1,
            snapshot_json=initial_snapshot,
            change_reason="Initial automatic baseline profile provisioned from chatbot configuration."
        )
        db.add(version_record)

        # Create default Persona
        persona = Persona(
            tenant_id=tenant_id,
            profile_id=profile.id,
            name=f"{tenant_name} Assistant",
            role=f"Enterprise knowledge assistant for {tenant_name}",
            purpose="Assist authorized team members with queries and research across organization knowledge.",
            audience=["Mixed"],
            tone=tone,
            verbosity="balanced",
            expertise_level="intermediate",
            step_by_step=True,
            define_specialized_terms=True,
            include_examples=True,
            is_default=True
        )
        db.add(persona)

        await db.commit()
        await db.refresh(profile)
        await db.refresh(persona)
        return profile, persona

    @classmethod
    def _serialize_profile_snapshot(cls, profile: AIProfile) -> Dict[str, Any]:
        return {
            "id": profile.id,
            "name": profile.name,
            "organization_data": profile.organization_data,
            "audience_data": profile.audience_data,
            "behavior_data": profile.behavior_data,
            "retrieval_policy": profile.retrieval_policy,
            "source_authority_policy": profile.source_authority_policy,
            "citation_policy": profile.citation_policy,
            "evidence_policy": profile.evidence_policy,
            "conflict_policy": profile.conflict_policy,
            "restriction_policy": profile.restriction_policy,
            "fallback_policy": profile.fallback_policy,
            "version": profile.version,
            "status": profile.status,
            "is_active": profile.is_active,
        }

    @classmethod
    async def create_new_version(
        cls,
        db: AsyncSession,
        profile_id: int,
        tenant_id: int,
        change_reason: str,
        user_id: Optional[int] = None
    ) -> AIProfileVersion:
        """
        Creates an immutable historical snapshot of the profile before significant edits.
        """
        stmt = select(AIProfile).where(AIProfile.id == profile_id, AIProfile.tenant_id == tenant_id)
        res = await db.execute(stmt)
        profile = res.scalar_one_or_none()
        if not profile:
            raise ValueError("Profile not found in active organization.")

        snapshot = cls._serialize_profile_snapshot(profile)
        new_version_num = profile.version

        version_record = AIProfileVersion(
            tenant_id=tenant_id,
            profile_id=profile.id,
            version=new_version_num,
            snapshot_json=snapshot,
            change_reason=change_reason,
            created_by_id=user_id
        )
        db.add(version_record)

        # Increment active profile version for subsequent edits
        profile.version += 1
        await db.commit()
        await db.refresh(version_record)
        return version_record

    @classmethod
    async def process_onboarding(
        cls,
        db: AsyncSession,
        tenant_id: int,
        tenant_name: str,
        submission: OnboardingSubmissionRequest,
        user_id: Optional[int] = None
    ) -> Tuple[AIProfile, List[Persona]]:
        """
        Executes full onboarding pipeline:
        1. Generates structured profile config, personas, and eval cases.
        2. Validates domain rules.
        3. Archives older active profiles (safe versioning).
        4. Persists new active profile, personas, and eval cases with tenant isolation.
        """
        profile_config, personas_data, eval_cases_data = AIProfileGenerator.generate_profile_and_personas(
            submission=submission,
            tenant_name=tenant_name
        )

        # Determine version number
        count_stmt = select(AIProfile).where(AIProfile.tenant_id == tenant_id)
        count_res = await db.execute(count_stmt)
        existing_profiles = count_res.scalars().all()
        next_ver = len(existing_profiles) + 1

        # Mark existing active profiles as archived
        for ep in existing_profiles:
            if ep.is_active:
                ep.is_active = False
                ep.status = "archived"

        new_profile = AIProfile(
            tenant_id=tenant_id,
            name=profile_config["name"],
            organization_data=profile_config["organization_data"],
            audience_data=profile_config["audience_data"],
            behavior_data=profile_config["behavior_data"],
            retrieval_policy=profile_config["retrieval_policy"],
            source_authority_policy=profile_config["source_authority_policy"],
            citation_policy=profile_config["citation_policy"],
            evidence_policy=profile_config["evidence_policy"],
            conflict_policy=profile_config["conflict_policy"],
            restriction_policy=profile_config["restriction_policy"],
            fallback_policy=profile_config["fallback_policy"],
            version=next_ver,
            status="active",
            is_active=True,
            created_by_id=user_id
        )
        db.add(new_profile)
        await db.flush()

        # Create initial Version 1 snapshot for the new profile
        snapshot = cls._serialize_profile_snapshot(new_profile)
        v_record = AIProfileVersion(
            tenant_id=tenant_id,
            profile_id=new_profile.id,
            version=next_ver,
            snapshot_json=snapshot,
            change_reason="Provisioned from multi-step onboarding wizard submission.",
            created_by_id=user_id
        )
        db.add(v_record)

        # Create Personas
        created_personas: List[Persona] = []
        for p_data in personas_data:
            persona = Persona(
                tenant_id=tenant_id,
                profile_id=new_profile.id,
                name=p_data["name"],
                role=p_data["role"],
                purpose=p_data["purpose"],
                audience=p_data["audience"],
                tone=p_data["tone"],
                verbosity=p_data["verbosity"],
                expertise_level=p_data["expertise_level"],
                step_by_step=p_data["step_by_step"],
                define_specialized_terms=p_data["define_specialized_terms"],
                include_examples=p_data["include_examples"],
                is_default=p_data["is_default"]
            )
            db.add(persona)
            created_personas.append(persona)

        # Create Seed Evaluation Test Cases
        for ev in eval_cases_data:
            eval_case = AIProfileEvalCase(
                tenant_id=tenant_id,
                profile_id=new_profile.id,
                question=ev["question"],
                category=ev["category"],
                expected_behavior=ev["expected_behavior"],
                expected_citations=ev["expected_citations"]
            )
            db.add(eval_case)

        await db.commit()
        await db.refresh(new_profile)
        for p in created_personas:
            await db.refresh(p)

        return new_profile, created_personas
