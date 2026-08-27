# FastAPI Multi-Tenant Backend with Auth & Tenant Isolation

A modular, production-ready foundation for FastAPI featuring JWT Authentication, Role-based Access Control (RBAC), and Tenant Data Isolation.

---

## 🏗️ Architecture & Features

- **FastAPI**: Modern, async RESTful API framework.
- **Multi-Tenant Isolation**: Row-level tenant isolation using SQLAlchemy `TenantMixin` (`tenant_id`), where every tenant query is isolated via dependency injection.
- **JWT Authentication & Security**: Fast, secure password hashing (`bcrypt`) and signed token issuance (`pyjwt`) embedding both user and tenant context.
- **Async Database Layer**: SQLAlchemy 2.0 with async engine support (`aiosqlite` for zero-setup SQLite, ready for `asyncpg` / PostgreSQL).
- **Interactive Documentation**: Swagger UI at `/docs` with OAuth2 password flow support.
- **Test Suite**: Async tests using `pytest` and `httpx` verifying cross-tenant security and authentication flows.

---

## 📁 Project Structure

```
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   ├── auth.py          # /register-tenant, /login, /me
│   │       │   ├── tenants.py       # /current, /users
│   │       │   └── items.py         # Sample tenant-isolated resource
│   │       └── router.py            # Aggregated v1 endpoints
│   ├── core/
│   │   ├── config.py                # Pydantic Settings & environment loader
│   │   ├── database.py              # Async SQLAlchemy engine & session factory
│   │   └── security.py              # Bcrypt hashing & JWT utilities
│   ├── dependencies/
│   │   ├── auth.py                  # get_current_user & role checks
│   │   └── tenant.py                # get_current_tenant & TenantContext
│   ├── models/
│   │   ├── base.py                  # Base model & TenantMixin
│   │   ├── tenant.py                # Tenant model
│   │   ├── user.py                  # User model
│   │   └── item.py                  # Example tenant-isolated model
│   ├── schemas/
│   │   ├── auth.py                  # Token & Login schemas
│   │   ├── tenant.py                # Tenant schemas
│   │   ├── user.py                  # User schemas
│   │   └── item.py                  # Resource schemas
│   └── main.py                      # Application entrypoint & lifespan
├── tests/
│   ├── conftest.py                  # Pytest async fixtures & memory DB
│   └── test_auth_and_tenant.py      # Auth & Tenant isolation test suite
├── .env.example                     # Environment template
├── .env                             # Local environment configuration
├── requirements.txt                 # Dependencies
└── README.md
```

---

## 🚀 Quickstart Guide

### 1. Create and Activate Virtual Environment

```powershell
# In PowerShell (Windows)
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Development Server

```bash
uvicorn app.main:app --reload --port 8000
```

- API Base URL: `http://localhost:8000`
- Interactive API Docs (Swagger UI): `http://localhost:8000/docs`
- Alternative Docs (ReDoc): `http://localhost:8000/redoc`

---

## 🔒 How Tenant Isolation Works

1. **Onboarding a Tenant**:
   Call `POST /api/v1/auth/register-tenant` with tenant details and the initial admin user. This returns an access token stamped with the `tenant_id`.

2. **Issuing Tokens**:
   When logging in via `POST /api/v1/auth/login`, the issued JWT contains:
   ```json
   {
     "sub": "1",
     "tenant_id": "1",
     "role": "admin",
     "exp": 1740672000
   }
   ```

3. **Enforcing Isolation in Endpoints**:
   Add `tenant: Tenant = Depends(get_current_tenant)` or `context: TenantContext = Depends(get_tenant_context)` to your endpoint dependencies:
   ```python
   @router.get("/items")
   async def list_items(
       tenant: Tenant = Depends(get_current_tenant),
       db: AsyncSession = Depends(get_db)
   ):
       # Data is strictly scoped to the active tenant
       stmt = select(Item).where(Item.tenant_id == tenant.id)
       result = await db.execute(stmt)
       return result.scalars().all()
   ```

---

## 🧪 Running Tests

```bash
pytest
```
