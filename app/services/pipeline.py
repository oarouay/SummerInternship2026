import asyncio
import json
import logging
from sqlalchemy import delete, select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.chatbot import ChatbotConfig
from app.models.chunk import DocumentChunk
from app.models.source import Source, SourceStatus, SourceType
from app.services.chunking import RecursiveTextSplitter
from app.services.embedding import get_embedding_service
from app.services.extractor import get_graph_extractor
from app.services.graph import get_graph_store
from app.services.parser import parse_document

logger = logging.getLogger(__name__)


async def process_source_pipeline(source_id: int) -> None:
    """
    Background pipeline that parses document text, generates recursive chunks,
    and updates source status to INDEXED or FAILED.
    """
    async with AsyncSessionLocal() as db:
        try:
            # 1. Fetch Source with retry to guarantee read-after-write consistency
            source = None
            for _ in range(5):
                stmt = select(Source).where(Source.id == source_id)
                result = await db.execute(stmt)
                source = result.scalar_one_or_none()
                if source:
                    break
                await asyncio.sleep(0.15)

            if not source:
                logger.error(f"[Pipeline] Source {source_id} not found.")
                return

            # Check tenant ChatbotConfig for custom gemini_api_key override
            cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == source.tenant_id)
            cfg_res = await db.execute(cfg_stmt)
            chatbot_cfg = cfg_res.scalar_one_or_none()
            tenant_gemini_key = chatbot_cfg.gemini_api_key if chatbot_cfg else None

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
            elif source.source_type in (SourceType.RAW_TEXT.value, SourceType.URL.value):
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

            # 5. Generate Vector Embeddings (Google Gemini text-embedding-004)
            embedding_service = get_embedding_service(api_key=tenant_gemini_key)
            chunk_texts = [meta["content"] for meta in chunks_data]
            embeddings = await embedding_service.embed_documents(chunk_texts)

            # 6. Clear old chunks if re-processing
            await db.execute(delete(DocumentChunk).where(DocumentChunk.source_id == source.id))

            # 7. Insert new DocumentChunks with vectors
            total_tokens = 0
            created_chunk_records = []
            for idx, meta in enumerate(chunks_data):
                total_tokens += meta["token_count"]
                emb = embeddings[idx] if idx < len(embeddings) else None
                chunk_record = DocumentChunk(
                    source_id=source.id,
                    chunk_index=meta["chunk_index"],
                    content=meta["content"],
                    char_count=meta["char_count"],
                    token_count=meta["token_count"],
                    tenant_id=source.tenant_id,
                    embedding=emb
                )
                db.add(chunk_record)
                created_chunk_records.append(chunk_record)

            await db.flush()

            # 8. Knowledge Graph Construction (Entity & Relationship Extraction)
            total_entities = 0
            total_relationships = 0
            if settings.GRAPH_ENABLED:
                graph_store = await get_graph_store()
                graph_extractor = get_graph_extractor(api_key=tenant_gemini_key)

                # Clean any previous graph data for this source
                await graph_store.delete_tenant_source_graph(
                    tenant_id=source.tenant_id, source_id=source.id
                )

                for chunk_rec in created_chunk_records:
                    graph_res = await graph_extractor.extract_graph(chunk_rec.content)
                    total_entities += len(graph_res.entities)
                    total_relationships += len(graph_res.relationships)
                    await graph_store.insert_graph(
                        tenant_id=source.tenant_id,
                        source_id=source.id,
                        chunk_id=chunk_rec.id,
                        graph=graph_res,
                    )

            # 9. Update status to INDEXED
            source.status = SourceStatus.INDEXED.value
            source.metadata_json = json.dumps({
                "chunk_count": len(chunks_data),
                "total_chars": len(clean_text),
                "total_tokens": total_tokens,
                "embedding_model": settings.EMBEDDING_MODEL,
                "embedding_dimensions": settings.EMBEDDING_DIMENSIONS,
                "graph_entities": total_entities,
                "graph_relationships": total_relationships,
            })
            await db.commit()
            logger.info(
                f"[Pipeline] Successfully indexed source {source.id} with {len(chunks_data)} chunks, "
                f"{total_entities} graph entities, and {total_relationships} relationships."
            )

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
