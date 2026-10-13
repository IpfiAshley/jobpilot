from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from jobpilot.ai.tailoring import TailoringError, TailoringService
from jobpilot.core.config import get_settings
from jobpilot.cv.export import export_docx, export_pdf
from jobpilot.cv.matcher import match_cv_to_job
from jobpilot.cv.parser import CVParseError, parse_cv
from jobpilot.db.session import SessionLocal, create_schema
from jobpilot.models.job import Job
from jobpilot.schemas import JobRead
from jobpilot.schemas_cv import ExportRequest, MatchRequest, TailorRequest

WEB_DIR = Path(__file__).parent / "web"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_schema()
    yield


app = FastAPI(title="JobPilot API", version="0.2.0", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=WEB_DIR), name="assets")


@app.get("/", include_in_schema=False)
def dashboard() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/jobs", response_model=list[JobRead])
def list_jobs(
    q: str | None = Query(default=None, max_length=120),
    location: str | None = Query(default=None, max_length=120),
    remote: bool | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[JobRead]:
    with SessionLocal() as db:
        statement = select(Job).order_by(Job.published_at.desc().nullslast(), Job.first_seen_at.desc())
        if q:
            statement = statement.where(Job.title.ilike(f"%{q}%") | Job.description.ilike(f"%{q}%"))
        if location:
            statement = statement.where(Job.location.ilike(f"%{location}%"))
        if remote is not None:
            statement = statement.where(Job.is_remote.is_(remote))
        rows = db.scalars(statement.offset(offset).limit(limit)).all()
        return [JobRead.model_validate(row) for row in rows]


@app.get("/api/v1/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: int) -> JobRead:
    with SessionLocal() as db:
        row = db.get(Job, job_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return JobRead.model_validate(row)


@app.post("/api/v1/cv/parse")
async def parse_uploaded_cv(file: UploadFile = File(...)) -> dict:
    filename = (file.filename or "").lower()
    suffix = Path(filename).suffix
    if suffix not in {".pdf", ".docx"}:
        await file.close()
        raise HTTPException(status_code=415, detail="Upload a PDF or DOCX file")
    content = await file.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        await file.close()
        raise HTTPException(status_code=413, detail="CV file exceeds the 8 MB limit")
    try:
        with NamedTemporaryFile(suffix=suffix) as temporary:
            temporary.write(content)
            temporary.flush()
            profile = parse_cv(temporary.name)
    except CVParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()
    return profile


@app.post("/api/v1/cv/match")
def match_cv(request: MatchRequest) -> dict:
    return match_cv_to_job(request.profile, request.job_description, job_title=request.job_title)


@app.post("/api/v1/cv/tailor")
def tailor_cv(request: TailorRequest) -> dict:
    try:
        return TailoringService(get_settings()).tailor(
            request.profile,
            {"title": request.job_title, "company": request.company, "description": request.job_description},
        )
    except TailoringError as exc:
        status = 503 if "not configured" in str(exc).lower() else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/api/v1/cv/export")
def export_tailored_cv(request: ExportRequest) -> Response:
    if request.format == "docx":
        body = export_docx(request.profile, request.tailored)
        media_type, extension = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
    else:
        body = export_pdf(request.profile, request.tailored)
        media_type, extension = "application/pdf", "pdf"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="tailored-cv.{extension}"'},
    )
