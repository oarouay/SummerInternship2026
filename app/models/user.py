from typing import TYPE_CHECKING, List
from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant
    from app.models.item import Item
    from app.models.source import Source


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="admin", nullable=False)  # e.g., 'admin', 'member'
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Multi-tenancy link
    tenant_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="users")
    
    # User's items and sources
    items: Mapped[List["Item"]] = relationship("Item", back_populates="owner", cascade="all, delete-orphan")
    sources: Mapped[List["Source"]] = relationship("Source", back_populates="owner", cascade="all, delete-orphan")
