from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timezone
import base64
import hashlib
import hmac
import re
import secrets
import threading
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from jobpilot.core.config import get_settings
from jobpilot.db.session import SessionLocal
from jobpilot.models.account import TrackedApplication, User
from jobpilot.models.job import Job

router = APIRouter()
SESSION_COOKIE = "jobpilot_session"
SESSION_SECONDS = 60 * 60 * 24 * 14
APPLICATION_STAGES = {"Saved", "Tailored", "Applied", "Interviewing", "Offer"}
_PBKDF2_ROUNDS = 600_000
_attempts: dict[str, deque[float]] = defaultdict(deque)
_attempts_lock = threading.Lock()


class SignupPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=128)
    consent: bool


class LoginPayload(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class ApplicationPayload(BaseModel):
    job_id: int
    stage: str = "Saved"


class DeleteAccountPayload(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def _secret() -> bytes:
    value = get_settings().auth_secret_key
    if not value:
        raise HTTPException(status_code=503, detail="Account sign-in is not configured yet")
    return value.encode("utf-8")


def _validate_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("host", request.url.netloc)
    if not hmac.compare_digest(origin.rstrip("/"), f"{scheme}://{host}".rstrip("/")):
        raise HTTPException(status_code=403, detail="Request origin was not allowed")


def _throttle(key: str, maximum: int, window_seconds: int) -> None:
    now = time.monotonic()
    with _attempts_lock:
        queue = _attempts[key]
        while queue and now - queue[0] > window_seconds:
            queue.popleft()
        if len(queue) >= maximum:
            raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")
        queue.append(now)


def _clear_attempts(key: str) -> None:
    with _attempts_lock:
        _attempts.pop(key, None)


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    salt_text = base64.urlsafe_b64encode(salt).decode()
    digest_text = base64.urlsafe_b64encode(digest).decode()
    return "pbkdf2_sha256$%d$%s$%s" % (_PBKDF2_ROUNDS, salt_text, digest_text)


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds_text, salt_text, expected_text = encoded.split("$", 3)
        rounds = int(rounds_text)
        if algorithm != "pbkdf2_sha256" or not 100_000 <= rounds <= 1_000_000:
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(expected_text.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _session_token(user_id: int) -> str:
    payload = f"{user_id}:{int(time.time()) + SESSION_SECONDS}".encode()
    encoded = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    signature = hmac.new(_secret(), encoded.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def _session_user(request: Request) -> User | None:
    token = request.cookies.get(SESSION_COOKIE, "")
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(_secret(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
        user_id_text, expiry_text = payload.split(":", 1)
        if int(expiry_text) <= int(time.time()):
            return None
        user_id = int(user_id_text)
    except (ValueError, UnicodeDecodeError, HTTPException):
        return None
    with SessionLocal() as db:
        return db.get(User, user_id)


def _require_user(request: Request) -> User:
    user = _session_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to use your saved account data")
    return user


def _set_session(response: Response, user: User) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        _session_token(user.id),
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=settings.app_env.casefold() not in {"development", "local", "test"},
        samesite="lax",
        path="/",
    )


def _public_user(user: User) -> dict[str, object]:
    return {"id": user.id, "email": user.email, "name": user.name}


def _normalized_email(value: str) -> str:
    email = value.strip().casefold()
    if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return email


def _client_key(request: Request) -> str:
    client = request.client.host if request.client else "unknown"
    return hashlib.sha256(client.encode()).hexdigest()


@router.post("/api/v1/auth/signup")
def signup(payload: SignupPayload, request: Request, response: Response) -> dict[str, object]:
    _validate_origin(request)
    _secret()
    if not payload.consent:
        raise HTTPException(status_code=422, detail="Please accept the account data notice")
    email = _normalized_email(payload.email)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Enter your name")
    _throttle(f"signup:{_client_key(request)}", 5, 3600)
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == email)) is not None:
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        user = User(email=email, name=name, password_hash=_hash_password(payload.password))
        db.add(user)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="An account with this email already exists") from exc
        db.refresh(user)
        _set_session(response, user)
        return {"user": _public_user(user)}


@router.post("/api/v1/auth/login")
def login(payload: LoginPayload, request: Request, response: Response) -> dict[str, object]:
    _validate_origin(request)
    _secret()
    email = _normalized_email(payload.email)
    rate_key = f"login:{_client_key(request)}:{email}"
    _throttle(rate_key, 10, 900)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None or not _verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Email or password is incorrect")
        _clear_attempts(rate_key)
        _set_session(response, user)
        return {"user": _public_user(user)}


@router.get("/api/v1/auth/me")
def current_account(request: Request) -> dict[str, object]:
    user = _session_user(request)
    return {"user": _public_user(user) if user else None}


@router.post("/api/v1/auth/logout")
def logout(request: Request, response: Response) -> dict[str, str]:
    _validate_origin(request)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    return {"status": "signed_out"}


@router.delete("/api/v1/auth/account")
def delete_account(payload: DeleteAccountPayload, request: Request, response: Response) -> dict[str, str]:
    _validate_origin(request)
    user = _require_user(request)
    with SessionLocal() as db:
        stored = db.get(User, user.id)
        if stored is None or not _verify_password(payload.password, stored.password_hash):
            raise HTTPException(status_code=401, detail="Password is incorrect")
        db.execute(delete(TrackedApplication).where(TrackedApplication.user_id == user.id))
        db.delete(stored)
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    return {"status": "account_deleted"}


@router.get("/api/v1/applications")
def list_applications(request: Request) -> dict[str, dict[str, object]]:
    user = _require_user(request)
    with SessionLocal() as db:
        rows = db.scalars(
            select(TrackedApplication).where(TrackedApplication.user_id == user.id)
        ).all()
        return {str(row.job_id): {"stage": row.stage, "job": row.job_data} for row in rows}


@router.post("/api/v1/applications")
def save_application(payload: ApplicationPayload, request: Request) -> dict[str, str]:
    _validate_origin(request)
    if payload.stage not in APPLICATION_STAGES:
        raise HTTPException(status_code=422, detail="Choose a valid application stage")
    user = _require_user(request)
    with SessionLocal() as db:
        job = db.get(Job, payload.job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        tracked = db.scalar(
            select(TrackedApplication).where(
                TrackedApplication.user_id == user.id,
                TrackedApplication.job_id == payload.job_id,
            )
        )
        snapshot = {
            "id": job.id,
            "title": job.title,
            "company": job.company,
            "location": job.location,
            "url": job.url,
            "is_remote": job.is_remote,
            "eligibility": job.eligibility,
        }
        if tracked is None:
            tracked = TrackedApplication(
                user_id=user.id, job_id=job.id, stage=payload.stage, job_data=snapshot
            )
            db.add(tracked)
        else:
            tracked.stage = payload.stage
            tracked.job_data = snapshot
            tracked.updated_at = datetime.now(timezone.utc)
        db.commit()
    return {"status": "saved"}


@router.patch("/api/v1/applications/{job_id}")
def update_application(job_id: int, payload: ApplicationPayload, request: Request) -> dict[str, str]:
    _validate_origin(request)
    if payload.job_id != job_id or payload.stage not in APPLICATION_STAGES:
        raise HTTPException(status_code=422, detail="Choose a valid application stage")
    user = _require_user(request)
    with SessionLocal() as db:
        tracked = db.scalar(
            select(TrackedApplication).where(
                TrackedApplication.user_id == user.id,
                TrackedApplication.job_id == job_id,
            )
        )
        if tracked is None:
            raise HTTPException(status_code=404, detail="Saved application not found")
        tracked.stage = payload.stage
        tracked.updated_at = datetime.now(timezone.utc)
        db.commit()
    return {"status": "updated"}


@router.delete("/api/v1/applications/{job_id}")
def remove_application(job_id: int, request: Request) -> dict[str, str]:
    _validate_origin(request)
    user = _require_user(request)
    with SessionLocal() as db:
        tracked = db.scalar(
            select(TrackedApplication).where(
                TrackedApplication.user_id == user.id,
                TrackedApplication.job_id == job_id,
            )
        )
        if tracked is not None:
            db.delete(tracked)
            db.commit()
    return {"status": "removed"}
