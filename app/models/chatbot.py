from typing import Optional
from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin


class ChatbotConfig(Base, TenantMixin, TimestampMixin):
    """
    Tenant-specific configuration and personalization for the GraphRAG chatbot.
    Enforces a strict 1-to-1 relationship per tenant.
    """
    __tablename__ = "chatbot_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    name: Mapped[str] = mapped_column(
        String(100), default="OmniGraph Assistant", nullable=False
    )
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    welcome_message: Mapped[str] = mapped_column(
        String(500),
        default="Hello! I am your organization's AI assistant. How can I help you today?",
        nullable=False,
    )
    tone: Mapped[str] = mapped_column(
        String(50), default="professional", nullable=False
    )  # professional, technical, friendly, concise
    system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    default_top_k: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    default_max_hops: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.2, nullable=False)

    # Optional tenant-specific Gemini API Key override
    gemini_api_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
