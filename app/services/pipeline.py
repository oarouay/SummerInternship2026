import json
import logging
from sqlalchemy import delete, select
from app.core.database import AsyncSessionLocal
from app.models.chunk import DocumentChunk
from app.models.source import Source, SourceStatus, SourceType
from app.services.chunking import RecursiveTextSplitter
from app.services.parser import parse_document

logger = logging.getLogger(__name__)


async def process_source_pipeline(source_id: int) -> None:
    """
    Background pipeline that parses document text, generates recursive chunks,
    and updates source status to INDEXED or FAILED.
    """
    async with AsyncSessionLocal() as db:
        try:
            # 1. Fetch Source
            stmt = select(Source).where(Source.id == source_id)
            result = await db.execute(stmt)
            source = result.scalar_one_or_none()

            if not source:
                logger.error(f"[Pipeline] Source {source_id} not found.")
                return

            # 2. Update status to PROCESSING
            source.status = SourceStatus.PROCESSING.value
            source.error_message = None
            await db.commit()
            await db.refresh(source)

            # 3. Extract Text
            extracted_text = ""
            if source.source_type == SourceType.FILE.value:
                if not source.file_path:
                    raise ValueError("File source missing file path on disk.")
                extracted_text = parse_document(source.file_path, source.mime_type)
            elif source.source_type == SourceType.RAW_TEXT.value:
                extracted_text = source.raw_content or ""
            else:
                raise ValueError(f"Unsupported source type: {source.source_type}")

            clean_text = extracted_text.strip()
            if not clean_text:
                raise ValueError("Source yielded no readable text content.")

            # 4. Chunk text with RecursiveTextSplitter
            splitter = RecursiveTextSplitter()
            chunks_data = splitter.split_text(clean_text)

            if not chunks_data:
                raise ValueError("Splitting document produced no text chunks.")

            # 5. Clear old chunks if re-processing
            await db.execute(delete(DocumentChunk).where(DocumentChunk.source_id == source.id))

            # 6. Insert new DocumentChunks
            total_tokens = 0
            for meta in chunks_data:
                total_tokens += meta["token_count"]
                chunk_record = DocumentChunk(
                    source_id=source.id,
                    chunk_index=meta["chunk_index"],
                    content=meta["content"],
                    char_count=meta["char_count"],
                    token_count=meta["token_count"],
                    tenant_id=source.tenant_id
                )
                db.add(chunk_record)

            # 7. Update status to INDEXED
            source.status = SourceStatus.INDEXED.value
            source.metadata_json = json.dumps({
                "chunk_count": len(chunks_data),
                "total_chars": len(clean_text),
                "total_tokens": total_tokens
            })
            await db.commit()
            logger.info(f"[Pipeline] Successfully indexed source {source.id} with {len(chunks_data)} chunks.")

        except Exception as e:
            logger.exception(f"[Pipeline] Processing failed for source {source_id}: {str(e)}")
            await db.rollback()
            # Mark source as FAILED with error detail
            try:
                stmt = select(Source).where(Source.id == source_id)
                res = await db.execute(stmt)
                src = res.scalar_one_or_none()
                if src:
                    src.status = SourceStatus.FAILED.value
                    src.error_message = str(e)
                    await db.commit()
            except Exception as final_err:
                logger.critical(f"[Pipeline] Failed to record error state for source {source_id}: {final_err}")
