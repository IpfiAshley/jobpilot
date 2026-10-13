from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    title: str
    company: str
    location: str
    country_code: str | None
    is_remote: bool
    remote_scope: str | None
    eligibility: str
    employment_type: str | None
    description: str
    tags: list[str]
    salary_min: float | None
    salary_max: float | None
    salary_currency: str | None
    url: str
    published_at: datetime | None
