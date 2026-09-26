import copy
import logging
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.dependencies.auth import get_current_active_admin, get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.ai_profile import AIProfile, AIProfileEvalCase, AIProfileVersion, Persona
from app.models.chatbot import ChatbotConfig
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.ai_profile import (
    AIProfileCreate,
    AIProfileRead,
    AIProfileUpdate,
    AIProfileVersionRead,
    OnboardingSubmissionRequest,
    ProfileValidationResult,
)
from app.schemas.persona import (
    AIProfileTestCitation,
    AIProfileTestRequest,
    AIProfileTestResponse,
    PersonaRead,
)
from app.services.ai_profile_service import AIProfileService
from app.services.ai_profile_validator import AIProfileValidator
from app.services.evidence import EvidenceBuilder
from app.services.prompt_compiler import PromptCompiler
from app.services.synthesis import RAGPipelineService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-profiles", tags=["AI Profiles & Enterprise Policies"])


@router.get(
    "/active",
    response_model=AIProfileRead,
    summary="Get active Organization AI Profile for calling tenant"
)
async def get_active_profile(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the currently active AI Profile for the tenant.
    Auto-bootstraps a safe enterprise default if none exists yet.
    """
    profile, _ = await AIProfileService.get_or_create_default_profile(
        db=db,
        tenant_id=tenant.id,
        tenant_name=tenant.name
    )
    return profile


@router.post(
    "/onboarding",
    response_model=AIProfileRead,
    status_code=status.HTTP_201_CREATED,
    summary="Submit wizard onboarding and generate validated Organization AI Profile & Personas"
)
async def submit_onboarding(
    payload: OnboardingSubmissionRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Transforms multi-step onboarding wizard responses into a normalized AI Profile,
    creates specialized personas, seeds evaluation cases, and activates the profile.
    """
    try:
        new_profile, _ = await AIProfileService.process_onboarding(
            db=db,
            tenant_id=tenant.id,
            tenant_name=tenant.name,
            submission=payload,
            user_id=current_admin.id
        )
        return new_profile
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(val_err)
        )


@router.put(
    "/active",
    response_model=AIProfileRead,
    summary="Update active AI Profile policies with validation"
)
async def update_active_profile(
    payload: AIProfileUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates active AI Profile configuration.
    Validates against contradictory or unsafe enterprise rules before persisting.
    """
    profile, _ = await AIProfileService.get_or_create_default_profile(
        db=db, tenant_id=tenant.id, tenant_name=tenant.name
    )

    update_dict = payload.model_dump(exclude_unset=True)
    change_reason = update_dict.pop("change_reason", None)

    # Build prospective merged dictionary for validation
    prospective_data = {
        "organization_data": update_dict.get("organization_data") or profile.organization_data,
        "audience_data": update_dict.get("audience_data") or profile.audience_data,
        "behavior_data": update_dict.get("behavior_data") or profile.behavior_data,
        "retrieval_policy": update_dict.get("retrieval_policy") or profile.retrieval_policy,
        "source_authority_policy": update_dict.get("source_authority_policy") or profile.source_authority_policy,
        "citation_policy": update_dict.get("citation_policy") or profile.citation_policy,
        "evidence_policy": update_dict.get("evidence_policy") or profile.evidence_policy,
        "conflict_policy": update_dict.get("conflict_policy") or profile.conflict_policy,
        "restriction_policy": update_dict.get("restriction_policy") or profile.restriction_policy,
        "fallback_policy": update_dict.get("fallback_policy") or profile.fallback_policy,
    }

    # Validate before persisting
    validation: ProfileValidationResult = AIProfileValidator.validate_profile_dict(prospective_data)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Configuration validation failed: {'; '.join(validation.errors)}"
        )

    # Save historical version before applying updates
    if change_reason:
        await AIProfileService.create_new_version(
            db=db,
            profile_id=profile.id,
            tenant_id=tenant.id,
            change_reason=change_reason,
            user_id=current_admin.id
        )

    for k, v in update_dict.items():
        if hasattr(profile, k) and v is not None:
            setattr(profile, k, v)

    await db.commit()
    await db.refresh(profile)
    return profile


@router.post(
    "/versions",
    response_model=AIProfileVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create an immutable historical snapshot of the current profile"
)
async def create_profile_version(
    change_reason: str,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates an immutable version snapshot for auditability and rollbacks.
    """
    profile, _ = await AIProfileService.get_or_create_default_profile(
        db=db, tenant_id=tenant.id, tenant_name=tenant.name
    )
    v_record = await AIProfileService.create_new_version(
        db=db,
        profile_id=profile.id,
        tenant_id=tenant.id,
        change_reason=change_reason,
        user_id=current_admin.id
    )
    return v_record


@router.get(
    "/versions",
    response_model=List[AIProfileVersionRead],
    summary="List all historical version snapshots for active profile"
)
async def list_profile_versions(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lists historical versions of the organization profile ordered newest first.
    """
    stmt = (
        select(AIProfileVersion)
        .where(AIProfileVersion.tenant_id == tenant.id)
        .order_by(AIProfileVersion.version.desc())
    )
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post(
    "/versions/{version_number}/restore",
    response_model=AIProfileRead,
    summary="Restore profile configuration from an earlier version snapshot"
)
async def restore_profile_version(
    version_number: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Rolls back the active profile to a previous version snapshot.
    """
    v_stmt = (
        select(AIProfileVersion)
        .where(AIProfileVersion.tenant_id == tenant.id, AIProfileVersion.version == version_number)
    )
    v_res = await db.execute(v_stmt)
    v_record = v_res.scalar_one_or_none()
    if not v_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {version_number} not found for your organization."
        )

    profile, _ = await AIProfileService.get_or_create_default_profile(
        db=db, tenant_id=tenant.id, tenant_name=tenant.name
    )

    # Save snapshot of current state before rollback
    await AIProfileService.create_new_version(
        db=db,
        profile_id=profile.id,
        tenant_id=tenant.id,
        change_reason=f"Pre-rollback snapshot before restoring version {version_number}.",
        user_id=current_admin.id
    )

    snap = v_record.snapshot_json
    profile.organization_data = snap.get("organization_data", profile.organization_data)
    profile.audience_data = snap.get("audience_data", profile.audience_data)
    profile.behavior_data = snap.get("behavior_data", profile.behavior_data)
    profile.retrieval_policy = snap.get("retrieval_policy", profile.retrieval_policy)
    profile.source_authority_policy = snap.get("source_authority_policy", profile.source_authority_policy)
    profile.citation_policy = snap.get("citation_policy", profile.citation_policy)
    profile.evidence_policy = snap.get("evidence_policy", profile.evidence_policy)
    profile.conflict_policy = snap.get("conflict_policy", profile.conflict_policy)
    profile.restriction_policy = snap.get("restriction_policy", profile.restriction_policy)
    profile.fallback_policy = snap.get("fallback_policy", profile.fallback_policy)

    await db.commit()
    await db.refresh(profile)
    return profile


@router.post(
    "/validate",
    response_model=ProfileValidationResult,
    summary="Validate proposed profile settings without saving"
)
async def validate_profile(
    payload: Dict[str, Any],
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user)
):
    """
    Validates a draft profile dictionary, reporting errors or contradictions.
    """
    return AIProfileValidator.validate_profile_dict(payload)


@router.post(
    "/test",
    response_model=AIProfileTestResponse,
    summary="Playground: Test a query against active profile and persona with full diagnostics"
)
async def test_profile_query(
    payload: AIProfileTestRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Test Assistant Playground:
    Executes end-to-end GraphRAG pipeline and returns the synthesized answer,
    verified citations, evidence status, and a breakdown of 'Why did OmniGraph answer this way?'.
    """
    t_start = time.perf_counter()

    # 1. Fetch active profile
    profile, default_persona = await AIProfileService.get_or_create_default_profile(
        db=db, tenant_id=tenant.id, tenant_name=tenant.name
    )

    # 2. Resolve requested persona or default
    active_persona = default_persona
    if payload.persona_id:
        p_stmt = select(Persona).where(Persona.id == payload.persona_id, Persona.tenant_id == tenant.id)
        p_res = await db.execute(p_stmt)
        custom_p = p_res.scalar_one_or_none()
        if custom_p:
            active_persona = custom_p

    # Fetch ChatbotConfig for API key overrides
    cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant.id)
    cfg_res = await db.execute(cfg_stmt)
    config = cfg_res.scalar_one_or_none()

    top_k = profile.retrieval_policy.get("topK", 4)
    max_hops = profile.retrieval_policy.get("maxGraphDepth", 2)

    rag_response = await RAGPipelineService.answer_query(
        db=db,
        tenant_id=tenant.id,
        query=payload.question,
        top_k_chunks=top_k,
        max_graph_hops=max_hops,
        gemini_api_key=config.gemini_api_key if config else None,
        tenant_name=tenant.name,
        openai_api_key=config.openai_api_key if config else None,
        ai_profile=profile,
        persona=active_persona,
    )

    t_elapsed = round((time.perf_counter() - t_start) * 1000, 2)

    test_citations: List[AIProfileTestCitation] = []
    for idx, s in enumerate(rag_response.source_citations, 1):
        stype = EvidenceBuilder.infer_source_type(s.source_name)
        auth_weight = EvidenceBuilder.get_authority_multiplier(stype, profile.source_authority_policy)
        test_citations.append(
            AIProfileTestCitation(
                evidence_id=f"EV_{idx}",
                document_title=s.source_name,
                page=None,
                snippet=s.snippet,
                authority_score=auth_weight,
                retrieval_score=s.similarity_score
            )
        )

    graph_paths = [
        f"({g.source_entity}) -[{g.relation}]-> ({g.target_entity})"
        for g in rag_response.graph_citations
    ]

    why_breakdown = {
        "groundingMode": profile.evidence_policy.get("mode", "strict"),
        "citationsMandatory": profile.citation_policy.get("citationsRequired", True),
        "sourceAuthorityApplied": True,
        "personaAdherence": {
            "name": active_persona.name,
            "tone": active_persona.tone,
            "expertiseLevel": active_persona.expertise_level,
            "stepByStep": active_persona.step_by_step
        },
        "retrievalWeights": {
            "topK": top_k,
            "maxGraphDepth": max_hops,
            "vectorWeight": profile.retrieval_policy.get("vectorWeight", 0.6),
            "graphWeight": profile.retrieval_policy.get("graphWeight", 0.4)
        }
    }

    return AIProfileTestResponse(
        answer=rag_response.answer,
        evidence_status=rag_response.evidence_status or "sufficient",
        citations=test_citations,
        retrieved_chunks_count=len(rag_response.source_citations),
        graph_entities_count=len(rag_response.entities_detected),
        graph_paths=graph_paths,
        active_profile_version=profile.version,
        active_persona_name=active_persona.name,
        retrieval_strategy=f"Hybrid GraphRAG (Top-K: {top_k}, Max Hops: {max_hops})",
        execution_time_ms=t_elapsed,
        why_answered_this_way=why_breakdown
    )
