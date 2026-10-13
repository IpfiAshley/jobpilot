from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from jobpilot.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _engine_url() -> str:
    url = get_settings().database_url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("sqlite:///") and ":memory:" not in url:
        path = Path(url.removeprefix("sqlite:///"))
        path.parent.mkdir(parents=True, exist_ok=True)
    return url


engine = create_engine(
    _engine_url(),
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if _engine_url().startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_schema() -> None:
    from jobpilot.models.job import Job  # noqa: F401

    Base.metadata.create_all(bind=engine)

