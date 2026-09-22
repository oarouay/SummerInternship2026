import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
import app.services.pipeline as pipeline_mod

# In-memory SQLite with StaticPool so all sessions share the in-memory database
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True
)

TestSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)


@pytest_asyncio.fixture(scope="function")
async def db_session():
    """Create a clean database session for each test."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestSessionLocal() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


from app.services.graph import InMemoryGraphStore
import app.services.graph as graph_mod
import app.api.v1.endpoints.graph as endpoints_graph_mod
import app.services.synthesis as synthesis_mod


@pytest.fixture(autouse=True)
def isolate_graph_store(monkeypatch):
    """Ensure all test API routes, pipeline tasks, and synthesis use an isolated in-memory graph store."""
    test_graph_store = InMemoryGraphStore()
    async def mock_get_graph_store():
        return test_graph_store

    monkeypatch.setattr(graph_mod, "get_graph_store", mock_get_graph_store)
    monkeypatch.setattr(pipeline_mod, "get_graph_store", mock_get_graph_store)
    monkeypatch.setattr(endpoints_graph_mod, "get_graph_store", mock_get_graph_store)
    monkeypatch.setattr(synthesis_mod, "get_graph_store", mock_get_graph_store)
    return test_graph_store


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession):
    """FastAPI test client with database override and pipeline background task session override."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    # Patch background pipeline session factory to use in-memory test database
    orig_factory = pipeline_mod.AsyncSessionLocal
    pipeline_mod.AsyncSessionLocal = TestSessionLocal

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    pipeline_mod.AsyncSessionLocal = orig_factory
