import logging

from jobpilot.core.config import get_settings
from jobpilot.db.session import SessionLocal, create_schema
from jobpilot.jobs.service import configured_sources, ingest_sources


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    create_schema()
    sources = configured_sources(settings)
    with SessionLocal() as db:
        summary = ingest_sources(db, sources)
    logging.getLogger(__name__).info(
        "Ingestion complete fetched=%d inserted=%d updated=%d skipped=%d source_errors=%s",
        summary.fetched, summary.inserted, summary.updated, summary.skipped, summary.source_errors,
    )
    return 1 if summary.source_errors and len(summary.source_errors) == len(sources) else 0


if __name__ == "__main__":
    raise SystemExit(main())
