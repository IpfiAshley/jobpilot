import httpx

from jobpilot.core.config import Settings
from jobpilot.jobs.base import JobListing
from jobpilot.jobs.normalize import parse_datetime


class JobicySource:
    """Public, keyless remote-jobs feed. Keep Jobicy's listing URL for attribution."""

    name = "jobicy"
    endpoint = "https://jobicy.com/api/v2/remote-jobs"
    max_pages = 25

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.client = client or httpx.Client(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent, "Accept": "application/json"},
        )
        self._owns_client = client is None

    def fetch(self) -> list[JobListing]:
        output: list[JobListing] = []
        cursor: str | None = None
        for _ in range(self.max_pages):
            params: dict[str, str | int] = {"count": 200}
            if cursor:
                params["cursor"] = cursor
            response = self.client.get(self.endpoint, params=params)
            response.raise_for_status()
            payload = response.json()
            if payload.get("success") is False:
                raise RuntimeError("Jobicy returned an unsuccessful feed response")
            output.extend(self._convert(item) for item in payload.get("jobs", []))
            cursor = payload.get("nextCursor")
            if not cursor:
                break
        return output

    @staticmethod
    def _convert(item: dict) -> JobListing:
        geo = str(item.get("jobGeo") or "Anywhere")
        geo_lower = geo.lower()
        eligible_in_za = any(term in geo_lower for term in ("south africa", "africa", "anywhere"))
        job_types = item.get("jobType") or []
        industries = item.get("jobIndustry") or []
        return JobListing(
            source="jobicy",
            source_id=str(item.get("id")) if item.get("id") is not None else None,
            title=str(item.get("jobTitle") or ""),
            company=str(item.get("companyName") or "Unknown"),
            location=geo,
            country_code="ZA" if "south africa" in geo_lower else None,
            is_remote=True,
            remote_scope="global",
            eligibility="south_africa" if eligible_in_za else "eligibility_unverified",
            employment_type=", ".join(str(value) for value in job_types) or None,
            description=str(item.get("jobExcerpt") or item.get("jobDescription") or ""),
            tags=[str(value) for value in industries],
            salary_min=_number(item.get("salaryMin")),
            salary_max=_number(item.get("salaryMax")),
            salary_currency=item.get("salaryCurrency"),
            url=str(item.get("url") or ""),
            published_at=parse_datetime(item.get("pubDate")),
        )

    def close(self) -> None:
        if self._owns_client:
            self.client.close()


def _number(value: object) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None

