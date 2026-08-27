from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_password_hash
from app.dependencies.auth import get_current_active_admin, get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import TenantResponse, TenantUpdate
from app.schemas.user import UserCreate, UserResponse

router = APIRouter(prefix="/tenants", tags=["Tenant Administration"])


@router.get(
    "/current",
    response_model=TenantResponse,
    summary="Get current active Tenant details"
)
async def get_current_tenant_details(
    tenant: Tenant = Depends(get_current_tenant)
):
    """Retrieve details about the tenant organization of the current authenticated user."""
    return tenant


@router.patch(
    "/current",
    response_model=TenantResponse,
    summary="Update current Tenant metadata (Admin only)"
)
async def update_current_tenant_details(
    payload: TenantUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """Allows tenant administrators to update their organization profile."""
    if payload.name is not None:
        tenant.name = payload.name
    if payload.description is not None:
        tenant.description = payload.description
        
    db.add(tenant)
    await db.flush()
    return tenant


@router.get(
    "/users",
    response_model=List[UserResponse],
    summary="List all users within the current Tenant"
)
async def list_tenant_users(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists all team members belonging exclusively to the current tenant."""
    stmt = select(User).where(User.tenant_id == tenant.id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post(
    "/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a new user to the current Tenant (Admin only)"
)
async def create_tenant_user(
    payload: UserCreate,
    tenant: Tenant = Depends(get_current_tenant),
    admin: User = Depends(get_current_active_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create and invite a new user under the current tenant's isolation scope."""
    # Check if email is already taken
    stmt = select(User).where(User.email == payload.email.lower())
    res = await db.execute(stmt)
    if res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User with email '{payload.email}' already exists."
        )

    new_user = User(
        email=payload.email.lower(),
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        role=payload.role if payload.role in ["admin", "member"] else "member",
        is_active=True,
        is_superuser=False,
        tenant_id=tenant.id
    )
    db.add(new_user)
    await db.flush()
    return new_user
