from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class JobListing:
    source: str
    title: str
    company: str
    location: str
    url: str
    description: str = ""
    source_id: str | None = None
    country_code: str | None = None
    is_remote: bool = False
    remote_scope: str | None = None
    eligibility: str = "unknown"
    employment_type: str | None = None
    tags: list[str] = field(default_factory=list)
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    published_at: datetime | None = None


class JobSource(Protocol):
    name: str

    def fetch(self) -> list[JobListing]: ...
