import logging

import httpx

from jobpilot.core.config import Settings
from jobpilot.jobs.base import JobListing
from jobpilot.jobs.normalize import parse_datetime

logger = logging.getLogger(__name__)
class AdzunaSource:
    name = "adzuna_za"
    endpoint = "https://api.adzuna.com/v1/api/jobs/za/search/{page}"

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.settings = settings
        self.client = client or httpx.Client(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent, "Accept": "application/json"},
        )
        self._owns_client = client is None

    def fetch(self) -> list[JobListing]:
        if not self.settings.adzuna_app_id or not self.settings.adzuna_app_key:
            logger.info("Skipping Adzuna: API credentials are not configured")
            return []
        output: list[JobListing] = []
        for page in range(1, max(1, self.settings.adzuna_max_pages) + 1):
            response = self.client.get(
                self.endpoint.format(page=page),
                params={
                    "app_id": self.settings.adzuna_app_id,
                    "app_key": self.settings.adzuna_app_key,
                    "results_per_page": min(max(self.settings.adzuna_results_per_query, 1), 50),
                    "content-type": "application/json",
                },
            )
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results", [])
            if not results:
                break
            output.extend(self._convert(item) for item in results)
        return output

    def _convert(self, item: dict) -> JobListing:
        location_data = item.get("location") or {}
        location = ", ".join(location_data.get("display_name", "South Africa").split(",")[:3])
        description = item.get("description", "")
        remote = any(word in (location + " " + description).lower() for word in ("remote", "work from home"))
        salary_min, salary_max = item.get("salary_min"), item.get("salary_max")
        return JobListing(
            source=self.name,
            source_id=str(item.get("id")) if item.get("id") is not None else None,
            title=item.get("title", ""),
            company=(item.get("company") or {}).get("display_name", "Unknown"),
            location=location,
            country_code="ZA",
            is_remote=remote,
            remote_scope="south_africa" if remote else None,
            eligibility="south_africa" if remote else "local",
            employment_type=item.get("contract_type"),
            description=description,
            salary_min=float(salary_min) if salary_min is not None else None,
            salary_max=float(salary_max) if salary_max is not None else None,
            salary_currency="ZAR" if salary_min is not None or salary_max is not None else None,
            url=item.get("redirect_url", ""),
            published_at=parse_datetime(item.get("created")),
        )

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

