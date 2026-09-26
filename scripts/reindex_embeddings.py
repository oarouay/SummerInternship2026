import argparse
import asyncio
import logging
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, init_db
from app.models.chatbot import ChatbotConfig
from app.models.chunk import DocumentChunk
from app.services.embedding import OpenAIEmbeddingService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reindex_embeddings")


async def reindex_tenant(tenant_id: int, api_key: str | None = None, batch_size: int = 20):
    await init_db()
    async with AsyncSessionLocal() as db:
        # Determine effective OpenAI API key
        effective_key = api_key
        if not effective_key:
            cfg_stmt = select(ChatbotConfig).where(ChatbotConfig.tenant_id == tenant_id)
            cfg_res = await db.execute(cfg_stmt)
            cfg = cfg_res.scalar_one_or_none()
            if cfg and cfg.openai_api_key:
                effective_key = cfg.openai_api_key

        if not effective_key:
            effective_key = settings.OPENAI_API_KEY

        if not effective_key:
            logger.error(
                f"No OpenAI API key found for tenant {tenant_id}. "
                "Provide --api-key or configure OPENAI_API_KEY in .env or tenant chatbot settings."
            )
            return False

        logger.info(f"Re-indexing chunks for tenant {tenant_id} using OpenAI text-embedding-3-small (768d)...")
        embed_service = OpenAIEmbeddingService(
            api_key=effective_key,
            model="text-embedding-3-small",
            dimensions=settings.EMBEDDING_DIMENSIONS
        )

        stmt = select(DocumentChunk).where(DocumentChunk.tenant_id == tenant_id).order_by(DocumentChunk.id.asc())
        res = await db.execute(stmt)
        chunks = res.scalars().all()

        total = len(chunks)
        if total == 0:
            logger.info(f"No document chunks found for tenant {tenant_id}.")
            return True

        logger.info(f"Found {total} chunks to re-index.")
        processed = 0

        for i in range(0, total, batch_size):
            batch = chunks[i : i + batch_size]
            texts = [c.content for c in batch]
            logger.info(f"Embedding batch {i + 1} to {min(i + batch_size, total)} of {total}...")
            embeddings = await embed_service.embed_documents(texts)
            for idx, c in enumerate(batch):
                c.embedding = embeddings[idx]
            await db.commit()
            processed += len(batch)

        logger.info(f"Successfully re-indexed {processed}/{total} chunks for tenant {tenant_id}!")
        return True


async def main():
    parser = argparse.ArgumentParser(description="Re-index document chunk embeddings using OpenAI")
    parser.add_argument("--tenant-id", type=int, default=1, help="Tenant ID to re-index (default: 1)")
    parser.add_argument("--api-key", type=str, default=None, help="OpenAI API key override")
    parser.add_argument("--batch-size", type=int, default=20, help="Batch size for embedding calls")
    args = parser.parse_args()

    success = await reindex_tenant(
        tenant_id=args.tenant_id,
        api_key=args.api_key,
        batch_size=args.batch_size
    )
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
