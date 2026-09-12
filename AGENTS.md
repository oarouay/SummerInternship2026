# Workspace Engineering Standards & Agent Guidelines

This repository is governed by ECC (Everything Coding Companion) engineering standards. All coding agents operating in this workspace must adhere to the following principles:

## 1. Test-Driven Development (TDD)
- Always write failing tests first (**RED**) before writing functional code.
- Implement the minimal code required to pass (**GREEN**).
- Refactor for cleanliness, typing, and readability (**REFACTOR**).
- Maintain minimum 80% test coverage across backend endpoints, services, and models.

## 2. Multi-Tenant Row-Level Isolation
- Every database query, insert, update, or delete on tenant-scoped data MUST filter by `tenant_id`.
- Derive `tenant_id` securely from the authenticated token context (`get_current_tenant`), never directly from untrusted request bodies or query params.
- Storage files and vector embeddings must be strictly partitioned by tenant ID (`storage/{tenant_id}/...`).

## 3. Architecture & Separation of Concerns
- **Routers** (`app/api/v1/endpoints/`): Handle HTTP parameters, dependency injection, and Pydantic response formatting. Keep handlers thin.
- **Services** (`app/services/`): Contain domain logic, business calculations, vector search, and transactional database operations.
- **Models** (`app/models/`): Declarative SQLAlchemy models with explicit types, foreign keys, and indexes on `tenant_id`.
- **Schemas** (`app/schemas/`): Strict Pydantic v2 schemas for request validation and response serialization.

## 4. Verification & Clean Code
- Run linting and automated tests before committing any changes.
- Never hardcode secrets, API keys, or JWT secrets in source code.
- Clean up dead code, unused imports, and temporary debug prints before marking tasks complete.

## 5. Available Custom Workflows & Skills
- `/plan`: Architecture & phased implementation blueprinting.
- `/code-review`: Fresh-context quality, security, and regression audit.
- `/build-fix`: Systematic root-cause error diagnosis and minimal fixes.
- `/fastapi-review`: Audit FastAPI routes, dependencies, and async SQLAlchemy sessions.
- `/security-scan`: OWASP Top 10, Auth/RBAC, and tenant boundary verification.
- `tdd-workflow`: Red -> Green -> Refactor cycle enforcement.
- `security-review`: Comprehensive security checklist.
- `verification-loop`: Automated lint, typecheck, and test runner.
- `cost-aware-llm-pipeline`: Token optimization, batching, and chunk caching.
