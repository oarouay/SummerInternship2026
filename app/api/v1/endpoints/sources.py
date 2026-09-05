from typing import List
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.tenant import get_current_tenant
from app.models.chunk import DocumentChunk
from app.models.source import Source, SourceStatus, SourceType
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.chunk import DocumentChunkResponse
from app.schemas.search import SearchQuery, SearchResult
from app.schemas.source import RawTextCreate, SourceResponse, URLCrawlRequest
from app.services.crawler import fetch_and_clean_url
from app.services.embedding import get_embedding_service
from app.services.pipeline import process_source_pipeline
from app.services.search import search_similar_chunks
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
    Upload a document into tenant-isolated storage and asynchronously trigger the ingestion pipeline.
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

    # Trigger asynchronous parsing & chunking pipeline
    background_tasks.add_task(process_source_pipeline, source.id)
    return source


@router.post(
    "/raw-text",
    response_model=SourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest raw text directly into tenant knowledge base"
)
async def ingest_raw_text(
    payload: RawTextCreate,
    background_tasks: BackgroundTasks,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Directly ingest raw text (e.g. FAQs, company policies) and asynchronously trigger chunking.
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

    # Trigger asynchronous parsing & chunking pipeline
    background_tasks.add_task(process_source_pipeline, source.id)
    return source


@router.post(
    "/crawl",
    response_model=SourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crawl and index a public webpage URL with SSRF protection"
)
async def crawl_url(
    payload: URLCrawlRequest,
    background_tasks: BackgroundTasks,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Crawls a public web page, extracts readable text with SSRF protection,
    and enqueues it for vector embedding and knowledge graph indexing.
    """
    try:
        page_title, text_content = await fetch_and_clean_url(payload.url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to crawl URL: {str(e)}"
        )

    doc_name = payload.name or page_title
    source = Source(
        name=doc_name[:255],
        source_type=SourceType.URL.value,
        status=SourceStatus.PENDING.value,
        mime_type="text/html",
        file_path=payload.url,
        file_size=len(text_content.encode("utf-8")),
        raw_content=text_content,
        tenant_id=tenant.id,
        owner_id=current_user.id
    )
    db.add(source)
    await db.flush()

    background_tasks.add_task(process_source_pipeline, source.id)
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


@router.get(
    "/{source_id}/chunks",
    response_model=List[DocumentChunkResponse],
    summary="List all semantic chunks generated from a source"
)
async def get_source_chunks(
    source_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all chunks generated from a source, strictly scoped to current tenant."""
    # Ensure source exists and belongs to this tenant
    stmt_src = select(Source).where(Source.id == source_id, Source.tenant_id == tenant.id)
    res_src = await db.execute(stmt_src)
    source = res_src.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found within your organization."
        )

    stmt_chunks = (
        select(DocumentChunk)
        .where(DocumentChunk.source_id == source.id, DocumentChunk.tenant_id == tenant.id)
        .order_by(DocumentChunk.chunk_index.asc())
    )
    result = await db.execute(stmt_chunks)
    return result.scalars().all()


@router.post(
    "/{source_id}/reprocess",
    response_model=SourceResponse,
    summary="Re-trigger background ingestion pipeline for a source"
)
async def reprocess_source(
    source_id: int,
    background_tasks: BackgroundTasks,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Re-index a source by re-running document parsing and chunking."""
    stmt = select(Source).where(Source.id == source_id, Source.tenant_id == tenant.id)
    result = await db.execute(stmt)
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found within your organization."
        )

    source.status = SourceStatus.PENDING.value
    source.error_message = None
    await db.flush()

    background_tasks.add_task(process_source_pipeline, source.id)
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


@router.post(
    "/search",
    response_model=List[SearchResult],
    summary="Semantic vector search across tenant document chunks"
)
async def semantic_search(
    payload: SearchQuery,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Search document chunks within the caller's tenant using Google Gemini vector embeddings and Cosine Distance.
    """
    embedding_service = get_embedding_service()
    query_vector = await embedding_service.embed_query(payload.query)

    results = await search_similar_chunks(
        db=db,
        tenant_id=tenant.id,
        query_vector=query_vector,
        top_k=payload.top_k,
        source_id=payload.source_id
    )
    return results

