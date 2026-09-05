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

    def __init__(self, api_key: str, model: str = "text-embedding-004", dimensions: int = 768):
        from google import genai
        from google.genai import types

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.dimensions = dimensions
        self.types = types

    async def embed_query(self, text: str) -> List[float]:
        response = self.client.models.embed_content(
            model=self.model,
            contents=text,
            config=self.types.EmbedContentConfig(
                output_dimensionality=self.dimensions
            )
        )
        # Handle single embedding response
        if hasattr(response, "embedding") and response.embedding:
            return response.embedding.values
        elif hasattr(response, "embeddings") and response.embeddings:
            return response.embeddings[0].values
        raise ValueError("Gemini API returned unexpected embedding structure.")

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        # The Gemini SDK supports batch embedding by passing a list of contents
        response = self.client.models.embed_content(
            model=self.model,
            contents=texts,
            config=self.types.EmbedContentConfig(
                output_dimensionality=self.dimensions
            )
        )
        if hasattr(response, "embeddings") and response.embeddings:
            return [emb.values for emb in response.embeddings]
        raise ValueError("Gemini API returned unexpected batch embedding structure.")


def get_embedding_service() -> BaseEmbeddingService:
    """
    Factory that returns GeminiEmbeddingService if GEMINI_API_KEY is present,
    otherwise falls back to MockEmbeddingService.
    """
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip():
        try:
            return GeminiEmbeddingService(
                api_key=settings.GEMINI_API_KEY,
                model=settings.EMBEDDING_MODEL,
                dimensions=settings.EMBEDDING_DIMENSIONS
            )
        except Exception as e:
            logger.warning(f"Failed to initialize GeminiEmbeddingService ({e}). Falling back to MockEmbeddingService.")
            return MockEmbeddingService(dimensions=settings.EMBEDDING_DIMENSIONS)
    
    return MockEmbeddingService(dimensions=settings.EMBEDDING_DIMENSIONS)
