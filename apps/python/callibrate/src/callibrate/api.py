"""The web surface: a public directory, a curator console, and the verification API.

One thing here is worth reading twice. A verification is a phone call, so it
takes minutes, not milliseconds. `POST /api/verifications` therefore returns a
job id immediately and runs the call in the background, and the browser follows
`GET /api/verifications/{task_id}` while the phone rings.

The job registry is a progress display and nothing more. Every fact it reports
is already in the database before the browser is told about it: the call
reservation, the CALL-E run id, the evidence, the verdict and the ledger entry.
If this process dies mid-call, nothing is lost that mattered.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from callibrate.calling.mcp import CalleAuthRequired, CalleError, finish_broker_login, start_broker_login
from callibrate.calling.models import CallError
from callibrate.calling.pilot import PILOT_SCRIPTS, PilotLineCaller
from callibrate.config import Settings, verify_password
from callibrate.contracts.models import TriggerType
from callibrate.domain import (
    ConsentRequest,
    DecisionRequest,
    FailureReportRequest,
    HSDSImportRequest,
    IntakeSearch,
    LoginRequest,
    ReferralAcceptRequest,
    VerifyNowRequest,
)
from callibrate.privacy import redact_pii
from callibrate.store import Store
from callibrate.verification import ContractError, VerificationWorkflow
from callibrate.verification.queue import request_verification
from callibrate.verification.triggers import fields_for_failure, message_for_failure

COOKIE_NAME = "callibrate_session"
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
VERSION = "1.0.0"


# --------------------------------------------------------------------------- #
# Background verification jobs
# --------------------------------------------------------------------------- #


@dataclass
class Job:
    """What the browser is shown while a phone call happens."""

    task_id: str
    service_id: str
    state: str = "requested"
    detail: str = "Verification requested"
    caller: str = ""
    call_id: str = ""
    started_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat(timespec="seconds"))
    result: dict[str, Any] | None = None
    error: str = ""
    login_url: str = ""

    def as_json(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "service_id": self.service_id,
            "state": self.state,
            "detail": self.detail,
            "caller": self.caller,
            "call_id": self.call_id,
            "started_at": self.started_at,
            "result": self.result,
            "error": self.error,
            "login_url": self.login_url,
        }


class JobRegistry:
    """A bounded, in-process view of calls that are happening right now."""

    def __init__(self, maximum: int = 200):
        self.jobs: dict[str, Job] = {}
        self.order: deque[str] = deque()
        self.maximum = maximum

    def start(self, task_id: str, service_id: str, caller: str) -> Job:
        job = Job(task_id=task_id, service_id=service_id, caller=caller)
        self.jobs[task_id] = job
        self.order.append(task_id)
        while len(self.order) > self.maximum:
            self.jobs.pop(self.order.popleft(), None)
        return job

    def get(self, task_id: str) -> Job | None:
        return self.jobs.get(task_id)

    def running_for(self, service_id: str) -> Job | None:
        return next(
            (
                job
                for job in self.jobs.values()
                if job.service_id == service_id and job.state not in {"verified", "review", "failed", "refused"}
            ),
            None,
        )


class WindowLimiter:
    def __init__(self, maximum: int, window_seconds: int = 60):
        self.maximum = maximum
        self.window_seconds = window_seconds
        self.attempts: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if len(self.attempts) > 10_000:
            cutoff = now - self.window_seconds
            stale = [name for name, values in self.attempts.items() if not values or values[-1] < cutoff]
            for name in stale:
                self.attempts.pop(name, None)
        bucket = self.attempts[key]
        while bucket and bucket[0] < now - self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.maximum:
            return False
        bucket.append(now)
        return True


class RequestBodyLimitMiddleware:
    """Bound request bodies even when clients omit Content-Length."""

    def __init__(self, app, maximum: int = 10_000_000):
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            declared = self.maximum + 1
        if declared > self.maximum:
            await json_error("request body is too large", 413)(scope, receive, send)
            return
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.maximum:
                raise HTTPException(413, "request body is too large")
            return message

        await self.app(scope, limited_receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app, https_only: bool = False):
        self.app = app
        self.https_only = https_only

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.extend(
                    [
                        (
                            b"content-security-policy",
                            b"default-src 'self'; script-src 'self'; style-src 'self'; "
                            b"img-src 'self' data:; font-src 'self'; connect-src 'self'; "
                            b"frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
                        ),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"x-frame-options", b"DENY"),
                        (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                        (b"cross-origin-opener-policy", b"same-origin"),
                    ]
                )
                if scope.get("path", "").startswith("/api/"):
                    headers.append((b"cache-control", b"no-store"))
                if self.https_only:
                    headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
            await send(message)

        await self.app(scope, receive, send_with_headers)


def json_error(message: str, status: int, *, code: str | None = None) -> JSONResponse:
    return JSONResponse(
        {"error": {"message": message, "code": code or f"http_{status}"}}, status_code=status
    )


async def parse_model(request: Request, model, *, max_bytes: int = 256_000):
    try:
        content_length = int(request.headers.get("content-length", "0") or 0)
        if content_length > max_bytes:
            raise HTTPException(413, "request body is too large")
        body = await request.body()
        if len(body) > max_bytes:
            raise HTTPException(413, "request body is too large")
        return model.model_validate_json(body)
    except ValidationError as error:
        raise HTTPException(422, error.errors(include_url=False)) from error
    except ValueError as error:
        raise HTTPException(400, "invalid JSON body") from error


def token_hash(token: str, secret_key: str) -> str:
    return hmac.new(secret_key.encode(), token.encode(), hashlib.sha256).hexdigest()


def current_user(request: Request, *, role: str | None = None) -> dict[str, Any]:
    token = request.cookies.get(COOKIE_NAME, "")
    secret_key = request.app.state.settings.secret_key
    user = request.app.state.store.session_user(token_hash(token, secret_key)) if token else None
    if not user:
        raise HTTPException(401, "authentication required")
    if role == "curator" and user["role"] != "curator":
        raise HTTPException(403, "curator access required")
    if request.method in MUTATING_METHODS:
        supplied = request.headers.get("x-csrf-token", "")
        if not secrets.compare_digest(supplied, user["csrf_token"]):
            raise HTTPException(403, "invalid CSRF token")
    return user


# --------------------------------------------------------------------------- #
# Health, HSDS, auth
# --------------------------------------------------------------------------- #


async def health(request: Request) -> JSONResponse:
    try:
        with request.app.state.store.connect() as connection:
            connection.execute("SELECT 1").fetchone()
        return JSONResponse({"status": "ok", "service": "callibrate", "version": VERSION})
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)


async def hsds_root(request: Request) -> JSONResponse:
    base = request.app.state.settings.public_base_url.rstrip("/")
    return JSONResponse(
        {
            "version": "3.2",
            "profile": f"{base}/hsds/profile",
            "openapi_url": "https://raw.githubusercontent.com/openreferral/specification/3.2/schema/openapi.json",
        }
    )


async def hsds_profile(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "name": "Callibrate HSDS 3.2 profile",
            "description": "Community service records with the date and evidence of their last phone verification.",
            "schema_version": "3.2",
        }
    )


async def hsds_services(request: Request) -> JSONResponse:
    records = request.app.state.store.hsds_services()
    return JSONResponse({"contents": records, "total_items": len(records)})


async def hsds_service(request: Request) -> JSONResponse:
    records = request.app.state.store.hsds_services(request.path_params["service_id"])
    if not records:
        raise HTTPException(404, "service not found")
    return JSONResponse(records[0])


async def login(request: Request) -> JSONResponse:
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.login_limiter.allow(ip):
        return json_error("too many login attempts; try again shortly", 429, code="rate_limited")
    payload = await parse_model(request, LoginRequest)
    user = request.app.state.store.user_by_username(payload.username)
    valid = user and await run_in_threadpool(verify_password, payload.password, user["password_hash"])
    if not valid:
        return json_error("invalid username or password", 401, code="invalid_credentials")
    raw_token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    settings = request.app.state.settings
    request.app.state.store.create_session(
        user["id"], token_hash(raw_token, settings.secret_key), csrf, settings.session_hours
    )
    response = JSONResponse(
        {
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"],
                "role": user["role"],
            },
            "csrf_token": csrf,
        }
    )
    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.https_only,
        samesite="strict",
        path="/",
    )
    return response


async def logout(request: Request) -> Response:
    current_user(request)
    raw = request.cookies.get(COOKIE_NAME, "")
    settings = request.app.state.settings
    request.app.state.store.delete_session(token_hash(raw, settings.secret_key))
    response = Response(status_code=204)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


async def me(request: Request) -> JSONResponse:
    user = current_user(request)
    return JSONResponse(
        {
            "user": {key: user[key] for key in ("id", "username", "display_name", "role")},
            "csrf_token": user["csrf_token"],
        }
    )


# --------------------------------------------------------------------------- #
# Console reads
# --------------------------------------------------------------------------- #


async def dashboard(request: Request) -> JSONResponse:
    current_user(request)
    return JSONResponse(request.app.state.store.dashboard())


async def services(request: Request) -> JSONResponse:
    current_user(request)
    query = request.query_params.get("q", "")[:120]
    return JSONResponse({"services": request.app.state.store.list_services(query)})


async def tasks(request: Request) -> JSONResponse:
    current_user(request)
    return JSONResponse({"tasks": request.app.state.store.list_tasks()})


async def decisions(request: Request) -> JSONResponse:
    current_user(request)
    return JSONResponse({"decisions": request.app.state.store.decisions()})


async def ledger(request: Request) -> JSONResponse:
    current_user(request)
    store = request.app.state.store
    return JSONResponse(
        {
            "events": store.audit_events(),
            "chain_valid": store.verify_audit_chain(),
            "first_break": store.audit_chain_break(),
        }
    )


async def metrics(request: Request) -> JSONResponse:
    current_user(request)
    return JSONResponse(request.app.state.store.call_metrics())


async def run_detail(request: Request) -> JSONResponse:
    current_user(request)
    run = request.app.state.store.run_detail(request.path_params["run_id"])
    if not run:
        raise HTTPException(404, "verification run not found")
    return JSONResponse(run)


async def task_run(request: Request) -> JSONResponse:
    """The most recent verification of one record, whole.

    A curator opening a record that was verified an hour ago should see the call
    that verified it, not an empty panel: the transcript, the evidence, the
    verdict and the diff, exactly as the person who ran it saw them.
    """
    current_user(request)
    run = request.app.state.store.latest_run_for_task(request.path_params["task_id"])
    if not run:
        raise HTTPException(404, "no verification has been recorded for that task")
    authority = ["REFRESH", "APPLY", "REVIEW", "STOP"][int(run["tier"])]
    applied = [
        {"field": change["field_name"], "old": change["old_value"], "new": change["new_value"]}
        for change in run["changes"]
        if change["status"] == "applied"
    ]
    return JSONResponse(
        {
            "run_id": run["id"],
            "tier": run["tier"],
            "authority": authority,
            "status": run["status"],
            "outcome": run["outcome"],
            "caller": run["caller"],
            "call_id": run["call_id"],
            "applied": applied,
            "unresolved": run["evidence"].get("unresolved_questions", []),
            "decisions": run["decisions"],
            "evidence": run["evidence"],
            "contract": run["contract"],
        }
    )


async def contract_preview(request: Request) -> JSONResponse:
    """What CALL-E will be told, before anybody agrees to place the call."""
    current_user(request)
    try:
        return JSONResponse(request.app.state.workflow.preview(request.path_params["task_id"]))
    except KeyError as error:
        raise HTTPException(404, str(error)) from error
    except ContractError as error:
        raise HTTPException(409, str(error)) from error


async def refresh_queue(request: Request) -> JSONResponse:
    user = current_user(request, role="curator")
    return JSONResponse(request.app.state.store.refresh_queue(user["id"]))


async def import_directory(request: Request) -> JSONResponse:
    user = current_user(request, role="curator")
    payload = await parse_model(request, HSDSImportRequest, max_bytes=10_000_000)
    try:
        result = await run_in_threadpool(
            request.app.state.store.import_hsds_services, payload.services, user["id"]
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return JSONResponse(result, status_code=201)


async def create_consent(request: Request) -> JSONResponse:
    user = current_user(request, role="curator")
    payload = await parse_model(request, ConsentRequest)
    try:
        result = request.app.state.store.create_consent(payload, user["id"])
    except KeyError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return JSONResponse(result, status_code=201)


async def resolve_decision(request: Request) -> JSONResponse:
    user = current_user(request, role="curator")
    payload = await parse_model(request, DecisionRequest)
    try:
        result = request.app.state.store.resolve_decision(
            request.path_params["proposal_id"],
            payload.action,
            user["id"],
            payload.edited_value,
            payload.note,
        )
    except KeyError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return JSONResponse(result)


# --------------------------------------------------------------------------- #
# Verification
# --------------------------------------------------------------------------- #


async def _run_verification(app, job: Job, pilot_scenario: str | None, trigger_message: str) -> None:
    """Drive one verification to completion and keep the job's state in step."""
    workflow: VerificationWorkflow = app.state.workflow
    try:
        job.state = "calling"
        job.detail = (
            "CALL-E is planning and placing the call"
            if app.state.settings.live_calling
            else "The pilot line is replaying a scripted conversation"
        )
        result = await workflow.run(
            job.task_id, pilot_scenario=pilot_scenario, trigger_message=trigger_message
        )
        job.call_id = str(result.get("call_id") or "")
        job.state = "review" if result["status"] == "needs_review" else "verified"
        job.detail = {
            "APPLY": "The record was corrected and the change is in the ledger",
            "REFRESH": "The provider confirmed the record; nothing changed",
            "REVIEW": "A person has to decide this one",
            "STOP": "The call was stopped and this number will not be called again",
        }.get(result["authority"], "Verification complete")
        job.result = result
    except CalleAuthRequired as error:
        job.state = "failed"
        job.error = str(error)
        job.detail = "CALL-E is not authorised on this deployment"
        job.login_url = getattr(error, "login_url", "")
    except (CallError, ContractError, ValueError, KeyError) as error:
        job.state = "refused" if isinstance(error, ValueError) else "failed"
        job.error = str(error)
        job.detail = (
            "The call was refused before anything was dialled"
            if job.state == "refused"
            else "The call could not be completed; the record is unchanged"
        )
    except Exception:  # pragma: no cover - defensive
        app.state.logger.exception("verification job failed")
        job.state = "failed"
        job.error = "an unexpected error occurred"
        job.detail = "The call could not be completed; the record is unchanged"


async def start_verification(request: Request) -> JSONResponse:
    """Curator console: run the verification at the top of the queue card."""
    current_user(request, role="curator")
    task_id = request.path_params["task_id"]
    store: Store = request.app.state.store
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    registry: JobRegistry = request.app.state.jobs
    running = registry.get(task_id)
    if running and running.state in {"requested", "calling"}:
        return JSONResponse(running.as_json(), status_code=202)

    body = {}
    if await request.body():
        try:
            body = await request.json()
        except ValueError:
            body = {}
    scenario = str(body.get("scenario") or "") or None
    if scenario and scenario not in PILOT_SCRIPTS:
        raise HTTPException(422, "unknown pilot scenario")

    job = registry.start(
        task_id, task["service_id"], "call-e" if request.app.state.settings.live_calling else "pilot-line"
    )
    asyncio.create_task(_run_verification(request.app, job, scenario, ""))
    return JSONResponse(job.as_json(), status_code=202)


async def verification_status(request: Request) -> JSONResponse:
    """Follow one verification. Public, because the public can start one."""
    task_id = request.path_params["task_id"]
    job = request.app.state.jobs.get(task_id)
    if not job:
        raise HTTPException(404, "no verification is running for that task")
    return JSONResponse(job.as_json())


async def verify_now(request: Request) -> JSONResponse:
    """"Verify before I go": a visitor asks for a record to be checked, now.

    This is the shortest path in the product from a person's doubt to a phone
    ringing. It is rate limited, it creates exactly one task per record, and it
    goes through the same eligibility gate as everything else.
    """
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.verify_limiter.allow(ip):
        return json_error("too many verification requests; try again shortly", 429, code="rate_limited")
    payload = await parse_model(request, VerifyNowRequest)
    store: Store = request.app.state.store
    service = store.service(payload.service_id)
    if not service:
        raise HTTPException(404, "service not found")

    registry: JobRegistry = request.app.state.jobs
    running = registry.running_for(payload.service_id)
    if running:
        return JSONResponse(running.as_json(), status_code=202)

    try:
        task_id, created = request_verification(
            store,
            payload.service_id,
            fields=list(payload.fields),
            trigger=TriggerType.MANUAL_REQUEST,
            note=redact_pii(payload.note),
            actor="public",
        )
    except KeyError as error:
        raise HTTPException(404, str(error)) from error

    job = registry.start(
        task_id, payload.service_id, "call-e" if request.app.state.settings.live_calling else "pilot-line"
    )
    job.detail = "Verification requested" if created else "Joining the verification already queued"
    asyncio.create_task(
        _run_verification(
            request.app, job, None, "Somebody is about to travel to this service and asked us to check."
        )
    )
    return JSONResponse(job.as_json(), status_code=202)


# --------------------------------------------------------------------------- #
# Public directory
# --------------------------------------------------------------------------- #


async def intake_search(request: Request) -> JSONResponse:
    payload = await parse_model(request, IntakeSearch)
    results = request.app.state.store.search_referrals(
        payload.need, payload.postal_code, payload.limit
    )
    return JSONResponse(
        {"results": results, "disclaimer": "Availability can change. Verify before you travel."}
    )


async def public_service(request: Request) -> JSONResponse:
    service = request.app.state.store.service(request.path_params["service_id"])
    if not service:
        raise HTTPException(404, "service not found")
    job = request.app.state.jobs.running_for(service["id"])
    return JSONResponse({"service": service, "verification": job.as_json() if job else None})


async def accept_referral(request: Request) -> JSONResponse:
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.public_limiter.allow(ip):
        return json_error("too many referrals; try again shortly", 429, code="rate_limited")
    payload = await parse_model(request, ReferralAcceptRequest)
    store: Store = request.app.state.store
    service = store.service(payload.service_id)
    if not service:
        raise HTTPException(404, "service not found")
    if service["status"] != "active":
        raise HTTPException(409, "service is not currently active")
    try:
        referral_id = store.record_referral(
            payload.service_id, redact_pii(payload.need), payload.postal_code
        )
    except KeyError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return JSONResponse({"referral_id": referral_id}, status_code=201)


async def report_failure(request: Request) -> JSONResponse:
    """A report of a wasted trip becomes a call in the same transaction."""
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.public_limiter.allow(ip):
        return json_error("too many reports; try again shortly", 429, code="rate_limited")
    payload = await parse_model(request, FailureReportRequest)
    store: Store = request.app.state.store
    try:
        report_id, task_id = store.report_failure(
            payload.service_id, payload.reason, redact_pii(payload.details), payload.referral_id
        )
    except KeyError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return JSONResponse(
        {
            "report_id": report_id,
            "verification_task_id": task_id,
            "fields": fields_for_failure(payload.reason),
            "trigger_message": message_for_failure(payload.reason, payload.details),
        },
        status_code=201,
    )


# --------------------------------------------------------------------------- #
# CALL-E account state
# --------------------------------------------------------------------------- #


async def calle_status(request: Request) -> JSONResponse:
    current_user(request)
    workflow: VerificationWorkflow = request.app.state.workflow
    settings: Settings = request.app.state.settings
    auth = workflow.calle_auth()
    return JSONResponse(
        {
            **auth.status(),
            "caller_mode": settings.caller_mode,
            "live_calling": settings.live_calling,
            "allowlisted_numbers": len(settings.allowlist),
        }
    )


async def calle_login_start(request: Request) -> JSONResponse:
    """Begin CALL-E's brokered browser login and hand back the URL."""
    current_user(request, role="curator")
    workflow: VerificationWorkflow = request.app.state.workflow
    try:
        pending = await start_broker_login(workflow.calle_auth())
    except CalleError as error:
        raise HTTPException(502, str(error)) from error
    except Exception as error:
        raise HTTPException(502, "CALL-E login could not be started") from error
    request.app.state.calle_pending = pending
    return JSONResponse({"login_url": pending["login_url"], "status": pending["status"]})


async def calle_login_finish(request: Request) -> JSONResponse:
    current_user(request, role="curator")
    pending = getattr(request.app.state, "calle_pending", None)
    if not pending:
        raise HTTPException(409, "no CALL-E login has been started")
    workflow: VerificationWorkflow = request.app.state.workflow
    try:
        result = await finish_broker_login(workflow.calle_auth(), pending, deadline_seconds=30.0)
    except CalleError as error:
        raise HTTPException(409, str(error)) from error
    request.app.state.calle_pending = None
    return JSONResponse(result)


async def system_info(request: Request) -> JSONResponse:
    current_user(request)
    settings: Settings = request.app.state.settings
    store: Store = request.app.state.store
    return JSONResponse(
        {
            "name": "Callibrate",
            "version": VERSION,
            "caller_mode": settings.caller_mode,
            "live_calling": settings.live_calling,
            # The count, never the numbers. An allowlist is an access control,
            # not a directory.
            "allowlisted_numbers": len(settings.allowlist),
            "directory_name": settings.directory_name,
            "demonstration_directory": settings.bootstrap_sample_data,
            "pilot_scenarios": PilotLineCaller.scenarios(),
            "ledger_intact": store.verify_audit_chain(),
        }
    )


async def index(request: Request) -> FileResponse:
    return FileResponse(request.app.state.web_dir / "index.html")


async def http_exception(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "request validation failed"
    return JSONResponse(
        {
            "error": {
                "message": detail,
                "details": exc.detail if not isinstance(exc.detail, str) else None,
            }
        },
        status_code=exc.status_code,
    )


async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    request.app.state.logger.exception("Unhandled request error", exc_info=exc)
    return json_error("an unexpected error occurred", 500)


def create_app(settings: Settings | None = None, store: Store | None = None) -> Starlette:
    settings = settings or Settings()
    store = store or Store(settings.database_path)
    web_dir = Path(__file__).parent / "web"

    @asynccontextmanager
    async def lifespan(app: Starlette):
        store.initialize()
        store.seed_demo(settings)
        yield

    middleware = [
        Middleware(SecurityHeadersMiddleware, https_only=settings.https_only),
        Middleware(RequestBodyLimitMiddleware),
        Middleware(TrustedHostMiddleware, allowed_hosts=settings.host_list),
        Middleware(GZipMiddleware, minimum_size=800),
    ]
    if settings.https_only:
        middleware.append(Middleware(HTTPSRedirectMiddleware))

    routes = [
        Route("/health", health),
        Route("/hsds", hsds_root),
        Route("/hsds/profile", hsds_profile),
        Route("/hsds/services", hsds_services),
        Route("/hsds/services/{service_id:str}", hsds_service),
        Route("/api/auth/login", login, methods=["POST"]),
        Route("/api/auth/logout", logout, methods=["POST"]),
        Route("/api/auth/me", me),
        Route("/api/dashboard", dashboard),
        Route("/api/services", services),
        Route("/api/tasks", tasks),
        Route("/api/tasks/{task_id:str}/contract", contract_preview),
        Route("/api/tasks/{task_id:str}/run", task_run),
        Route("/api/tasks/{task_id:str}/verify", start_verification, methods=["POST"]),
        Route("/api/verifications/{task_id:str}", verification_status),
        Route("/api/verify-now", verify_now, methods=["POST"]),
        Route("/api/runs/{run_id:str}", run_detail),
        Route("/api/decisions", decisions),
        Route("/api/decisions/{proposal_id:str}", resolve_decision, methods=["POST"]),
        Route("/api/ledger", ledger),
        Route("/api/metrics", metrics),
        Route("/api/system", system_info),
        Route("/api/calle/status", calle_status),
        Route("/api/calle/login", calle_login_start, methods=["POST"]),
        Route("/api/calle/login/finish", calle_login_finish, methods=["POST"]),
        Route("/api/queue/refresh", refresh_queue, methods=["POST"]),
        Route("/api/directory/import", import_directory, methods=["POST"]),
        Route("/api/consents", create_consent, methods=["POST"]),
        Route("/api/directory/search", intake_search, methods=["POST"]),
        Route("/api/directory/services/{service_id:str}", public_service),
        Route("/api/directory/referrals", accept_referral, methods=["POST"]),
        Route("/api/directory/reports", report_failure, methods=["POST"]),
        Mount("/assets", app=StaticFiles(directory=web_dir), name="assets"),
        Route("/{path:path}", index),
    ]

    app = Starlette(
        routes=routes,
        middleware=middleware,
        lifespan=lifespan,
        exception_handlers={HTTPException: http_exception, Exception: unhandled_exception},
    )
    app.state.settings = settings
    app.state.store = store
    app.state.workflow = VerificationWorkflow(store, settings)
    app.state.jobs = JobRegistry()
    app.state.login_limiter = WindowLimiter(settings.login_attempts_per_minute)
    app.state.public_limiter = WindowLimiter(20)
    app.state.verify_limiter = WindowLimiter(6)
    app.state.calle_pending = None
    app.state.web_dir = web_dir
    app.state.logger = logging.getLogger("callibrate.api")
    return app


app = create_app()
