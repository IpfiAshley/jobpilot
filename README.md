# JobPilot — South African & Remote Job Search

JobPilot aggregates available job listings from documented public APIs and operator-configured RSS feeds, with CV matching, application tracking, optional AI tailoring, cover-letter drafting, and DOCX/PDF export. Source coverage depends on each provider's data and access rules. The service does not scrape login-gated sites such as LinkedIn or bypass site controls.

## Architecture

```text
GitHub Actions (daily) ──> protected Render ingestion endpoint ──> source adapters
                                                                  ├─ Adzuna ZA API (all sectors; API credentials needed)
                                                                  ├─ Jobicy public remote jobs API
                                                                  ├─ Remote OK public remote jobs feed
                                                                  └─ configured RSS feeds
                                                               │
                                                               v
                                                     normalize + deduplicate
                                                               │
                                                               v
                                                     SQLAlchemy repository
                                                       SQLite / PostgreSQL

CV PDF/DOCX ──> parser ──> structured profile ──> TF-IDF / cosine matcher
                                                   └─ score + missing terms
```

### Folder structure

```text
.
├── .env.example
├── .github/workflows/daily-ingestion.yml
├── Dockerfile
├── README.md
├── pyproject.toml
├── src/jobpilot/
│   ├── __init__.py
│   ├── main.py
│   ├── ai/tailoring.py
│   ├── core/config.py
│   ├── cv/{export,matcher,parser}.py
│   ├── db/session.py
│   ├── models/job.py
│   ├── schemas.py
│   ├── jobs/{__init__,base,normalize,service,providers/{__init__,adzuna,remoteok,rss}}.py
│   └── web/{index.html,styles.css,app.js}
└── scripts/run_ingestion.py
```

## Run locally

Python 3.11–3.13 is recommended. Create a virtual environment, install with `pip install -e .`, copy `.env.example` to `.env`, and set the API credentials / RSS URLs you have permission to use. The SQLite database defaults to `./data/jobpilot.db` and is created on first run.

Run `python scripts/run_ingestion.py` for one ingestion pass, or `uvicorn jobpilot.main:app --reload` for the API and dashboard at `http://localhost:8000`. The GitHub Actions workflow calls the protected Render ingestion endpoint daily at 04:15 UTC and can also be run manually. Add `INGESTION_TOKEN` on Render and the matching `JOBPILOT_INGESTION_TOKEN` GitHub Actions secret. Add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` to Render to enable broad South African listings from Adzuna. Configure `RSS_FEED_URLS` for additional permitted feeds.

### CV matching library

```python
from jobpilot.cv.parser import parse_cv
from jobpilot.cv.matcher import match_cv_to_job

profile = parse_cv("/path/to/cv.pdf")  # also supports .docx
result = match_cv_to_job(profile, "Python, PostgreSQL, AWS, ETL pipelines")
```

The parser is heuristic; review extracted profile data before relying on it. CV files are parsed in memory and are not persisted by this module. Match scores are ranking signals, not hiring outcomes.

### Phase 2 dashboard, tailoring, and exports

The dashboard reads jobs from the API, parses a PDF/DOCX CV in memory, shows match scores and missing terms, and stores application stages in browser `localStorage`. It does not persist CV profile data. Application stages stay in the current browser and are not synced.

Set `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` to enable tailoring through an OpenAI-compatible Chat Completions endpoint. The browser shows a disclosure before sending the extracted profile and job description to that provider. The app does not save CV files or parsed profile data. The prompt bans the requested clichés, limits skills to the candidate's extracted skills, and requires source indices for rewritten bullets. The response validator rejects new numeric claims and banned words. AI output still requires human review before use.

Available endpoints include `POST /api/v1/cv/parse`, `POST /api/v1/cv/match`, `POST /api/v1/cv/tailor`, and `POST /api/v1/cv/export` (`format` is `pdf` or `docx`). The dashboard includes a local application board with Saved, Tailored, Applied, Interviewing, and Offer stages.

### Hosted preview

`render.yaml` defines the Render Docker web service and `/health` check. The current preview uses a temporary free Render Postgres database and has no Adzuna credentials configured yet. Free Render Postgres expires 30 days after creation. Do not upload a real CV to a public preview; configure access controls before using personal data.

## Data source / coverage notes

- Adzuna is queried for South Africa through its official API. Configure a valid key and observe current API terms and rate limits. Without credentials, local South African listings will be limited.
- Remote OK and Jobicy provide public remote feeds. Jobicy's public feed contains recent listings and should be linked to its original listing URL. These feeds do not prove that every employer accepts South African applicants; listings are labeled `eligibility_unverified` unless region evidence is present. Confirm eligibility before applying.
- RSS feeds can be configured in `RSS_FEED_URLS` for sources whose feed terms allow ingestion.
- OfferZen, PNet, CareerJunction, and LinkedIn are not scraped in this phase. Use their official APIs/feeds or written authorization before adding adapters.

## Production deployment notes

Use PostgreSQL in deployment, configure secrets outside source control, run ingestion as a single scheduled worker, and add monitoring/alerting and retention policies. This is a Phase 1/2 foundation, not a multi-user production deployment: add authentication, authorization, account isolation, operational monitoring, and a retention/privacy review before exposing it to users. The upload endpoint enforces an 8 MB file limit and does not persist uploaded CVs.

