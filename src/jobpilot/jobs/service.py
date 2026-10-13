import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from jobpilot.core.config import Settings
from jobpilot.jobs.base import JobListing, JobSource
from jobpilot.jobs.normalize import fingerprint, normalize_listing
from jobpilot.jobs.providers.adzuna import AdzunaSource
from jobpilot.jobs.providers.jobicy import JobicySource
from jobpilot.jobs.providers.remoteok import RemoteOKSource
from jobpilot.jobs.providers.rss import RSSSource
from jobpilot.models.job import Job, utc_now

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class IngestionSummary:
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    source_errors: dict[str, str] | None = None


def configured_sources(settings: Settings) -> list[JobSource]:
    return [
        AdzunaSource(settings),
        JobicySource(settings),
        RemoteOKSource(settings),
        RSSSource(settings, settings.rss_urls),
    ]


def ingest_sources(db: Session, sources: list[JobSource]) -> IngestionSummary:
    summary = IngestionSummary(source_errors={})
    now = utc_now()
    processed_fingerprints: set[str] = set()
    for source in sources:
        try:
            listings = source.fetch()
            summary.fetched += len(listings)
            for raw in listings:
                listing = normalize_listing(raw)
                if not listing.url or not listing.title:
                    summary.skipped += 1
                    continue
                key = fingerprint(listing)
                # Search queries and feeds commonly overlap within a single fetch.
                # Avoid queuing the same new row twice while autoflush is disabled.
                if key in processed_fingerprints:
                    summary.skipped += 1
                    continue
                processed_fingerprints.add(key)
                job = db.scalar(select(Job).where(Job.fingerprint == key))
                if job is None:
                    db.add(_to_model(listing, key, now))
                    summary.inserted += 1
                else:
                    _refresh(job, listing, now)
                    summary.updated += 1
            db.commit()
        except Exception as exc:  # isolate source failures so the rest of the pipeline can run
            db.rollback()
            source_name = getattr(source, "name", source.__class__.__name__)
            summary.source_errors[source_name] = str(exc)[:500]
            logger.exception("Job source %s failed", source_name)
        finally:
            close = getattr(source, "close", None)
            if close:
                close()
    return summary


def _to_model(item: JobListing, key: str, now) -> Job:
    return Job(
        fingerprint=key, source=item.source, source_id=item.source_id, title=item.title,
        company=item.company, location=item.location, country_code=item.country_code,
        is_remote=item.is_remote, remote_scope=item.remote_scope, eligibility=item.eligibility,
        employment_type=item.employment_type, description=item.description, tags=item.tags,
        salary_min=item.salary_min, salary_max=item.salary_max, salary_currency=item.salary_currency,
        url=item.url, published_at=item.published_at, first_seen_at=now, last_seen_at=now,
    )


def _refresh(job: Job, item: JobListing, now) -> None:
    for attr in (
        "source_id", "title", "company", "location", "country_code", "is_remote", "remote_scope",
        "eligibility", "employment_type", "description", "tags", "salary_min", "salary_max",
        "salary_currency", "url", "published_at",
    ):
        value = getattr(item, attr)
        if value not in (None, "", []):
            setattr(job, attr, value)
    job.last_seen_at = now
    job.updated_at = now

