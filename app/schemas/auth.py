from typing import Optional
from pydantic import BaseModel, EmailStr, Field
from app.schemas.tenant import TenantResponse
from app.schemas.user import UserResponse


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_id: int
    tenant_slug: str


class TokenPayload(BaseModel):
    sub: Optional[str] = None
    tenant_id: Optional[str] = None
    role: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_slug: Optional[str] = Field(None, description="Optional tenant slug to disambiguate or verify tenant")


class TenantRegisterRequest(BaseModel):
    """Payload for onboarding a new Tenant with its initial Administrator user."""
    # Tenant details
    tenant_name: str = Field(..., min_length=2, max_length=100, examples=["Acme Corp"])
    tenant_slug: str = Field(..., min_length=2, max_length=50, pattern="^[a-z0-9-]+$", examples=["acme-corp"])
    tenant_description: Optional[str] = Field(default="", max_length=255)
    
    # Initial Admin user details
    admin_email: EmailStr = Field(..., examples=["admin@acme.com"])
    admin_password: str = Field(..., min_length=8, max_length=100, examples=["AdminSecurePassword123!"])
    admin_name: Optional[str] = Field(None, max_length=100, examples=["Alice Admin"])


class AuthMeResponse(BaseModel):
    user: UserResponse
    tenant: TenantResponse
