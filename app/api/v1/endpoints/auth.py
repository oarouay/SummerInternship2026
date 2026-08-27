from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.dependencies.auth import get_current_user
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import AuthMeResponse, LoginRequest, TenantRegisterRequest, Token
from app.schemas.tenant import TenantResponse
from app.schemas.user import UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication & Onboarding"])


@router.post(
    "/register-tenant",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new Tenant organization and initial Admin user"
)
async def register_tenant(
    payload: TenantRegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """Atomically onboards a new Tenant along with its first Admin user."""
    # Check if slug is already taken
    existing_tenant_stmt = select(Tenant).where(Tenant.slug == payload.tenant_slug.lower())
    res = await db.execute(existing_tenant_stmt)
    if res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tenant identifier '{payload.tenant_slug}' is already registered."
        )

    # Check if email is already taken
    existing_user_stmt = select(User).where(User.email == payload.admin_email.lower())
    res_user = await db.execute(existing_user_stmt)
    if res_user.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User with email '{payload.admin_email}' already exists."
        )

    # Create tenant
    new_tenant = Tenant(
        name=payload.tenant_name,
        slug=payload.tenant_slug.lower(),
        description=payload.tenant_description or "",
        is_active=True
    )
    db.add(new_tenant)
    await db.flush()  # Flush to generate new_tenant.id

    # Create admin user
    hashed_pwd = get_password_hash(payload.admin_password)
    admin_user = User(
        email=payload.admin_email.lower(),
        hashed_password=hashed_pwd,
        full_name=payload.admin_name,
        role="admin",
        is_active=True,
        is_superuser=False,
        tenant_id=new_tenant.id
    )
    db.add(admin_user)
    await db.flush()

    # Generate token
    token = create_access_token(
        subject=admin_user.id,
        tenant_id=new_tenant.id,
        extra_claims={"role": admin_user.role, "email": admin_user.email}
    )

    return {
        "message": "Tenant organization registered successfully.",
        "tenant": TenantResponse.model_validate(new_tenant),
        "user": UserResponse.model_validate(admin_user),
        "access_token": token,
        "token_type": "bearer"
    }


@router.post(
    "/login",
    response_model=Token,
    summary="User Login (JSON body)"
)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """Authenticate user with email/password and issue tenant-scoped JWT."""
    stmt = select(User).options(selectinload(User.tenant)).where(User.email == payload.email.lower())
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    if not user.tenant or not user.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User's tenant organization is inactive"
        )

    # Optional slug check if client provides one
    if payload.tenant_slug and user.tenant.slug != payload.tenant_slug.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not belong to the specified tenant"
        )

    token = create_access_token(
        subject=user.id,
        tenant_id=user.tenant_id,
        extra_claims={"role": user.role, "email": user.email}
    )

    return Token(
        access_token=token,
        token_type="bearer",
        tenant_id=user.tenant_id,
        tenant_slug=user.tenant.slug
    )


@router.post(
    "/login/oauth",
    response_model=Token,
    summary="OAuth2 Password Form Login (For Swagger UI Docs)"
)
async def login_oauth(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """OAuth2 compatible token login for Swagger UI interactive testing."""
    stmt = select(User).options(selectinload(User.tenant)).where(User.email == form_data.username.lower())
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username (email) or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active or not user.tenant or not user.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account or tenant is inactive"
        )

    token = create_access_token(
        subject=user.id,
        tenant_id=user.tenant_id,
        extra_claims={"role": user.role, "email": user.email}
    )

    return Token(
        access_token=token,
        token_type="bearer",
        tenant_id=user.tenant_id,
        tenant_slug=user.tenant.slug
    )


@router.get(
    "/me",
    response_model=AuthMeResponse,
    summary="Get current user & tenant information"
)
async def get_me(
    current_user: User = Depends(get_current_user)
):
    """Returns profile information for the authenticated user and their active tenant."""
    return AuthMeResponse(
        user=UserResponse.model_validate(current_user),
        tenant=TenantResponse.model_validate(current_user.tenant)
    )
