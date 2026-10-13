import logging

import httpx

from jobpilot.core.config import Settings
from jobpilot.jobs.base import JobListing
from jobpilot.jobs.normalize import parse_datetime

logger = logging.getLogger(__name__)


class RemoteOKSource:
    name = "remoteok"
    endpoint = "https://remoteok.com/api"

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.client = client or httpx.Client(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent, "Accept": "application/json"},
        )
        self._owns_client = client is None

    def fetch(self) -> list[JobListing]:
        response = self.client.get(self.endpoint)
        response.raise_for_status()
        payload = response.json()
        output: list[JobListing] = []
        for item in payload:
            if not isinstance(item, dict) or not item.get("id"):
                continue  # first feed element is attribution metadata
            tags = item.get("tags") or []
            title = item.get("position", "")
            if not _is_tech(title, tags):
                continue
            location = item.get("location") or "Worldwide"
            location_l = location.lower()
            region_evidence = any(term in location_l for term in ("south africa", "africa", "worldwide", "anywhere"))
            output.append(
                JobListing(
                    source=self.name,
                    source_id=str(item["id"]),
                    title=title,
                    company=item.get("company", "Unknown"),
                    location=location,
                    country_code="ZA" if "south africa" in location_l else None,
                    is_remote=True,
                    remote_scope="global",
                    eligibility="south_africa" if region_evidence else "eligibility_unverified",
                    description=item.get("description", ""),
                    tags=[str(tag) for tag in tags],
                    salary_min=_salary(item.get("salary_min")),
                    salary_max=_salary(item.get("salary_max")),
                    salary_currency=item.get("salary_currency"),
                    url=item.get("url") or item.get("apply_url") or "",
                    published_at=parse_datetime(item.get("date")),
                )
            )
        return output

    def close(self) -> None:
        if self._owns_client:
            self.client.close()


def _salary(value: object) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _is_tech(title: str, tags: list[object]) -> bool:
    text = " ".join([title, *(str(tag) for tag in tags)]).lower()
    return any(term in text for term in (
        "software", "developer", "engineer", "data", "business intelligence", "analyst",
        "cloud", "devops", "security", "cyber", "database", "machine learning", "ai",
    ))
