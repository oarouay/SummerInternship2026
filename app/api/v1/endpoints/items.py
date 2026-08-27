from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.item import Item
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.item import ItemCreate, ItemResponse, ItemUpdate

router = APIRouter(prefix="/items", tags=["Sample Tenant-Isolated Resource (Items)"])


@router.get(
    "/",
    response_model=List[ItemResponse],
    summary="List all items for the current tenant"
)
async def list_items(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all items strictly scoped to the caller's active tenant."""
    stmt = select(Item).where(Item.tenant_id == tenant.id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post(
    "/",
    response_model=ItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new item under the current tenant"
)
async def create_item(
    payload: ItemCreate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a resource automatically stamped with the active tenant's ID and current user's ID."""
    item = Item(
        title=payload.title,
        description=payload.description or "",
        tenant_id=tenant.id,
        owner_id=current_user.id
    )
    db.add(item)
    await db.flush()
    return item


@router.get(
    "/{item_id}",
    response_model=ItemResponse,
    summary="Get item by ID (strictly within current tenant)"
)
async def get_item(
    item_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Fetch an item by ID, guaranteeing it belongs to the current tenant."""
    stmt = select(Item).where(Item.id == item_id, Item.tenant_id == tenant.id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found within your organization"
        )
    return item


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete item by ID (strictly within current tenant)"
)
async def delete_item(
    item_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete an item belonging to the current tenant."""
    stmt = select(Item).where(Item.id == item_id, Item.tenant_id == tenant.id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found within your organization"
        )
        
    await db.delete(item)
    return None
