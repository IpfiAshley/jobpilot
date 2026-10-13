from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from jobpilot.db.session import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_jobs_fingerprint"),
        Index("ix_jobs_location_remote", "location", "is_remote"),
        Index("ix_jobs_published_at", "published_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    source_id: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    company: Mapped[str] = mapped_column(String(300), nullable=False, default="Unknown")
    location: Mapped[str] = mapped_column(String(300), nullable=False, default="Unspecified")
    country_code: Mapped[str | None] = mapped_column(String(2))
    is_remote: Mapped[bool] = mapped_column(default=False, nullable=False)
    remote_scope: Mapped[str | None] = mapped_column(String(40))
    eligibility: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    employment_type: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    salary_min: Mapped[float | None] = mapped_column()
    salary_max: Mapped[float | None] = mapped_column()
    salary_currency: Mapped[str | None] = mapped_column(String(3))
    url: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
