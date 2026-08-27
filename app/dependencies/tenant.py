from typing import Type, TypeVar
from fastapi import Depends, HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import get_current_user
from app.models.tenant import Tenant
from app.models.user import User

T = TypeVar("T")


class TenantContext:
    """Encapsulates active tenant information and provides isolation helpers."""

    def __init__(self, tenant: Tenant, user: User):
        self.tenant = tenant
        self.user = user
        self.tenant_id = tenant.id
        self.tenant_slug = tenant.slug

    def filter_query(self, query: Select, model: Type[T]) -> Select:
        """Helper to enforce row-level tenant filtering on any SQLAlchemy model."""
        if hasattr(model, "tenant_id"):
            return query.where(getattr(model, "tenant_id") == self.tenant_id)
        return query


async def get_current_tenant(
    current_user: User = Depends(get_current_user)
) -> Tenant:
    """Retrieve and validate the active Tenant for the authenticated user."""
    tenant = current_user.tenant
    
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant associated with user not found"
        )
        
    if not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This tenant organization is currently deactivated"
        )
        
    return tenant


async def get_tenant_context(
    current_user: User = Depends(get_current_user),
    current_tenant: Tenant = Depends(get_current_tenant)
) -> TenantContext:
    """Dependency providing a TenantContext helper object."""
    return TenantContext(tenant=current_tenant, user=current_user)
