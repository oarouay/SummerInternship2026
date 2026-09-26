import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_active_admin, get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.ai_profile import AIProfile, Persona
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.persona import PersonaCreate, PersonaRead, PersonaUpdate
from app.services.ai_profile_service import AIProfileService
from app.services.ai_profile_validator import AIProfileValidator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/personas", tags=["Personas & Assistant Roles"])


@router.get(
    "",
    response_model=List[PersonaRead],
    summary="List all personas belonging to the tenant"
)
async def list_personas(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns all personas configured for the active organization.
    """
    stmt = (
        select(Persona)
        .where(Persona.tenant_id == tenant.id)
        .order_by(Persona.is_default.desc(), Persona.id.asc())
    )
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post(
    "",
    response_model=PersonaRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new persona under active AI Profile with policy precedence validation"
)
async def create_persona(
    payload: PersonaCreate,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new persona under the active AI Profile.
    Validates that persona settings do not violate mandatory organization policies.
    """
    profile, _ = await AIProfileService.get_or_create_default_profile(
        db=db, tenant_id=tenant.id, tenant_name=tenant.name
    )

    persona_dict = payload.model_dump()
    validation = AIProfileValidator.validate_persona_against_profile(
        persona_data=persona_dict,
        profile_data={
            "citation_policy": profile.citation_policy,
            "evidence_policy": profile.evidence_policy
        }
    )
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Persona validation failed: {'; '.join(validation.errors)}"
        )

    # If new persona is designated default, unset previous default
    if payload.is_default:
        existing_stmt = select(Persona).where(Persona.tenant_id == tenant.id)
        existing_res = await db.execute(existing_stmt)
        for ep in existing_res.scalars().all():
            ep.is_default = False

    new_persona = Persona(
        tenant_id=tenant.id,
        profile_id=profile.id,
        name=payload.name.strip(),
        role=payload.role.strip(),
        purpose=payload.purpose.strip(),
        audience=payload.audience,
        tone=payload.tone,
        verbosity=payload.verbosity,
        expertise_level=payload.expertise_level,
        step_by_step=payload.step_by_step,
        define_specialized_terms=payload.define_specialized_terms,
        include_examples=payload.include_examples,
        is_default=payload.is_default
    )
    db.add(new_persona)
    await db.commit()
    await db.refresh(new_persona)
    return new_persona


@router.put(
    "/{persona_id}",
    response_model=PersonaRead,
    summary="Update persona configuration"
)
async def update_persona(
    persona_id: int,
    payload: PersonaUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates an existing persona's settings, enforcing organization policy precedence.
    """
    stmt = select(Persona).where(Persona.id == persona_id, Persona.tenant_id == tenant.id)
    res = await db.execute(stmt)
    persona = res.scalar_one_or_none()
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Persona not found in your organization."
        )

    profile, _ = await AIProfileService.get_or_create_default_profile(
        db=db, tenant_id=tenant.id, tenant_name=tenant.name
    )

    update_dict = payload.model_dump(exclude_unset=True)
    merged_data = {
        "name": update_dict.get("name", persona.name),
        "role": update_dict.get("role", persona.role),
        "purpose": update_dict.get("purpose", persona.purpose),
    }

    validation = AIProfileValidator.validate_persona_against_profile(
        persona_data=merged_data,
        profile_data={
            "citation_policy": profile.citation_policy,
            "evidence_policy": profile.evidence_policy
        }
    )
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Persona validation failed: {'; '.join(validation.errors)}"
        )

    # Handle default toggle
    if update_dict.get("is_default") is True:
        existing_stmt = select(Persona).where(Persona.tenant_id == tenant.id)
        existing_res = await db.execute(existing_stmt)
        for ep in existing_res.scalars().all():
            ep.is_default = False

    for k, v in update_dict.items():
        if hasattr(persona, k) and v is not None:
            setattr(persona, k, v)

    await db.commit()
    await db.refresh(persona)
    return persona


@router.delete(
    "/{persona_id}",
    summary="Delete a non-default persona"
)
async def delete_persona(
    persona_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Deletes a custom persona. The organization default persona cannot be deleted.
    """
    stmt = select(Persona).where(Persona.id == persona_id, Persona.tenant_id == tenant.id)
    res = await db.execute(stmt)
    persona = res.scalar_one_or_none()
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Persona not found in your organization."
        )

    if persona.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the default persona. Set another persona as default first."
        )

    await db.delete(persona)
    await db.commit()
    return {"detail": f"Persona '{persona.name}' deleted successfully."}


@router.post(
    "/{persona_id}/set-default",
    response_model=PersonaRead,
    summary="Set a persona as organization default"
)
async def set_default_persona(
    persona_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Sets the specified persona as the default assistant persona for the tenant.
    """
    stmt = select(Persona).where(Persona.id == persona_id, Persona.tenant_id == tenant.id)
    res = await db.execute(stmt)
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Persona not found in your organization."
        )

    all_stmt = select(Persona).where(Persona.tenant_id == tenant.id)
    all_res = await db.execute(all_stmt)
    for p in all_res.scalars().all():
        p.is_default = (p.id == persona_id)

    await db.commit()
    await db.refresh(target)
    return target
