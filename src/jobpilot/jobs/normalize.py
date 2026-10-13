import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from jobpilot.jobs.base import JobListing

TRACKING_PARAMS = {"fbclid", "gclid", "ref", "source", "utm_campaign", "utm_medium", "utm_source"}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", BeautifulSoup(value, "html.parser").get_text(" ")).strip()


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query) if k.lower() not in TRACKING_PARAMS]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), urlencode(query), ""))


def fingerprint(listing: JobListing) -> str:
    identity = canonical_url(listing.url) or "|".join(
        (listing.title.casefold(), listing.company.casefold(), listing.location.casefold())
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def normalize_listing(listing: JobListing) -> JobListing:
    listing.title = clean_text(listing.title)[:300] or "Untitled role"
    listing.company = clean_text(listing.company)[:300] or "Unknown"
    listing.location = clean_text(listing.location)[:300] or "Unspecified"
    listing.description = clean_text(listing.description)
    listing.url = canonical_url(listing.url)
    listing.tags = sorted({clean_text(tag) for tag in listing.tags if clean_text(tag)})
    return listing
