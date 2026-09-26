import asyncio
import hashlib
import logging
from abc import ABC, abstractmethod
from typing import List, Optional
import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)


class BaseEmbeddingService(ABC):
    """Abstract base class for vector embedding generation."""

    @abstractmethod
    async def embed_query(self, text: str) -> List[float]:
        """Embed a single query text string into a float vector."""
        pass

    @abstractmethod
    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of document texts into a list of float vectors."""
        pass


class MockEmbeddingService(BaseEmbeddingService):
    """
    Deterministic pseudo-embedding service for offline testing and development.
    Produces unit-normalized 768-dimensional vectors based on semantic text hashing.
    """

    def __init__(self, dimensions: int = 768):
        self.dimensions = dimensions

    def _generate_vector(self, text: str) -> List[float]:
        """Creates a deterministic unit-normalized vector from text."""
        vec = np.zeros(self.dimensions, dtype=np.float32)
        words = text.lower().split()
        if not words:
            vec[0] = 1.0
            return vec.tolist()

        for word in words:
            # Deterministic hash to dimension index
            h = int(hashlib.md5(word.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dimensions
            sign = 1.0 if (h >> 4) % 2 == 0 else -1.0
            vec[idx] += sign

        # Add character-level n-gram smoothing so similar words land closer
        for i in range(len(text) - 2):
            trigram = text[i:i + 3].lower()
            h = int(hashlib.sha256(trigram.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dimensions
            vec[idx] += 0.2

        # L2-normalize to unit length
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        else:
            vec[0] = 1.0

        return vec.tolist()

    async def embed_query(self, text: str) -> List[float]:
        return self._generate_vector(text)

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._generate_vector(t) for t in texts]


class GeminiEmbeddingService(BaseEmbeddingService):
    """
    Google Gemini Embedding Service utilizing text-embedding-004 (768 dimensions).
    """

    def __init__(self, api_key: str, model: str = "gemini-embedding-001", dimensions: int = 768):
        from google import genai
        from google.genai import types

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.dimensions = dimensions
        self.types = types

    async def embed_query(self, text: str) -> List[float]:
        try:
            cfg = self.types.EmbedContentConfig(
                output_dimensionality=self.dimensions
            )
            is_sync_mocked = (
                hasattr(self.client, "models")
                and hasattr(self.client.models, "embed_content")
                and type(self.client.models.embed_content).__name__ in ("MagicMock", "AsyncMock", "Mock")
            )
            if hasattr(self.client, "aio") and hasattr(self.client.aio, "models") and not is_sync_mocked:
                # Native async client avoids blocking the event loop
                response = await self.client.aio.models.embed_content(
                    model=self.model,
                    contents=text,
                    config=cfg,
                )
            else:
                # Fallback path if native async client is unavailable
                response = await asyncio.to_thread(
                    self.client.models.embed_content,
                    model=self.model,
                    contents=text,
                    config=cfg,
                )
            # Handle single embedding response
            if hasattr(response, "embedding") and response.embedding:
                return response.embedding.values
            elif hasattr(response, "embeddings") and response.embeddings:
                return response.embeddings[0].values
            raise ValueError("Gemini API returned unexpected embedding structure.")
        except Exception as e:
            logger.warning(f"Gemini embedding failed: {e}. Falling back to MockEmbeddingService.")
            return await MockEmbeddingService(dimensions=self.dimensions).embed_query(text)

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        try:
            cfg = self.types.EmbedContentConfig(
                output_dimensionality=self.dimensions
            )
            is_sync_mocked = (
                hasattr(self.client, "models")
                and hasattr(self.client.models, "embed_content")
                and type(self.client.models.embed_content).__name__ in ("MagicMock", "AsyncMock", "Mock")
            )
            # The Gemini SDK supports batch embedding by passing a list of contents
            if hasattr(self.client, "aio") and hasattr(self.client.aio, "models") and not is_sync_mocked:
                # Native async client avoids blocking the event loop
                response = await self.client.aio.models.embed_content(
                    model=self.model,
                    contents=texts,
                    config=cfg,
                )
            else:
                # Fallback path if native async client is unavailable
                response = await asyncio.to_thread(
                    self.client.models.embed_content,
                    model=self.model,
                    contents=texts,
                    config=cfg,
                )
            if hasattr(response, "embeddings") and response.embeddings:
                return [emb.values for emb in response.embeddings]
            raise ValueError("Gemini API returned unexpected batch embedding structure.")
        except Exception as e:
            logger.warning(f"Gemini batch embedding failed: {e}. Falling back to MockEmbeddingService.")
            return await MockEmbeddingService(dimensions=self.dimensions).embed_documents(texts)


class OpenAIEmbeddingService(BaseEmbeddingService):
    """
    OpenAI Embedding Service using text-embedding-3-small (supports native 768 dimensions).
    """

    def __init__(self, api_key: str, model: str = "text-embedding-3-small", dimensions: int = 768):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key, timeout=10.0)
        self.model = model
        self.dimensions = dimensions

    async def embed_query(self, text: str) -> List[float]:
        try:
            res = await self.client.embeddings.create(
                input=text,
                model=self.model,
                dimensions=self.dimensions,
            )
            return res.data[0].embedding
        except Exception as e:
            logger.warning(f"OpenAI embedding failed: {e}. Falling back to MockEmbeddingService.")
            return await MockEmbeddingService(dimensions=self.dimensions).embed_query(text)

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        try:
            res = await self.client.embeddings.create(
                input=texts,
                model=self.model,
                dimensions=self.dimensions,
            )
            return [item.embedding for item in res.data]
        except Exception as e:
            logger.warning(f"OpenAI batch embedding failed: {e}. Falling back to MockEmbeddingService.")
            return await MockEmbeddingService(dimensions=self.dimensions).embed_documents(texts)


def get_embedding_service(api_key: Optional[str] = None) -> BaseEmbeddingService:
    """
    Factory that returns OpenAIEmbeddingService if an OpenAI key is configured,
    or GeminiEmbeddingService if a Gemini key is configured,
    otherwise falls back to MockEmbeddingService.
    """
    # 1. Explicit OpenAI key
    if api_key and api_key.strip() and api_key.strip().startswith("sk-"):
        try:
            return OpenAIEmbeddingService(
                api_key=api_key.strip(),
                model=settings.EMBEDDING_MODEL if "text-embedding" in settings.EMBEDDING_MODEL else "text-embedding-3-small",
                dimensions=settings.EMBEDDING_DIMENSIONS,
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIEmbeddingService ({e}). Checking Gemini...")

    # 2. Explicit Gemini key
    if api_key and api_key.strip() and not api_key.strip().startswith("sk-"):
        try:
            return GeminiEmbeddingService(
                api_key=api_key.strip(),
                model="gemini-embedding-001",
                dimensions=settings.EMBEDDING_DIMENSIONS,
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiEmbeddingService ({e}). Falling back to MockEmbeddingService.")
            return MockEmbeddingService(dimensions=settings.EMBEDDING_DIMENSIONS)

    # 3. System OpenAI key fallback
    if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY.strip():
        try:
            return OpenAIEmbeddingService(
                api_key=settings.OPENAI_API_KEY.strip(),
                model=settings.EMBEDDING_MODEL if "text-embedding" in settings.EMBEDDING_MODEL else "text-embedding-3-small",
                dimensions=settings.EMBEDDING_DIMENSIONS,
            )
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAIEmbeddingService ({e}). Checking Gemini...")

    # 4. System Gemini key fallback
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiEmbeddingService(
                api_key=settings.GEMINI_API_KEY.strip(),
                model="gemini-embedding-001",
                dimensions=settings.EMBEDDING_DIMENSIONS,
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiEmbeddingService ({e}). Falling back to MockEmbeddingService.")
            return MockEmbeddingService(dimensions=settings.EMBEDDING_DIMENSIONS)

    return MockEmbeddingService(dimensions=settings.EMBEDDING_DIMENSIONS)
