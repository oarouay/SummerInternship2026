from typing import List
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.source import Source, SourceStatus, SourceType
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.source import RawTextCreate, SourceResponse
from app.services.storage import delete_tenant_file, save_tenant_file

router = APIRouter(prefix="/sources", tags=["Data Sources & Document Ingestion"])


@router.get(
    "/",
    response_model=List[SourceResponse],
    summary="List all knowledge sources for current tenant"
)
async def list_sources(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all data sources scoped strictly to the current tenant."""
    stmt = (
        select(Source)
        .where(Source.tenant_id == tenant.id)
        .order_by(Source.created_at.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post(
    "/upload",
    response_model=SourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload document (PDF, TXT, DOCX, CSV, MD) into tenant knowledge base"
)
async def upload_source(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Document file to upload (PDF, TXT, DOCX, CSV, MD)"),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a document into tenant-isolated storage and register it in the ingestion queue.
    """
    relative_path, file_size, safe_name = await save_tenant_file(tenant.id, file)

    source = Source(
        name=safe_name,
        source_type=SourceType.FILE.value,
        status=SourceStatus.PENDING.value,
        mime_type=file.content_type or "application/octet-stream",
        file_size=file_size,
        file_path=relative_path,
        tenant_id=tenant.id,
        owner_id=current_user.id
    )
    db.add(source)
    await db.flush()

    # In future phases: background_tasks.add_task(process_source_pipeline, source.id)
    return source


@router.post(
    "/raw-text",
    response_model=SourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest raw text directly into tenant knowledge base"
)
async def ingest_raw_text(
    payload: RawTextCreate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Directly ingest raw text (e.g. FAQs, company policies) without requiring a file upload.
    """
    byte_size = len(payload.content.encode("utf-8"))
    source = Source(
        name=payload.name,
        source_type=SourceType.RAW_TEXT.value,
        status=SourceStatus.PENDING.value,
        mime_type="text/plain",
        file_size=byte_size,
        raw_content=payload.content,
        tenant_id=tenant.id,
        owner_id=current_user.id
    )
    db.add(source)
    await db.flush()
    return source


@router.get(
    "/{source_id}",
    response_model=SourceResponse,
    summary="Get source details and indexing status"
)
async def get_source(
    source_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Fetch single source details, strictly validating tenant ownership."""
    stmt = select(Source).where(Source.id == source_id, Source.tenant_id == tenant.id)
    result = await db.execute(stmt)
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found within your organization."
        )
    return source


@router.delete(
    "/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete source and remove file from storage"
)
async def delete_source(
    source_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete source record and remove any stored physical file from disk."""
    stmt = select(Source).where(Source.id == source_id, Source.tenant_id == tenant.id)
    result = await db.execute(stmt)
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found within your organization."
        )

    # Delete physical file if one exists
    if source.file_path:
        delete_tenant_file(source.file_path)

    await db.delete(source)
    await db.flush()
    return None

