import logging

import feedparser
import httpx

from jobpilot.core.config import Settings
from jobpilot.jobs.base import JobListing
from jobpilot.jobs.normalize import parse_datetime

logger = logging.getLogger(__name__)


class RSSSource:
    name = "configured_rss"

    def __init__(self, settings: Settings, urls: list[str], client: httpx.Client | None = None):
        self.urls = urls
        self.client = client or httpx.Client(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
        )
        self._owns_client = client is None

    def fetch(self) -> list[JobListing]:
        output: list[JobListing] = []
        for url in self.urls:
            response = self.client.get(url)
            response.raise_for_status()
            feed = feedparser.parse(response.content)
            source = feed.feed.get("title", self.name)[:80]
            for entry in feed.entries:
                title = entry.get("title", "")
                tags = [tag.get("term", "") for tag in entry.get("tags", [])]
                content = entry.get("summary", "")
                if not _is_tech(title + " " + content + " " + " ".join(tags)):
                    continue
                published = entry.get("published") or entry.get("updated")
                output.append(
                    JobListing(
                        source=source,
                        source_id=entry.get("id"),
                        title=title,
                        company=entry.get("author", "Unknown"),
                        location=entry.get("location", "Unspecified"),
                        is_remote="remote" in (title + content).lower(),
                        remote_scope="global" if "remote" in (title + content).lower() else None,
                        eligibility="eligibility_unverified",
                        description=content,
                        tags=tags,
                        url=entry.get("link", ""),
                        published_at=parse_datetime(published),
                    )
                )
        return output

    def close(self) -> None:
        if self._owns_client:
            self.client.close()


def _is_tech(text: str) -> bool:
    text = text.lower()
    return any(term in text for term in ("software", "developer", "engineer", "data", "cloud", "security", "devops", "bi "))
