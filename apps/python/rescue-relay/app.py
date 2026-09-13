"""Rescue Relay v5.6.0 — clarify, ask, compare, approve, call back, track.

Single-process FastAPI + SQLite. Approved saved contacts are the only destination
source. No browser operator lock and no environment-variable number allowlist.
Live configurations are local-only; public demos use fictional data/mock calls.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import secrets
import sqlite3
import uuid
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)
# Import after dotenv: Uvicorn and run.py behave identically.
from rescue_intent import goal_problem
from conditional_plan import gate_states
from goal_dialogue import GoalClarification
from coordinator import Coordinator, PlannerUnavailable, build_coverage, CAPABILITY_LABELS, demo_capabilities, kind, contact_supports, scope_issue
import calling
from plan_options import build_plan_options
from contact_candidates import candidate_inventory
from call_activity import build_call_activity
from offer_followup import conditional_candidates
from callback_recovery import candidate as callback_candidate, practice_contact
from pricing import DEFAULT_CURRENCY, CostQuote, check_callback_price

DB_PATH = Path(os.getenv("DATABASE_PATH", str(ROOT / "data" / "rescue_relay.db")))
CALL_MODE = os.getenv("CALL_MODE", "mock").strip().lower()
ENABLE_LIVE_CALLS = os.getenv("ENABLE_LIVE_CALLS", "false").lower() == "true"
CALLE_API_KEY = os.getenv("CALLE_API_KEY", "").strip()
APP_ENV = os.getenv("APP_ENV", "local").lower()
BASIC_AUTH_USERNAME = os.getenv("BASIC_AUTH_USERNAME", "").strip()
BASIC_AUTH_PASSWORD = os.getenv("BASIC_AUTH_PASSWORD", "")
if CALL_MODE not in {"mock", "live"}:
    raise ValueError("CALL_MODE must be mock or live")
MAX_CONTACTS = min(50, max(1, int(os.getenv("MAX_CONTACTS_PER_RUN", "12"))))
FICTIONAL_DEMO_NUMBERS = {"+12025550101", "+12025550102", "+12025550103"}
E164 = re.compile(r"^\+[1-9]\d{7,14}$")
ACTIVE_RUN_STATUSES = {"queued", "running", "starting"}
RUNNING_TASKS: set[asyncio.Task] = set()
planner = Coordinator()
logger = logging.getLogger("rescue_relay")


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    return db


def init_db() -> None:
    with closing(connect()) as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS businesses (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, description TEXT NOT NULL,
          consent_to_contact INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS incidents (
          id TEXT PRIMARY KEY, summary TEXT NOT NULL, location TEXT NOT NULL, reporter_name TEXT,
          status TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coordination_runs (
          id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), mode TEXT NOT NULL,
          status TEXT NOT NULL, plan_json TEXT, started_at TEXT NOT NULL, completed_at TEXT, approved_at TEXT);
        CREATE TABLE IF NOT EXISTS calls (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES coordination_runs(id),
          incident_id TEXT NOT NULL REFERENCES incidents(id), business_id TEXT NOT NULL REFERENCES businesses(id),
          status TEXT NOT NULL, provider_call_id TEXT, result_json TEXT, error TEXT,
          idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rescue_actions (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES coordination_runs(id),
          business_id TEXT NOT NULL REFERENCES businesses(id), business_name TEXT NOT NULL,
          contact_json TEXT NOT NULL, assignments_json TEXT NOT NULL, ordinal INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued', progress TEXT NOT NULL DEFAULT 'waiting',
          message_json TEXT, provider_call_id TEXT, provider_status TEXT, evidence_json TEXT,
          analysis_json TEXT, error TEXT, note TEXT, progress_log_json TEXT NOT NULL DEFAULT '[]',
          idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(run_id,business_id));
        CREATE TABLE IF NOT EXISTS provider_requests (
          idempotency_key TEXT PRIMARY KEY, owner_table TEXT NOT NULL, owner_id TEXT NOT NULL,
          request_json TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_runs_incident ON coordination_runs(incident_id, started_at);
        CREATE INDEX IF NOT EXISTS ix_calls_run ON calls(run_id, created_at);
        """)
        # Additive migration: original reports, contacts and historical calls survive.
        fields = {
            "incidents": {"expected_outcome": "TEXT NOT NULL DEFAULT ''", "animal_type": "TEXT NOT NULL DEFAULT ''",
                          "goal_confirmed": "INTEGER NOT NULL DEFAULT 0", "budget_amount": "REAL", "budget_currency": "TEXT NOT NULL DEFAULT 'USD'",
                          "conversation_json": "TEXT NOT NULL DEFAULT '[]'", "intake_json": "TEXT"},
            "businesses": {"capabilities_json": "TEXT NOT NULL DEFAULT '[]'",
                           "simulation_json": "TEXT NOT NULL DEFAULT '{}'", "simulated_only": "INTEGER NOT NULL DEFAULT 0"},
            "coordination_runs": {"scenario": "TEXT NOT NULL DEFAULT 'success'", "error": "TEXT",
                                  "definition_json": "TEXT", "events_json": "TEXT NOT NULL DEFAULT '[]'",
                                  "candidate_ids_json": "TEXT NOT NULL DEFAULT '[]'", "planner_json": "TEXT",
                                  "stop_reason": "TEXT", "cancel_requested": "INTEGER NOT NULL DEFAULT 0",
                                  "engine_version": "INTEGER NOT NULL DEFAULT 1", "execution_status": "TEXT NOT NULL DEFAULT 'not_started'",
                                  "decision_results_json": "TEXT NOT NULL DEFAULT '{}'",
                                  "selection_json": "TEXT NOT NULL DEFAULT '{}'", "comparison_round": "INTEGER NOT NULL DEFAULT 0", "approval_json": "TEXT"},
            "rescue_actions": {"provider_request_json": "TEXT", "provider_request_hash": "TEXT", "provider_error_json": "TEXT", "attempts_json": "TEXT NOT NULL DEFAULT '[]'",
                               "attempt_started_at": "TEXT", "recovery_request_json": "TEXT"},
            "calls": {"provider_request_json": "TEXT", "provider_request_hash": "TEXT", "provider_error_json": "TEXT", "business_name_snapshot": "TEXT", "business_description_snapshot": "TEXT",
                      "masked_phone_snapshot": "TEXT", "recipient_fingerprint": "TEXT", "provider_status": "TEXT", "analysis_json": "TEXT",
                      "evidence_json": "TEXT", "selection_reason": "TEXT", "target_needs_json": "TEXT",
                      "ordinal": "INTEGER NOT NULL DEFAULT 0"},
        }
        migrate_caps = "capabilities_json" not in {r["name"] for r in db.execute("PRAGMA table_info(businesses)")}
        for table, columns in fields.items():
            existing = {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}
            for name, declaration in columns.items():
                if name not in existing:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")
        for run in db.execute("SELECT id,incident_id,mode FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchall():
            message = ("Server restarted. No automatic redial. Check the recorded CALL-E call ID or idempotency key; a call may still be active."
                       if run["mode"] == "live" else "This run was interrupted by a restart. Nothing will restart automatically.")
            db.execute("UPDATE coordination_runs SET status='interrupted',error=?,completed_at=? WHERE id=?", (message, utc_now(), run["id"]))
            db.execute("UPDATE calls SET status='interrupted',error=?,updated_at=? WHERE run_id=? AND status IN ('queued','dialing','waiting','analyzing')", (message, utc_now(), run["id"]))
            db.execute("UPDATE incidents SET status='interrupted' WHERE id=?", (run["incident_id"],))
            db.execute("UPDATE rescue_actions SET status='interrupted',error=?,updated_at=? WHERE run_id=? AND status IN ('queued','contacting','analyzing')", (message, utc_now(), run["id"]))
            db.execute("UPDATE coordination_runs SET execution_status='interrupted' WHERE id=? AND execution_status='starting'", (run["id"],))
        db.execute("DROP INDEX IF EXISTS ux_active_run")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_active_run ON coordination_runs(incident_id) WHERE status IN ('queued','running','starting')")
        if not db.execute("SELECT 1 FROM businesses LIMIT 1").fetchone() and CALL_MODE != "live":
            seed_demo_businesses(db)
        # Migrate old fictional directory records without touching user descriptions.
        for row in db.execute("SELECT * FROM businesses").fetchall():
            if migrate_caps and not json.loads(row["capabilities_json"] or "[]"):
                caps = sorted(demo_capabilities(row["description"]))
                db.execute("UPDATE businesses SET capabilities_json=? WHERE id=?", (json.dumps(caps), row["id"]))
            if is_fictional_number(row["phone"]):
                db.execute("UPDATE businesses SET simulated_only=1 WHERE id=?", (row["id"],))
        db.commit()


def is_fictional_number(phone: str) -> bool:
    return bool(re.fullmatch(r"\+1\d{3}55501\d{2}", phone))


def seed_demo_businesses(db: sqlite3.Connection) -> None:
    now = utc_now()
    rows = [
        ("biz_paws", "Paws & Care", "+12025550101", "A veterinary receiving centre. The intake team can receive an animal for assessment and arrange arrival details with responders.", ["receiving_care"], 0),
        ("biz_street_team", "Street Animal Response", "+12025550102", "Trained volunteers with safe containment equipment, a vehicle and a transport driver.", ["safe_containment", "transport"], 18),
        ("biz_neighbor", "Neighborhood Support", "+12025550103", "A nearby volunteer who can watch the animal from a safe distance. Cannot handle or transport it.", ["scene_observation"], 6),
    ]
    for ident, name, phone, description, caps, eta in rows:
        profile = {"response": "agrees", "eta_minutes": eta, "conditions": "", "transcript": "", "start_response": "agrees", "start_transcript": ""}
        db.execute("""INSERT INTO businesses(id,name,phone,description,consent_to_contact,active,created_at,
                   capabilities_json,simulation_json,simulated_only) VALUES (?,?,?,?,1,1,?,?,?,1)""",
                   (ident, name, phone, description, now, json.dumps(caps), json.dumps(profile)))


def recipient_fingerprint(contact: dict) -> str:
    """Bind an agreement to the same saved recipient, not just a mutable ID."""
    return hashlib.sha256((contact["name"] + "\0" + contact["phone"]).encode()).hexdigest()


def mask_phone(phone: str) -> str:
    return "••••••" + phone[-4:]


def internal_business(row: Any) -> dict:
    result = dict(row)
    result["capabilities"] = json.loads(result.pop("capabilities_json", None) or "[]")
    result["simulation"] = json.loads(result.pop("simulation_json", None) or "{}")
    return result


def public_business(row: Any) -> dict:
    b = internal_business(row)
    phone = b.pop("phone")
    b["masked_phone"] = mask_phone(phone)
    b["consent_to_contact"] = bool(b["consent_to_contact"])
    b["active"] = bool(b["active"])
    b["simulated_only"] = bool(b.get("simulated_only")) or is_fictional_number(phone)
    b["demo_only"] = b["simulated_only"]  # old clients; not shown in the product
    if CALL_MODE == "live":
        b.pop("simulation", None)
    return b


class InputModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class SimulationProfile(InputModel):
    behavior: str = Field(default="", max_length=2400)
    allowed_animals: list[str] = Field(default_factory=list, max_length=12)
    quote_status: Literal["free", "fixed", "estimate", "unknown"] = "free"
    quote_amount: float | None = Field(default=None, ge=0, le=1_000_000_000, allow_inf_nan=False)
    quote_currency: str = Field(default=DEFAULT_CURRENCY, pattern=r"^[A-Z]{3}$")
    quote_scope: str = Field(default="All tasks offered in this call", max_length=600)
    quote_terms: str = Field(default="", max_length=600)
    start_quote_amount: float | None = Field(default=None, ge=0, le=1_000_000_000, allow_inf_nan=False)

    @field_validator("allowed_animals")
    @classmethod
    def clean_animals(cls, values):
        if any(not 2 <= len(v.strip()) <= 80 for v in values):
            raise ValueError("Each animal type must be 2–80 characters")
        return list(dict.fromkeys(v.strip().casefold() for v in values))

    @model_validator(mode="after")
    def valid_price(self):
        if self.quote_status in {"fixed", "estimate"} and self.quote_amount is None:
            raise ValueError("Enter an amount for a fixed quote or estimate")
        if self.quote_status == "free" and self.quote_amount not in {None, 0}:
            raise ValueError("A free offer cannot also have a non-zero price")
        return self

    response: Literal["agrees", "conditional", "declines", "no_answer"] = "agrees"
    eta_minutes: int | None = Field(default=18, ge=0, le=10080)
    conditions: str = Field(default="", max_length=600)
    transcript: str = Field(default="", max_length=16000)
    transcript_mode: Literal["auto", "opening", "exact"] = "auto"
    start_response: Literal["agrees", "conditional", "declines", "no_answer"] = "agrees"
    start_transcript: str = Field(default="", max_length=16000)
    start_transcript_mode: Literal["auto", "opening", "exact"] = "exact"


class BusinessCreate(InputModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, min_length=8, max_length=16)
    description: str = Field(default="", max_length=600)
    capabilities: list[str] = Field(default_factory=list, max_length=20)
    simulation: SimulationProfile = Field(default_factory=SimulationProfile)
    consent_to_contact: bool = False

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value):
        if value and not E164.fullmatch(value):
            raise ValueError("Use international format, for example +12025550123")
        return value or None

    @field_validator("capabilities")
    @classmethod
    def valid_capabilities(cls, values):
        result = []
        for value in values:
            value = value.strip()
            if not 2 <= len(value) <= 120:
                raise ValueError("Each ability must be 2–120 characters")
            if value.casefold() not in {v.casefold() for v in result}:
                result.append(value)
        return result


class BusinessUpdate(BusinessCreate):
    pass


class ChatMessage(InputModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=1200)


class IntakeDraft(InputModel):
    summary: str = Field(min_length=3, max_length=1200)
    location: str = Field(default="", max_length=250)
    expected_outcome: str = Field(default="", max_length=600)
    animal_type: str = Field(default="", max_length=100)


class IntakeRequest(InputModel):
    new_reply: bool = False
    goal_clarification: GoalClarification | None = None
    report: IntakeDraft
    messages: list[ChatMessage] = Field(default_factory=list, max_length=20)


class IncidentCreate(InputModel):
    summary: str = Field(min_length=10, max_length=1200)
    location: str = Field(min_length=3, max_length=250)
    reporter_name: str | None = Field(default=None, max_length=100)
    expected_outcome: str = Field(default="", max_length=600)
    animal_type: str = Field(default="", max_length=100)
    goal_confirmed: bool = False
    budget_amount: float | None = Field(default=None, ge=0, le=1_000_000_000, allow_inf_nan=False)
    budget_currency: str = Field(default=DEFAULT_CURRENCY, pattern=r"^[A-Z]{3}$")
    conversation: list[ChatMessage] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def confirmed_goal_is_present(self):
        if self.goal_confirmed and len(self.expected_outcome.strip()) < 8:
            raise ValueError("Review and enter a specific rescue goal before confirming it")
        if self.goal_confirmed and goal_problem(self.expected_outcome):
            raise ValueError(goal_problem(self.expected_outcome))
        return self


class CoordinateRequest(InputModel):
    # Optional legacy echo. It cannot override the server's environment.
    mode: Literal["mock", "live"] | None = None
    confirm_live: bool = False


class ContinueRequest(CoordinateRequest):
    plan_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    contact_id: str | None = Field(default=None, min_length=1, max_length=100)
    confirm_unmatched: bool = False


class FollowupRequest(CoordinateRequest):
    plan_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_call_id: str = Field(min_length=1, max_length=100)
    confirm_followup: bool = False
    practice_reply: Literal["saved", "agrees", "conditional", "declines", "no_answer"] = "saved"


class CallbackRecoveryRequest(CoordinateRequest):
    recovery_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirm_callback: bool = False
    practice_reply: Literal["saved", "agrees", "conditional", "declines", "no_answer"] = "saved"


class StartRequest(CoordinateRequest):
    practice_reply: Literal["saved", "agrees", "conditional", "declines", "no_answer"] = "saved"
    plan_token: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    confirm_costs: bool = False
    confirm_over_budget: bool = False


class SelectPlanRequest(InputModel):
    plan_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    assignments: dict[str, str] | None = Field(default=None, min_length=1, max_length=8)
    plan_id: str | None = Field(default=None, pattern=r"^plan_[a-f0-9]{20}$")


class DecisionUpdate(InputModel):
    plan_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    value: bool = Field(strict=True)
    confirmed_assessment: bool = Field(strict=True)
    note: str = Field(min_length=8, max_length=600)


class ProgressUpdate(InputModel):
    progress: Literal["on_the_way", "arrived", "finished"]
    note: str = Field(default="", max_length=600)


class CloseRescue(InputModel):
    confirmed_safe: bool
    note: str = Field(min_length=3, max_length=600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield
    tasks = tuple(RUNNING_TASKS)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    RUNNING_TASKS.clear()


app = FastAPI(title="Rescue Relay", version="5.6.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def valid_basic_authorization(header: str) -> bool:
    """Authenticate without logging or exposing the configured credentials."""
    scheme, separator, token = header.partition(" ")
    if not separator or scheme.lower() != "basic" or not token:
        return False
    try:
        decoded = base64.b64decode(token, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    username, separator, password = decoded.partition(":")
    if not separator:
        return False
    username_ok = secrets.compare_digest(username.encode(), BASIC_AUTH_USERNAME.encode())
    password_ok = secrets.compare_digest(password.encode(), BASIC_AUTH_PASSWORD.encode())
    return username_ok & password_ok


def auth_error(detail: str, status_code: int, *, challenge: bool = False) -> JSONResponse:
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if challenge:
        headers["WWW-Authenticate"] = 'Basic realm="Rescue Relay", charset="UTF-8"'
    return JSONResponse({"detail": detail}, status_code=status_code, headers=headers)


@app.middleware("http")
async def safe_local_runtime(request: Request, call_next):
    path = request.url.path
    auth_required = APP_ENV == "production"
    if path != "/health" and auth_required:
        if not BASIC_AUTH_USERNAME or not BASIC_AUTH_PASSWORD:
            return auth_error("Authentication is not configured.", 503)
        if not valid_basic_authorization(request.headers.get("authorization", "")):
            return auth_error("Authentication required.", 401, challenge=True)
    if path.startswith("/api/"):
        if CALL_MODE == "live":
            # No operator lock. This prototype is intentionally local-only in live
            # configuration. Do not tunnel or reverse-proxy it onto the public web.
            peer = request.client.host if request.client else ""
            if peer not in {"127.0.0.1", "::1"} or request.url.hostname not in {"127.0.0.1", "localhost", "::1"}:
                return JSONResponse({"detail": "Live configuration is local-only. Use mock mode for public demos."}, status_code=403)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "Cross-origin changes are not allowed."}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "Cross-site changes are not allowed."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "version": "5.6.0"}


@app.get("/api/config")
def config():
    return {"version": "5.6.0", "mode": CALL_MODE, "default_mode": CALL_MODE, "environment": APP_ENV,
            "live_ready": CALL_MODE == "live" and ENABLE_LIVE_CALLS and bool(CALLE_API_KEY),
            "live_configured": CALL_MODE == "live", "simulation_enabled": CALL_MODE == "mock",
            "planner": planner.info(), "max_contacts": MAX_CONTACTS, "default_currency": DEFAULT_CURRENCY,
            "capability_options": [{"id": key, "label": value} for key, value in CAPABILITY_LABELS.items()],
            "demo_reset_enabled": APP_ENV != "production" and CALL_MODE != "live"}


@app.get("/api/businesses")
def list_businesses():
    with closing(connect()) as db:
        return [public_business(r) for r in db.execute("SELECT * FROM businesses WHERE active=1 ORDER BY created_at,name")]


@app.post("/api/businesses", status_code=201)
def create_business(body: BusinessCreate):
    if CALL_MODE == "live" and "simulation" in body.model_fields_set:
        raise HTTPException(422, "Test replies cannot be configured for real calls.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        phone = body.phone
        if not phone:
            if CALL_MODE == "live":
                raise HTTPException(422, "A real contact needs an international phone number.")
            used = {r["phone"] for r in db.execute("SELECT phone FROM businesses WHERE active=1")}
            phone = next((f"+120255501{i:02d}" for i in range(100) if f"+120255501{i:02d}" not in used), None)
            if not phone:
                raise HTTPException(409, "No unused example numbers remain. Enter a number for this contact.")
        if db.execute("SELECT 1 FROM businesses WHERE phone=? AND active=1", (phone,)).fetchone():
            raise HTTPException(409, "That phone number already belongs to a saved contact.")
        ident = new_id("biz")
        db.execute("""INSERT INTO businesses(id,name,phone,description,consent_to_contact,active,created_at,
                     capabilities_json,simulation_json,simulated_only) VALUES (?,?,?,?,?,1,?,?,?,?)""",
                   (ident, body.name, phone, body.description, int(body.consent_to_contact), utc_now(),
                    json.dumps(body.capabilities), body.simulation.model_dump_json(), int(is_fictional_number(phone))))
        db.commit()
        return public_business(db.execute("SELECT * FROM businesses WHERE id=?", (ident,)).fetchone())


@app.patch("/api/businesses/{business_id}")
def edit_business(business_id: str, body: BusinessUpdate):
    if CALL_MODE == "live" and "simulation" in body.model_fields_set:
        raise HTTPException(422, "Test replies cannot be configured for real calls.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT * FROM businesses WHERE id=? AND active=1", (business_id,)).fetchone()
        if old is None:
            raise HTTPException(404, "Contact not found")
        if db.execute("SELECT 1 FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchone():
            raise HTTPException(409, "Finish or stop the current calls before editing contact details.")
        phone = body.phone or old["phone"]
        if db.execute("SELECT 1 FROM businesses WHERE phone=? AND active=1 AND id<>?", (phone, business_id)).fetchone():
            raise HTTPException(409, "That phone number already belongs to another contact.")
        caps = json.dumps(body.capabilities) if "capabilities" in body.model_fields_set else old["capabilities_json"]
        profile = body.simulation.model_dump_json() if "simulation" in body.model_fields_set else old["simulation_json"]
        db.execute("""UPDATE businesses SET name=?,phone=?,description=?,consent_to_contact=?,capabilities_json=?,
                     simulation_json=?,simulated_only=? WHERE id=?""",
                   (body.name, phone, body.description, int(body.consent_to_contact), caps, profile, int(is_fictional_number(phone)), business_id))
        db.commit()
        return public_business(db.execute("SELECT * FROM businesses WHERE id=?", (business_id,)).fetchone())


@app.delete("/api/businesses/{business_id}", status_code=204)
def archive_business(business_id: str):
    with closing(connect()) as db:
        changed = db.execute("UPDATE businesses SET active=0 WHERE id=? AND active=1", (business_id,)).rowcount
        db.commit()
        if not changed:
            raise HTTPException(404, "Contact not found")


@app.get("/api/incidents")
def list_incidents():
    with closing(connect()) as db:
        return [dict(r) for r in db.execute("""SELECT i.*,
           (SELECT id FROM coordination_runs r WHERE r.incident_id=i.id ORDER BY started_at DESC LIMIT 1) latest_run_id
           FROM incidents i ORDER BY created_at DESC""")]


@app.post("/api/intake/review")
async def review_intake(body: IntakeRequest):
    """Read-only inference. This route never creates a report, run or call."""
    try:
        with closing(connect()) as db:
            services = [{"capabilities": json.loads(r["capabilities_json"] or "[]"),
                         "description": r["description"]} for r in db.execute(
                "SELECT capabilities_json, description FROM businesses WHERE active=1 AND consent_to_contact=1 LIMIT 100")]
        return await planner.review_intake({**body.model_dump(), "responder_services": services})
    except PlannerUnavailable as exc:
        raise HTTPException(503, str(exc)) from None


@app.post("/api/incidents", status_code=201)
def create_incident(body: IncidentCreate):
    with closing(connect()) as db:
        ident = new_id("incident")
        db.execute("""INSERT INTO incidents(id,summary,location,reporter_name,status,created_at,expected_outcome,
                    animal_type,goal_confirmed,budget_amount,budget_currency,conversation_json)
                    VALUES (?,?,?,?,'new',?,?,?,?,?,?,?)""",
                   (ident, body.summary, body.location, body.reporter_name, utc_now(), body.expected_outcome,
                    body.animal_type, int(body.goal_confirmed), body.budget_amount, body.budget_currency,
                    json.dumps([m.model_dump() for m in body.conversation])))
        db.commit()
        return dict(db.execute("SELECT * FROM incidents WHERE id=?", (ident,)).fetchone())


@app.patch("/api/incidents/{incident_id}/intake")
def update_incident_intake(incident_id: str, body: IncidentCreate):
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM incidents WHERE id=?", (incident_id,)).fetchone():
            raise HTTPException(404, "Report not found")
        if db.execute("SELECT 1 FROM coordination_runs WHERE incident_id=?", (incident_id,)).fetchone():
            raise HTTPException(409, "A report with call history cannot be rewritten. Keep its evidence and create a new report for a changed situation.")
        db.execute("""UPDATE incidents SET summary=?,location=?,reporter_name=?,expected_outcome=?,animal_type=?,
                    goal_confirmed=?,budget_amount=?,budget_currency=?,conversation_json=? WHERE id=?""",
                   (body.summary, body.location, body.reporter_name, body.expected_outcome, body.animal_type,
                    int(body.goal_confirmed), body.budget_amount, body.budget_currency,
                    json.dumps([m.model_dump() for m in body.conversation]), incident_id))
        db.commit()
        return dict(db.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())


def calls_for_run(db: sqlite3.Connection, run_id: str) -> list[dict]:
    rows = db.execute("""SELECT c.*, COALESCE(c.business_name_snapshot,b.name) business_name
                          FROM calls c JOIN businesses b ON b.id=c.business_id
                          WHERE c.run_id=? ORDER BY c.ordinal,c.created_at,c.id""", (run_id,)).fetchall()
    output = []
    for row in rows:
        c = dict(row)
        c.pop("recipient_fingerprint", None)
        c.pop("provider_request_json", None)  # Private: includes full number and case facts.
        raw_error = c.pop("provider_error_json", None)
        c["provider_error"] = calling.public_provider_error(json.loads(raw_error)) if raw_error else None
        for column, key in [("analysis_json", "analysis"), ("evidence_json", "evidence"), ("target_needs_json", "target_needs"), ("result_json", "result")]:
            raw = c.pop(column, None)
            c[key] = json.loads(raw) if raw else None
        output.append(c)
    return output


def contact_availability(db, run, *, requirements=None, allowed_ids=None):
    contacts = [internal_business(row) for row in db.execute("SELECT * FROM businesses ORDER BY created_at,name")]
    if allowed_ids is not None:
        contacts = [c for c in contacts if c["id"] in allowed_ids]
    calls = [dict(row) for row in db.execute("SELECT * FROM calls WHERE run_id=?", (run["id"],))]
    return candidate_inventory(contacts, calls,
        requirements if requirements is not None else run["plan"]["requirements"],
        run["mode"], is_fictional=is_fictional_number)


def comparison_contacts(db, run):
    return [item["contact"] for item in contact_availability(db, run) if item["status"] == "eligible"]


def hydrate_run(db: sqlite3.Connection, row: Any) -> dict:
    run = dict(row)
    run["definition"] = json.loads(run.pop("definition_json") or "null")
    run["decision_results"] = json.loads(run.pop("decision_results_json", "{}") or "{}")
    run["events"] = json.loads(run.pop("events_json") or "[]")
    run["planner"] = json.loads(run.pop("planner_json") or "null")
    ids = json.loads(run.pop("candidate_ids_json") or "[]")
    run.pop("plan_json", None)
    run["calls"] = calls_for_run(db, run["id"])
    selected = json.loads(run.pop("selection_json", "{}") or "{}")
    incident = db.execute("SELECT budget_amount,budget_currency,expected_outcome,location FROM incidents WHERE id=?", (run["incident_id"],)).fetchone()
    run["report_snapshot"] = {"goal": incident["expected_outcome"], "location": incident["location"]}
    run["plan"] = build_coverage(run["definition"], run["calls"], selected,
                                  budget=incident["budget_amount"], currency=incident["budget_currency"],
                                  decision_results=run["decision_results"])
    options=build_plan_options(run["plan"])
    run["plan_options"]=options["options"]
    run["selected_plan_id"]=options["selected_plan_id"]
    run["plan_options_limited"]=options["options_limited"]
    run["plan_options_note"]=options["options_note"]
    run["scope_warning"]=scope_issue(incident["expected_outcome"],run["definition"])
    run["approval"] = json.loads(run.pop("approval_json", "null") or "null")
    token_data = {"run_id": run["id"], "round": run["comparison_round"], "definition": run["definition"],
                  "plan": run["plan"], "calls": [c["id"] for c in run["calls"]]}
    run["plan_token"] = hashlib.sha256(json.dumps(token_data, sort_keys=True).encode()).hexdigest()
    run["calls_made"] = len(run["calls"])
    called = {c["business_id"] for c in run["calls"]}
    run["uncalled_count"] = len(set(ids) - called)
    run["legacy"] = run["engine_version"] < 2
    run["actions"] = actions_for_run(db, run["id"])
    states = {n["id"]: n.get("gate_state", "initial") for n in run["plan"]["requirements"]}
    for action in run["actions"]:
        for assignment in action["assignments"]:
            assignment["gate_state"] = states.get(assignment["id"], "pending")
        task_states = [n["gate_state"] for n in action["assignments"]]
        action["not_required"] = bool(task_states) and all(s == "not_needed" for s in task_states)
        action["waiting_for_condition"] = bool(task_states) and not action["not_required"] and all(s in {"pending", "not_needed"} for s in task_states)
        action["has_pending_tasks"] = "pending" in task_states
    by_need = {n["id"]: n for n in run["plan"]["requirements"]}
    run["decision_options"] = []
    for decision in (run["definition"] or {}).get("decisions", []):
        need = by_need[decision["assessed_by"]]
        helper = next((a for a in run["actions"] if any(n["id"] == need["id"] for n in a["assignments"])), None)
        run["decision_options"].append({**decision, "result": run["decision_results"].get(decision["id"]),
            "assessor_name": helper["business_name"] if helper else "Not yet confirmed",
            "applicable": need.get("gate_state") != "not_needed",
            "can_record": bool(run["status"] == "active" and not run["scope_warning"]
                and helper and helper["status"] == "confirmed" and need.get("gate_state") in {"initial", "eligible"}
                and decision["id"] not in run["decision_results"] and run["mode"] == CALL_MODE)})
    run["activity"] = build_call_activity(run)
    inventory = contact_availability(db, run)
    run["contact_availability"] = [{k: v for k, v in item.items() if k != "contact"} for item in inventory]
    relevant = [i for i in inventory if i["status"] == "eligible"]
    unmatched = [i for i in inventory if i["status"] == "no_capability_match"]
    run["eligible_uncalled_count"] = len(relevant)
    run["unmatched_uncalled_count"] = len(unmatched)
    run["uncalled_count"] = len(relevant) + len(unmatched)
    run["can_check_unmatched"] = False
    run["continue_blocked_code"]=run["continue_blocked_reason"]=""
    blockers=[
        (bool(run["scope_warning"]),"scope_mismatch",run["scope_warning"]),
        (run["mode"]!=CALL_MODE,"mode_changed","This report belongs to a different call setting."),
        (run["execution_status"]!="not_started","already_started","This plan has already entered the callback stage."),
        (run["status"] in {"queued","running","starting"},"in_progress","An inquiry is still being processed. Review its result before continuing."),
        (run["status"] not in {"covered","partial","stopped"},"review_required","Review the uncertain result before further calls. There is no automatic redial."),
        (len(run["calls"])>=MAX_CONTACTS,"call_limit","This run reached its inquiry limit. Adding contacts does not reset the limit."),

        (bool(db.execute("SELECT 1 FROM coordination_runs WHERE id<>? AND status IN ('queued','running','starting')",(run["id"],)).fetchone()),"other_run_busy","Another report has an active call. Refresh after it finishes."),
    ]
    for blocked,code,reason in blockers:
        if blocked:
            run["continue_blocked_code"],run["continue_blocked_reason"]=code,reason
            break
    # Directory gaps are separate from processing/approval/safety blockers.
    if not run["continue_blocked_code"]:
        run["can_check_unmatched"] = bool(unmatched)
        if not relevant:
            if unmatched:
                run["continue_blocked_code"] = "no_capability_match"
                run["continue_blocked_reason"] = (f"{len(unmatched)} approved, uncalled contact(s) remain, but their saved capabilities do not match this rescue. "
                    "Review their abilities or explicitly ask one about suitability below.")
            else:
                run["continue_blocked_code"] = "no_contacts"
                run["continue_blocked_reason"] = "No uncalled, approved contacts are available. See contact availability for each exclusion reason, or add another approved contact."
    run["can_continue"]=not bool(run["continue_blocked_code"])
    run["followup_options"] = []
    if (not run["activity"]["uncertain"] and run["engine_version"] >= 3 and not run["actions"]
            and run["continue_blocked_code"] in {"", "no_contacts", "no_capability_match"}):
        for candidate in conditional_candidates(run):
            contact_row = db.execute("SELECT * FROM businesses WHERE id=?", (candidate["contact_id"],)).fetchone()
            prior = db.execute("SELECT recipient_fingerprint FROM calls WHERE id=?", (candidate["call_id"],)).fetchone()
            if not contact_row or not contact_row["active"] or not contact_row["consent_to_contact"]:
                continue
            contact = internal_business(contact_row)
            if not prior or prior["recipient_fingerprint"] != recipient_fingerprint(contact):
                continue
            if run["mode"] == "live" and (contact["simulated_only"] or is_fictional_number(contact["phone"])):
                continue
            run["followup_options"].append(candidate)
    run["callback_recovery"] = None
    recovery = callback_candidate(run, MAX_CONTACTS)
    if recovery and run["mode"] == CALL_MODE and not db.execute(
            "SELECT 1 FROM coordination_runs WHERE id<>? AND status IN ('queued','running','starting')", (run["id"],)).fetchone():
        saved = db.execute("SELECT * FROM businesses WHERE id=?", (recovery["contact_id"],)).fetchone()
        original = db.execute("SELECT contact_json FROM rescue_actions WHERE id=?", (recovery["action_id"],)).fetchone()
        if saved and saved["active"] and saved["consent_to_contact"]:
            contact = internal_business(saved)
            if (recipient_fingerprint(contact) == recipient_fingerprint(json.loads(original["contact_json"])) and
                    not (run["mode"] == "live" and (contact["simulated_only"] or is_fictional_number(contact["phone"])))):
                run["callback_recovery"] = recovery
    run["provider_recovery"] = provider_recovery_option(db, run)
    run["can_approve"]=bool(run["status"]=="covered" and run["selected_plan_id"] and not run["scope_warning"] and not run["actions"])
    return run


@app.get("/api/incidents/{incident_id}")
def get_incident(incident_id: str):
    with closing(connect()) as db:
        incident = db.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if incident is None:
            raise HTTPException(404, "Incident not found")
        run = db.execute("SELECT * FROM coordination_runs WHERE incident_id=? ORDER BY started_at DESC LIMIT 1", (incident_id,)).fetchone()
        return {**dict(incident), "latest_run": hydrate_run(db, run) if run else None}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    with closing(connect()) as db:
        run = db.execute("SELECT * FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            raise HTTPException(404, "Rescue run not found")
        return hydrate_run(db, run)


def validate_live_request(body: CoordinateRequest):
    if body.mode is not None and body.mode != CALL_MODE:
        raise HTTPException(422, "Call mode is configured in .env, not per request.")
    if CALL_MODE != "live":
        return
    if not ENABLE_LIVE_CALLS or not CALLE_API_KEY:
        raise HTTPException(409, "Real calling is disabled or its CALL-E key is missing.")
    if not body.confirm_live:
        raise HTTPException(422, "Confirm calls to your approved contacts before starting.")
    # The same model-first, evidence-only backup applies to live transcripts too.


@app.post("/api/incidents/{incident_id}/coordinate", status_code=202)
async def coordinate(incident_id: str, body: CoordinateRequest):
    validate_live_request(body)
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        incident_row = db.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if incident_row is None:
            raise HTTPException(404, "Incident not found")
        if not incident_row["goal_confirmed"] or len(incident_row["expected_outcome"].strip()) < 8:
            raise HTTPException(422, "Clarify and confirm what rescue means for this report before calling anyone. Open the report form and review its goal.")
        if goal_problem(incident_row["expected_outcome"]):
            raise HTTPException(422, goal_problem(incident_row["expected_outcome"]))
        # One active cascade on this single-user prototype. Avoid accidental overlap.
        if db.execute("SELECT 1 FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchone():
            raise HTTPException(409, "A rescue is already running. Stop it or let it finish before starting another.")
        if CALL_MODE == "live" and db.execute("SELECT 1 FROM coordination_runs WHERE incident_id=? AND mode='live'", (incident_id,)).fetchone():
            raise HTTPException(409, "This report already has a live run. Check the existing call evidence before any intentional redial; it is not restarted automatically.")
        contacts = [internal_business(r) for r in db.execute("SELECT * FROM businesses WHERE active=1 AND consent_to_contact=1 ORDER BY created_at,name")]
        if CALL_MODE == "live":
            contacts = [c for c in contacts if not c.get("simulated_only") and not is_fictional_number(c["phone"])]
        if not contacts:
            raise HTTPException(409, "Add at least one approved trusted contact first. Example numbers cannot receive real calls.")
        # The shared capability-aware inventory deduplicates legacy numbers after
        # the rescue requirements are defined; do not hide a better-matching row here.
        run_id = new_id("run")
        db.execute("""INSERT INTO coordination_runs(id,incident_id,mode,status,started_at,scenario,candidate_ids_json,planner_json,engine_version)
                      VALUES (?,?,?,'queued',?,?,?,?,5)""",
                   (run_id, incident_id, CALL_MODE, utc_now(), "custom",
                    json.dumps([c["id"] for c in contacts]), json.dumps(planner.info())))
        db.execute("UPDATE incidents SET status='calling' WHERE id=?", (incident_id,))
        db.commit()
    task = asyncio.create_task(run_coordination(run_id, dict(incident_row), contacts, CALL_MODE, "custom"))
    RUNNING_TASKS.add(task)
    task.add_done_callback(RUNNING_TASKS.discard)
    return {"run_id": run_id, "status": "queued"}


def save_provider_request(table: str, owner_id: str, key: str, original: str) -> None:
    """Persist an immutable operation before POST. Never rebuild a replay payload."""
    if table not in {"calls", "rescue_actions"}:
        raise ValueError("Invalid provider request owner")
    digest = hashlib.sha256(original.encode("utf-8")).hexdigest()
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        owner = db.execute(f"SELECT idempotency_key FROM {table} WHERE id=?", (owner_id,)).fetchone()
        if not owner or owner["idempotency_key"] != key:
            raise ValueError("Provider operation changed before submission")
        prior = db.execute("SELECT * FROM provider_requests WHERE idempotency_key=?", (key,)).fetchone()
        if prior and (prior["request_json"] != original or prior["owner_id"] != owner_id or prior["owner_table"] != table):
            raise ValueError("An idempotency key cannot be reused for a changed body or operation")
        db.execute("INSERT OR IGNORE INTO provider_requests VALUES (?,?,?,?,?,?)",
                   (key, table, owner_id, original, digest, utc_now()))
        db.execute(f"UPDATE {table} SET provider_request_json=?,provider_request_hash=? WHERE id=?",
                   (original, digest, owner_id))
        db.commit()


def update_call(call_id: str, **fields):
    allowed = {"status", "provider_call_id", "provider_status", "evidence_json", "analysis_json", "error", "provider_error_json"}
    if not fields or not set(fields) <= allowed:
        raise ValueError("Invalid call update")
    fields["updated_at"] = utc_now()
    with closing(connect()) as db:
        db.execute(f"UPDATE calls SET {','.join(k+'=?' for k in fields)} WHERE id=?", [*fields.values(), call_id])
        db.commit()


def emit(run_id: str, event_type: str, message: str, **extra):
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT events_json FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        events = json.loads(row["events_json"] or "[]")
        events.append({"type": event_type, "message": message, "at": utc_now(), **extra})
        db.execute("UPDATE coordination_runs SET events_json=? WHERE id=?", (json.dumps(events), run_id))
        db.commit()


def finish(run_id: str, state: str, message: str, error: str | None = None):
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT incident_id FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        db.execute("UPDATE coordination_runs SET status=?,stop_reason=?,error=?,completed_at=? WHERE id=?", (state, message, error, utc_now(), run_id))
        db.execute("UPDATE incidents SET status=? WHERE id=?", (state, row["incident_id"]))
        db.commit()
    emit(run_id, "finished", message)


def is_stopped(run_id: str) -> bool:
    with closing(connect()) as db:
        row = db.execute("SELECT cancel_requested FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        return bool(row and row["cancel_requested"])


def still_approved(contact: dict, mode: str) -> bool:
    with closing(connect()) as db:
        row = db.execute("SELECT * FROM businesses WHERE id=?", (contact["id"],)).fetchone()
        return bool(row and row["active"] and row["consent_to_contact"] and row["phone"] == contact["phone"]
                    and (mode == "mock" or (not row["simulated_only"] and not is_fictional_number(row["phone"]))))


async def run_coordination(run_id: str, incident: dict, contacts: list[dict], mode: str, scenario: str, *, comparison: bool = False, requested_contact_id: str | None = None, followup: dict | None = None, practice_reply: str = "saved"):
    current_call_id = None
    try:
        with closing(connect()) as db:
            db.execute("UPDATE coordination_runs SET status='running' WHERE id=?", (run_id,))
            db.commit()
        existing = get_run(run_id)
        definition = existing["definition"]
        if not definition:
            emit(run_id, "understanding", "Reading the rescue goal you confirmed. No one is being asked to begin.", engine=planner.info()["mode"])
            definition = await planner.define(incident)
            record_reasoning(run_id, definition)
            with closing(connect()) as db:
                db.execute("UPDATE coordination_runs SET definition_json=? WHERE id=?", (json.dumps(definition), run_id))
                db.commit()
            emit(run_id, "requirements", definition["goal"], engine=planner.info()["mode"])
        already_called = {c["business_id"] for c in existing["calls"]}
        candidate_ids = {c["id"] for c in contacts if c["id"] not in already_called or (followup and c["id"] == requested_contact_id)}
        history = [{"contact_id": c["business_id"], "contact_name": c["business_name"], "analysis": c["analysis"]} for c in existing["calls"]]
        made = initial_made = len(existing["calls"])
        while True:
            run = get_run(run_id)
            coverage = run["plan"]
            if is_stopped(run_id):
                finish(run_id, "stopped", "Stopped. No further contacts will be called. Stopping does not withdraw an agreement already made.")
                return
            if coverage["complete"] and (not comparison or made > initial_made):
                with closing(connect()) as db:
                    db.execute("UPDATE coordination_runs SET selection_json=? WHERE id=?", (json.dumps(coverage["selection"]), run_id))
                    db.commit()
                finish(run_id, "covered", f"A complete plan is ready with {coverage['helpers_count']} helper{'s' if coverage['helpers_count'] != 1 else ''}. Nobody has been asked to start. Review prices, approve the plan, or keep going to compare.")
                return
            if comparison and made > initial_made:
                finish(run_id, "partial", "The next reply is recorded. Your previous offers are preserved. Review them or keep looking; no one has been engaged.")
                return
            if made >= MAX_CONTACTS:
                finish(run_id, "covered" if coverage["complete"] else "partial", "Reached this run's total call limit. Previous offers are preserved; no automatic redial.")
                return
            # Re-read the same audited directory policy used by the comparison UI.
            # The original consented candidate set bounds this run; newly added
            # contacts become available on a subsequent user-requested comparison.
            needs = [n for n in coverage["requirements"] if comparison or n["status"] != "covered"]
            with closing(connect()) as db:
                inventory = contact_availability(db, run, requirements=needs, allowed_ids=candidate_ids)
            remaining = [i["contact"] for i in inventory if i["status"] == "eligible" or
                         (i["contact_id"] == requested_contact_id and i["status"] == "no_capability_match")]
            # A deliberate condition recheck is the sole exception to no-redial.
            # It is bounded to the reviewed recipient and consumed after one call.
            if followup and made == initial_made and requested_contact_id in candidate_ids:
                remaining = [c for c in contacts if c["id"] == requested_contact_id]
            if not remaining:
                unmatched_count = sum(i["status"] == "no_capability_match" for i in inventory)
                with closing(connect()) as db:
                    all_inventory = contact_availability(db, run, requirements=needs)
                new_candidates = any(i["status"] == "eligible" for i in all_inventory)
                unmatched_count = sum(i["status"] == "no_capability_match" for i in all_inventory)
                message = ("This inquiry batch is finished. Other approved capability matches are available; use Keep going to check another contact."
                           if new_candidates else
                           f"No uncalled contact has a saved capability matching the needed tasks; {unmatched_count} other approved contact(s) remain. Review contact availability or explicitly check suitability."
                           if unmatched_count else "No uncalled, approved contacts are available for this inquiry. See contact availability for the reasons.")
                finish(run_id, "covered" if coverage["complete"] else "partial", message)
                return
            if comparison:
                coverage = {**coverage, "comparison": True}
            if followup:
                coverage = {**coverage, "offer_followup": followup}
            emit(run_id, "choosing", "Choosing another contact for capability and price comparison." if comparison else "Choosing a trusted contact for: " + ", ".join(coverage["missing_labels"]) + ".")
            if requested_contact_id:
                choice = {"contact_id": requested_contact_id,
                    "reason": "You explicitly requested this contact's capability and price inquiry. Suitability must be verified; no work is authorized.",
                    "_meta": {"phase": "next-contact selection", "engine": "user", "model": None, "fallback_reason": None, "decision_reason": "User selected this approved contact."}}
            else:
                choice = await planner.choose(incident, definition, coverage, remaining, history)
            if followup:
                choice["reason"] = "You requested one follow-up to clarify: " + "; ".join(followup["conditions"]) + ". No work is authorized."
            record_reasoning(run_id, choice)
            if is_stopped(run_id):
                continue
            if choice["contact_id"] is None:
                finish(run_id, "covered" if coverage["complete"] else "partial", choice["reason"] + (" Your existing offer is preserved." if coverage["complete"] else " Still needed: " + ", ".join(coverage["missing_labels"]) + "."))
                return
            business = next(c for c in remaining if c["id"] == choice["contact_id"])
            candidate_ids.discard(business["id"])
            if not still_approved(business, mode):
                emit(run_id, "skipped", business["name"] + " is no longer approved; skipped.")
                continue
            with closing(connect()) as db:
                fresh_row = db.execute("SELECT * FROM businesses WHERE id=?", (business["id"],)).fetchone()
                fresh = internal_business(fresh_row) if fresh_row else None
            if fresh and any(fresh.get(k) != business.get(k) for k in ("name", "capabilities", "description", "simulation")):
                candidate_ids.add(business["id"])
                emit(run_id, "skipped", business["name"] + " was edited during selection; reviewing its current details before calling.")
                continue
            current_call_id = new_id("call")
            idempotency = f"rescue-relay:{run_id}:{business['id']}"
            if followup:
                idempotency += f":followup:{followup['call_id']}"
            made += 1
            targets = [n["id"] for n in coverage["requirements"] if comparison or n["status"] != "covered"]
            with closing(connect()) as db:
                db.execute("""INSERT INTO calls(id,run_id,incident_id,business_id,status,idempotency_key,created_at,updated_at,
                   business_name_snapshot,business_description_snapshot,masked_phone_snapshot,selection_reason,target_needs_json,ordinal,recipient_fingerprint)
                   VALUES (?,?,?,?,'dialing',?,?,?,?,?,?,?,?,?,?)""",
                   (current_call_id, run_id, incident["id"], business["id"], idempotency, utc_now(), utc_now(),
                    business["name"], business["description"], mask_phone(business["phone"]), choice["reason"], json.dumps(targets), made, recipient_fingerprint(business)))
                db.commit()
            emit(run_id, "calling", ("Simulating an inquiry to " if mode == "mock" else "Requesting a CALL-E call to ") + business["name"] + ". " + choice["reason"], contact_id=business["id"])
            if mode == "mock":
                simulated_business = business
                if followup and practice_reply != "saved":
                    # One explicitly selected fixture; never changes directory or live results.
                    profile = {**business.get("simulation", {}), "response": practice_reply,
                               "transcript": "", "transcript_mode": "auto"}
                    if practice_reply == "agrees":
                        profile["conditions"] = ""
                    simulated_business = {**business, "simulation": profile}
                provider_id, evidence = await calling.mock_call(incident, simulated_business, definition, coverage, coordinator=planner)
            else:
                provider_id, evidence = await calling.live_call(
                    incident, business, definition, coverage, idempotency, CALLE_API_KEY,
                    lambda **fields: update_call(current_call_id, **fields),
                    persist_request=lambda original: save_provider_request("calls", current_call_id, idempotency, original))
            if followup:
                evidence["offer_followup"] = {"source_call_id": followup["call_id"],
                    "conditions_asked": followup["conditions"], "information_only": True,
                    "practice_reply": practice_reply if mode == "mock" else None}
            update_call(current_call_id, status="analyzing", provider_call_id=provider_id,
                        provider_status=evidence["provider_status"], evidence_json=json.dumps(evidence))
            emit(run_id, "analyzing", "Reading " + business["name"] + "'s completed conversation before making another call.", engine=planner.info()["mode"])
            # Required ordering: completed evidence -> LLM -> validated coverage -> choose.
            analysis = await planner.analyze(incident, definition, evidence, business, coverage)
            record_reasoning(run_id, analysis)
            # A real answered call without usable transcript could contain commitments
            # we cannot verify. Never blindly duplicate them with another contact.
            if mode == "live" and evidence["provider_status"] == "completed" and not evidence["transcript"]:
                raise PlannerUnavailable("CALL-E has a completed result but no readable transcript. No next contact was called; check this provider call before continuing.")
            if analysis["new_requirements"]:
                known = {n["id"] for n in definition["requirements"]}
                new_needs = [n for n in analysis["new_requirements"] if n["id"] not in known]
                if len(definition["requirements"]) + len(new_needs) > 8:
                    raise PlannerUnavailable("The conversation revealed more needs than this prototype can safely track. No next contact was called.")
                definition["requirements"].extend(new_needs)
                with closing(connect()) as db:
                    db.execute("UPDATE coordination_runs SET definition_json=? WHERE id=?", (json.dumps(definition), run_id))
                    db.commit()
            update_call(current_call_id, status="completed", analysis_json=json.dumps(analysis))
            history.append({"contact_id": business["id"], "contact_name": business["name"], "analysis": analysis})
            current_call_id = None
            after = get_run(run_id)["plan"]
            message = f"Offers cover {after['covered_count']} of {after['total_count']} needs. Nobody is engaged. "
            message += "Ready for your review, not a start instruction." if after["complete"] else "Still needed: " + ", ".join(after["missing_labels"]) + "."
            emit(run_id, "coverage", message, covered=after["covered_count"], total=after["total_count"])
            if mode == "mock":
                await asyncio.sleep(calling.MOCK_DELAY_SECONDS * 0.7)
    except asyncio.CancelledError:
        message = "Run interrupted. No automatic redial. A live call or agreement may still exist; check its provider record." if mode == "live" else "Run interrupted. Nothing will restart automatically."
        if current_call_id:
            update_call(current_call_id, status="interrupted", error=message)
        finish(run_id, "interrupted", message, message)
        raise
    except (PlannerUnavailable, calling.CallUncertain) as exc:
        message = str(exc)
        if current_call_id:
            update_call(current_call_id, status="failed", error=message)
        finish(run_id, "failed", "Paused without calling another contact.", message)
    except Exception as exc:
        message = f"Run stopped after an unexpected {type(exc).__name__}. No automatic retry or redial."
        if current_call_id:
            update_call(current_call_id, status="failed", error=message)
        logger.error("Run failure: %s", type(exc).__name__)
        finish(run_id, "failed", message, message)


def editable_plan(db, run_id: str, token: str) -> dict:
    row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Rescue plan not found")
    if row["execution_status"] != "not_started" or row["status"] not in {"covered", "partial", "stopped"}:
        raise HTTPException(409, "This plan cannot be changed or continued while calls are active, after start, or after an uncertain result.")
    if row["mode"] != CALL_MODE:
        raise HTTPException(409, "The call setting changed. This run cannot place calls in a different setting.")
    run = hydrate_run(db, row)
    if run["scope_warning"]:raise HTTPException(409,run["scope_warning"])
    if token != run["plan_token"]:
        raise HTTPException(409, "The plan changed. Refresh and review the latest offers before continuing.")
    return run


@app.post("/api/runs/{run_id}/selection")
def select_plan(run_id: str, body: SelectPlanRequest):
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        run = editable_plan(db, run_id, body.plan_token)
        assignments=body.assignments
        if body.plan_id:
            option=next((o for o in run["plan_options"] if o["id"]==body.plan_id),None)
            if not option:raise HTTPException(422,"Choose a complete plan from the current options.")
            if assignments is not None and assignments!=option["assignments"]:
                raise HTTPException(422,"The assignments do not match the selected plan.")
            assignments=option["assignments"]
        if not assignments:raise HTTPException(422,"Choose a complete plan or supply verified task assignments.")
        eligible = {n["id"]: {o["contact_id"] for o in n["offers"] if o["status"] == "committed"} for n in run["plan"]["requirements"]}
        required = {key for key, choices in eligible.items() if choices}
        if set(assignments) != required or any(contact not in eligible.get(key, set()) for key, contact in assignments.items()):
            raise HTTPException(422, "Choose one verified offer for every available task. Conditional or unverified offers cannot be selected.")
        db.execute("UPDATE coordination_runs SET selection_json=?,approval_json=NULL,approved_at=NULL WHERE id=?", (json.dumps(assignments), run_id))
        db.commit()
    emit(run_id, "selection", "You changed the selected rescue plan. No calls were placed and no helper was engaged.")
    return get_run(run_id)


@app.post("/api/runs/{run_id}/continue", status_code=202)
async def continue_search(run_id: str, body: ContinueRequest):
    validate_live_request(body)
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        run = editable_plan(db, run_id, body.plan_token)
        if db.execute("SELECT 1 FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchone():
            raise HTTPException(409, "Another call is still running. No duplicate search was started.")
        if len(run["calls"]) >= MAX_CONTACTS:
            raise HTTPException(409, "This run has reached its total call limit. Continuing does not reset the limit.")
        called = {c["business_id"] for c in run["calls"]}
        inventory = contact_availability(db, run)
        if body.contact_id:
            item = next((i for i in inventory if i["contact_id"] == body.contact_id), None)
            if not item or item["status"] not in {"eligible", "no_capability_match"}:
                raise HTTPException(409, "That contact is not available for a new inquiry. Refresh contact availability; no automatic redial is allowed.")
            if item["status"] == "no_capability_match" and not body.confirm_unmatched:
                raise HTTPException(422, "Explicitly confirm a suitability inquiry for this contact. Saved capabilities do not match; no ability or offer will be assumed.")
            contacts = [item["contact"]]
        else:
            contacts = [i["contact"] for i in inventory if i["status"] == "eligible"]
        if not contacts:
            raise HTTPException(409, run["continue_blocked_reason"] or "Review the remaining contacts and their capabilities before a new inquiry.")
        db.execute("""UPDATE coordination_runs SET status='queued',comparison_round=comparison_round+1,selection_json=?,
                    candidate_ids_json=?,cancel_requested=0,error=NULL,completed_at=NULL,approval_json=NULL,approved_at=NULL WHERE id=?""",
                   (json.dumps(run["plan"]["selection"]), json.dumps(sorted(called | {c["id"] for c in contacts})), run_id))
        db.execute("UPDATE incidents SET status='calling' WHERE id=?", (run["incident_id"],))
        incident = dict(db.execute("SELECT * FROM incidents WHERE id=?", (run["incident_id"],)).fetchone())
        db.commit()
    emit(run_id, "comparison", "You asked to keep going. Checking one more responder's abilities and price; the current selection stays unchanged.")
    task = asyncio.create_task(run_coordination(run_id, incident, contacts, CALL_MODE, "custom", comparison=True, requested_contact_id=body.contact_id))
    RUNNING_TASKS.add(task)
    task.add_done_callback(RUNNING_TASKS.discard)
    return {"run_id": run_id, "status": "queued", "comparison": True}



@app.post("/api/runs/{run_id}/follow-up", status_code=202)
async def follow_up_offer(run_id: str, body: FollowupRequest):
    """One explicitly requested inquiry, never an approval or start callback."""
    if CALL_MODE == "live" and body.practice_reply != "saved":
        raise HTTPException(422, "Practice replies cannot be supplied for real calls.")
    validate_live_request(body)
    if not body.confirm_followup:
        raise HTTPException(422, "Confirm one follow-up inquiry. This does not authorize work.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        run = editable_plan(db, run_id, body.plan_token)
        candidate = next((c for c in run["followup_options"] if c["call_id"] == body.source_call_id), None)
        if not candidate:
            raise HTTPException(409, "This conditional reply cannot be rechecked now. Refresh the report; no call was started.")
        row = db.execute("SELECT * FROM businesses WHERE id=?", (candidate["contact_id"],)).fetchone()
        contact = internal_business(row)
        incident = dict(db.execute("SELECT * FROM incidents WHERE id=?", (run["incident_id"],)).fetchone())
        db.execute("""UPDATE coordination_runs SET status='queued',comparison_round=comparison_round+1,
                    selection_json=?,cancel_requested=0,error=NULL,completed_at=NULL,approval_json=NULL,approved_at=NULL WHERE id=?""",
                   (json.dumps(run["plan"]["selection"]), run_id))
        db.execute("UPDATE incidents SET status='calling' WHERE id=?", (run["incident_id"],))
        db.commit()
    emit(run_id, "offer_followup", "You requested a condition check with " + contact["name"] +
         ". One inquiry only; nobody is asked to begin or travel.", contact_id=contact["id"],
         source_call_id=candidate["call_id"], practice_reply=body.practice_reply if CALL_MODE == "mock" else None)
    task = asyncio.create_task(run_coordination(run_id, incident, [contact], CALL_MODE, "custom",
        comparison=True, requested_contact_id=contact["id"], followup=candidate, practice_reply=body.practice_reply))
    RUNNING_TASKS.add(task)
    task.add_done_callback(RUNNING_TASKS.discard)
    return {"run_id": run_id, "status": "queued", "followup": True}


@app.post("/api/runs/{run_id}/stop")
def stop_run(run_id: str):
    with closing(connect()) as db:
        row = db.execute("SELECT status FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Rescue run not found")
        if row["status"] in ACTIVE_RUN_STATUSES:
            db.execute("UPDATE coordination_runs SET cancel_requested=1 WHERE id=?", (run_id,))
            db.commit()
            emit(run_id, "stop_requested", "Stopping after any current call is recorded. No further contacts will be called. An active CALL-E call is not canceled by this button.")
    return {"status": "stop_requested", "note": "Stops future calls, not an active provider call or previously accepted work."}


@app.get("/api/runs/{run_id}/export")
def export_run(run_id: str):
    run = get_run(run_id)
    # Default export is safe structural evidence, not sensitive transcript/location text.
    artifact = {"app_version": "5.6.0", "captured_at": utc_now(), "run_id": run_id,
                "mode": run["mode"], "planner": run["planner"], "status": run["status"],
                "live_call_performed": False if run["mode"] == "mock" else None,
                "coverage": {k: run["plan"][k] for k in ["covered_count", "total_count", "complete", "helpers_count"]},
                "call_count": run["calls_made"], "uncalled_count": run["uncalled_count"],
                "calls": [{"ordinal": c["ordinal"], "provider_call_id": c["provider_call_id"], "status": c["status"],
                           "transcript_turns": len((c["evidence"] or {}).get("transcript", [])),
                           "analysis_present": bool(c["analysis"])} for c in run["calls"]],
                "note": "Names, phone numbers, reports, locations, transcripts and free-text results omitted. A covered plan is not proof of completed rescue. Provider IDs retained; review before sharing."}
    return JSONResponse(artifact, headers={"Content-Disposition": f'attachment; filename="{run_id}-evidence.json"'})


@app.post("/api/demo/reset")
def reset_demo():
    if CALL_MODE == "live" or APP_ENV == "production":
        raise HTTPException(404, "Reset is disabled in this configuration")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchone():
            raise HTTPException(409, "Stop the current run before resetting.")
        if db.execute("SELECT 1 FROM coordination_runs WHERE mode='live'").fetchone():
            raise HTTPException(409, "This database contains live call history; use a separate demo database.")
        for table in ["provider_requests", "rescue_actions", "calls", "coordination_runs", "incidents", "businesses"]:
            db.execute(f"DELETE FROM {table}")
        seed_demo_businesses(db)
        db.commit()
    return {"status": "reset"}


def record_reasoning(run_id: str, result: dict) -> None:
    meta = result.get("_meta") or {}
    if meta:
        emit(run_id, "reasoning", meta.get("phase", "Reasoning"), **meta)


def actions_for_run(db: sqlite3.Connection, run_id: str) -> list[dict]:
    result = []
    for row in db.execute("SELECT * FROM rescue_actions WHERE run_id=? ORDER BY ordinal", (run_id,)):
        action = dict(row)
        action.pop("contact_json", None)  # includes private destination phone; never return it
        action.pop("provider_request_json", None)
        raw_error = action.pop("provider_error_json", None)
        action["provider_error"] = calling.public_provider_error(json.loads(raw_error)) if raw_error else None
        for column, key in [("assignments_json", "assignments"), ("message_json", "message"),
                            ("evidence_json", "evidence"), ("analysis_json", "analysis"),
                            ("progress_log_json", "progress_log"), ("attempts_json", "attempts"),
                            ("recovery_request_json", "recovery_request")]:
            raw = action.pop(column)
            action[key] = json.loads(raw) if raw else None
        action["stationary"] = all(kind(n) == "receiving_care" for n in action["assignments"])
        result.append(action)
    return result


def update_action(action_id: str, **fields):
    allowed = {"status", "progress", "message_json", "provider_call_id", "provider_status", "evidence_json", "analysis_json", "error", "provider_error_json"}
    if not fields or not set(fields) <= allowed:
        raise ValueError("Invalid action update")
    fields["updated_at"] = utc_now()
    with closing(connect()) as db:
        db.execute(f"UPDATE rescue_actions SET {','.join(k+'=?' for k in fields)} WHERE id=?", [*fields.values(), action_id])
        db.commit()


def finish_start(run_id: str, status: str, message: str, error: str | None = None):
    with closing(connect()) as db:
        db.execute("UPDATE coordination_runs SET execution_status=? WHERE id=?", (status, run_id))
        if status != "active":
            db.execute("UPDATE rescue_actions SET status='skipped',error=?,updated_at=? WHERE run_id=? AND status='queued'", (message, utc_now(), run_id))
        db.commit()
    finish(run_id, status, message, error)


@app.post("/api/runs/{run_id}/start", status_code=202)
async def start_rescue(run_id: str, body: StartRequest):
    """Explicit one-time start. Snapshot actions transactionally BEFORE any calls."""
    validate_live_request(body)
    if CALL_MODE == "live" and body.practice_reply != "saved":
        raise HTTPException(422, "Practice replies cannot be supplied for real callbacks.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Rescue not found")
        if row["mode"] != CALL_MODE:
            raise HTTPException(409, "This report belongs to a different call setting. It cannot start calls in the current setting.")
        if row["execution_status"] != "not_started":
            raise HTTPException(409, "This rescue has already been started. Check its existing replies; helpers will not be called twice.")
        if row["status"] != "covered" or row["engine_version"] < 3:
            raise HTTPException(409, "Finish a new rescue plan before starting it.")
        if db.execute("SELECT 1 FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchone():
            raise HTTPException(409, "Another set of calls is already running.")
        run = hydrate_run(db, row)
        if run["scope_warning"]:raise HTTPException(409,run["scope_warning"])
        if row["engine_version"] >= 5 and body.plan_token != run["plan_token"]:
            raise HTTPException(409, "The plan changed or was not reviewed. Refresh and approve the displayed plan before calling helpers back.")
        if run["plan"]["cost"]["needs_acknowledgment"] and not body.confirm_costs:
            raise HTTPException(422, "Review and acknowledge the selected prices and unknown costs before the callback.")
        if run["plan"]["cost"]["over_budget"] and not body.confirm_over_budget:
            raise HTTPException(422, "The selected quotes exceed your budget. Choose another offer or explicitly acknowledge this before the callback.")
        if not run["plan"]["complete"]:
            raise HTTPException(409, "Some help is still missing. Complete the plan before starting.")
        groups: dict[str, list[dict]] = {}
        for need in run["plan"]["requirements"]:
            groups.setdefault(need["assignment"]["contact_id"], []).append(need)
        # Confirm receiving help first. Do not ask a driver to start when receiving
        # capacity has just been withdrawn. No unrelated contact receives this wave.
        ordered = sorted(groups.items(), key=lambda item: 0 if any(kind(n) == "receiving_care" for n in item[1]) else 1)
        actions = []
        for ordinal, (contact_id, assignments) in enumerate(ordered, 1):
            saved = db.execute("SELECT * FROM businesses WHERE id=?", (contact_id,)).fetchone()
            if not saved or not saved["active"] or not saved["consent_to_contact"]:
                raise HTTPException(409, "One of the helpers is no longer approved. Review the contacts before starting.")
            contact = internal_business(saved)
            original = db.execute("SELECT recipient_fingerprint FROM calls WHERE run_id=? AND business_id=? AND status='completed' ORDER BY ordinal DESC LIMIT 1", (run_id, contact_id)).fetchone()
            if not original or original["recipient_fingerprint"] != recipient_fingerprint(contact):
                raise HTTPException(409, "A helper's name or number changed after agreeing. Make a new plan before calling them to start.")
            if CALL_MODE == "live" and (contact["simulated_only"] or is_fictional_number(contact["phone"])):
                raise HTTPException(409, "An example number cannot receive a real follow-up call.")
            ident, key, now = new_id("action"), f"rescue-relay:{run_id}:start:{contact_id}", utc_now()
            db.execute("""INSERT INTO rescue_actions(id,run_id,business_id,business_name,contact_json,assignments_json,
                       ordinal,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                       (ident, run_id, contact_id, contact["name"], json.dumps(contact), json.dumps(assignments), ordinal, key, now, now))
            actions.append({"id": ident, "contact": practice_contact(contact, body.practice_reply, assignments),
                            "assignments": assignments, "idempotency_key": key, "practice_reply": body.practice_reply})
        approval = {"report_snapshot": run["report_snapshot"], "plan_id":run["selected_plan_id"], "plan_label":next((p["label"] for p in run["plan_options"] if p["id"]==run["selected_plan_id"]),"Selected plan"), "at": utc_now(), "plan_token": run["plan_token"], "selection": run["plan"]["selection"], "cost": run["plan"]["cost"],
                    "confirm_costs": body.confirm_costs, "confirm_over_budget": body.confirm_over_budget,
                    "note": "Permission for the selected callback and stated price ceiling only; no payment or medical consent."}
        db.execute("UPDATE coordination_runs SET status='starting',execution_status='starting',cancel_requested=0,error=NULL,completed_at=NULL,approved_at=?,approval_json=? WHERE id=?", (approval["at"], json.dumps(approval), run_id))
        db.execute("UPDATE incidents SET status='starting' WHERE id=?", (row["incident_id"],))
        incident = dict(db.execute("SELECT * FROM incidents WHERE id=?", (row["incident_id"],)).fetchone())
        db.commit()
    emit(run_id, "start_requested", f"Confirming the location and agreed tasks with {len(actions)} helper{'s' if len(actions) != 1 else ''}.")
    task = asyncio.create_task(run_start(run_id, incident, run, actions))
    RUNNING_TASKS.add(task)
    task.add_done_callback(RUNNING_TASKS.discard)
    return {"run_id": run_id, "status": "starting", "helpers": len(actions)}


@app.post("/api/actions/{action_id}/retry", status_code=202)
async def retry_callback(action_id: str, body: CallbackRecoveryRequest):
    """User-authorized one-helper callback, with fresh evidence and the same ceiling.

    Prior evidence is archived before a new idempotency key is reserved. A stale
    or repeated POST cannot place a second call. Already-confirmed helpers are
    never redialed, and later helpers remain paused for a separate decision.
    """
    validate_live_request(body)
    if not body.confirm_callback:
        raise HTTPException(422, "Confirm this one callback before continuing.")
    if CALL_MODE == "live" and body.practice_reply != "saved":
        raise HTTPException(422, "Practice replies cannot be supplied for real callbacks.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT * FROM rescue_actions WHERE id=?", (action_id,)).fetchone()
        if not old:
            raise HTTPException(404, "Helper not found")
        row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (old["run_id"],)).fetchone()
        run = hydrate_run(db, row)
        option = run.get("callback_recovery")
        if not option or option["action_id"] != action_id:
            raise HTTPException(409, "This callback cannot be retried. Refresh and check the saved status and contact approval.")
        if body.recovery_token != option["token"]:
            raise HTTPException(409, "The callback changed. Refresh before confirming another call.")
        action = next(a for a in run["actions"] if a["id"] == action_id)
        attempts = list(action.get("attempts") or [])
        if old["status"] != "skipped":
            attempts.append({**{k: action.get(k) for k in (
                "business_name", "status", "message", "evidence", "analysis", "error",
                "provider_call_id", "provider_status", "provider_request_hash", "provider_error", "idempotency_key", "created_at", "updated_at", "recovery_request")},
                "id": new_id("attempt"), "started_at": action.get("attempt_started_at") or action["created_at"]})
        now = utc_now()
        key = f"rescue-relay:{run['id']}:callback:{action_id}:retry:{len(attempts)}"
        request_meta = {"at": now, "source_token": body.recovery_token, "explicit_confirmation": True,
                        "practice_reply": body.practice_reply if CALL_MODE == "mock" else None}
        db.execute("""UPDATE rescue_actions SET status='queued',progress='waiting',attempts_json=?,
                   attempt_started_at=?,recovery_request_json=?,idempotency_key=?,
                   message_json=NULL,evidence_json=NULL,analysis_json=NULL,provider_call_id=NULL,
                   provider_status=NULL,provider_request_json=NULL,provider_request_hash=NULL,provider_error_json=NULL,error=NULL,updated_at=? WHERE id=?""",
                   (json.dumps(attempts), now, json.dumps(request_meta), key, now, action_id))
        db.execute("""UPDATE coordination_runs SET status='starting',execution_status='starting',
                   cancel_requested=0,error=NULL,stop_reason=NULL,completed_at=NULL WHERE id=?""", (run["id"],))
        db.execute("UPDATE incidents SET status='starting' WHERE id=?", (run["incident_id"],))
        incident = dict(db.execute("SELECT * FROM incidents WHERE id=?", (run["incident_id"],)).fetchone())
        contact = internal_business(db.execute("SELECT * FROM businesses WHERE id=?", (old["business_id"],)).fetchone())
        payload = {"id": action_id, "contact": practice_contact(contact, body.practice_reply, action["assignments"]),
                   "assignments": action["assignments"], "idempotency_key": key,
                   "practice_reply": body.practice_reply, "recovery_request": request_meta}
        db.commit()
    emit(run["id"], "callback_retry", f"You requested one callback to {old['business_name']} under the original approved terms.")
    task = asyncio.create_task(run_start(run["id"], incident, run, [payload]))
    RUNNING_TASKS.add(task)
    task.add_done_callback(RUNNING_TASKS.discard)
    return {"run_id": run["id"], "action_id": action_id, "status": "starting", "helpers": 1}


async def run_start(run_id: str, incident: dict, run: dict, actions: list[dict]):
    current = None
    try:
        for action in actions:
            current = action["id"]
            contact = action["contact"]
            if is_stopped(run_id):
                finish_start(run_id, "stopped", "No more helpers will be called. Any agreement already made still stands; an active call cannot be withdrawn here.")
                return
            if not still_approved(contact, run["mode"]):
                update_action(current, status="needs_attention", error="This contact is no longer approved.")
                finish_start(run_id, "attention", "A helper is no longer approved. No further start calls were made.")
                return
            emit(run_id, "start_preparing", f"Preparing the approved callback to {contact['name']}.", contact_id=contact["id"])
            message = await planner.prepare_message(incident, contact, action["assignments"], run["plan"])
            record_reasoning(run_id, message)
            if action.get("recovery_request"):
                message["fact_sheet"] = ("Clarification of an earlier approved callback, not a second booking. "
                    "First ask whether the same work has already started. Reconfirm its terms without duplicating it. "
                    "Do not ask another helper to begin. " + message["fact_sheet"])
            update_action(current, message_json=json.dumps(message))
            # Recheck after model inference, before any externally visible action.
            if is_stopped(run_id) or not still_approved(contact, run["mode"]):
                finish_start(run_id, "stopped", "Stopped before the next helper was called. Existing agreements are unchanged.")
                return
            update_action(current, status="contacting")
            emit(run_id, "start_calling", f"Checking that {contact['name']} is ready to begin.", contact_id=contact["id"])
            if run["mode"] == "mock":
                provider_id, evidence = await calling.mock_call(incident, contact, run["definition"], run["plan"], coordinator=planner if action.get("practice_reply", "saved") == "saved" else None,
                                                                start=True, assignments=action["assignments"])
            else:
                # The model cannot alter recipient numbers or add operational facts.
                provider_id, evidence = await calling.live_call(
                    incident, contact, run["definition"], run["plan"], action["idempotency_key"], CALLE_API_KEY,
                    lambda **fields: update_action(current, **{**fields, "status": "contacting"}),
                    task_override=calling.start_call_task(incident, contact, message["fact_sheet"], recovery=bool(action.get("recovery_request"))),
                    persist_request=lambda original: save_provider_request("rescue_actions", current, action["idempotency_key"], original))
            if action.get("recovery_request"):
                evidence["callback_recovery"] = action["recovery_request"]
            if run["mode"] == "mock" and action.get("practice_reply", "saved") != "saved":
                evidence["practice_reply_selected"] = action["practice_reply"]
            update_action(current, status="analyzing", provider_call_id=provider_id,
                          provider_status=evidence["provider_status"], evidence_json=json.dumps(evidence))
            analysis = await planner.confirm_start(contact, action["assignments"], evidence)
            record_reasoning(run_id, analysis)
            if run["mode"] == "live" and evidence["provider_status"] == "completed" and not evidence["transcript"]:
                raise PlannerUnavailable("The follow-up has no readable conversation. Check the saved CALL-E record before making more calls.")
            approved_quote = action["assignments"][0]["assignment"].get("quote") or CostQuote().model_dump()
            price_ok, callback_quote, price_note = check_callback_price(approved_quote, evidence)
            analysis["cost_quote"] = callback_quote
            analysis["price_check"] = price_note
            analysis["price_approved"] = price_ok
            if analysis["status"] == "confirmed" and not price_ok:
                analysis.update(status="conditional", confirmed_requirement_ids=[], summary=price_note,
                                conditions=analysis.get("conditions", []) + [price_note])
            ready = analysis["status"] == "confirmed"
            update_action(current, status="confirmed" if ready else "needs_attention", progress="ready" if ready else "waiting",
                          analysis_json=json.dumps(analysis))
            emit(run_id, "helper_ready" if ready else "helper_not_ready",
                 f"{contact['name']}: {analysis['summary']}", contact_id=contact["id"])
            if not ready:
                finish_start(run_id, "attention", f"{contact['name']} has not confirmed starting. Read their reply. No further helpers were asked to begin; already-confirmed helpers may still act.")
                return
            current = None
        if is_stopped(run_id):
            finish_start(run_id, "stopped", "Stopped after recording the current reply. Existing agreements have not been canceled.")
        else:
            with closing(connect()) as db:
                pending = db.execute("SELECT 1 FROM rescue_actions WHERE run_id=? AND status!='confirmed'", (run_id,)).fetchone()
            if pending:
                finish_start(run_id, "attention", "This reply is saved. Another approved helper still needs confirmation; nobody else was called.")
                return
            finish_start(run_id, "active", "Everyone has confirmed their part. Keep this page open and update progress when you hear from them. This does not mean anyone has arrived yet.")
    except asyncio.CancelledError:
        message = "Interrupted by a restart. A call or agreement may already exist. Nothing will restart automatically."
        if current:
            update_action(current, status="interrupted", error=message)
        finish_start(run_id, "interrupted", message, message)
        raise
    except (PlannerUnavailable, calling.CallUncertain) as exc:
        if current:
            update_action(current, status="needs_attention", error=str(exc))
        finish_start(run_id, "attention", "Stopped before contacting another helper. Check the saved reply or CALL-E record.", str(exc))
    except Exception as exc:
        message = f"The follow-up stopped ({type(exc).__name__}). No automatic retry or redial."
        if current:
            update_action(current, status="needs_attention", error=message)
        logger.error("Start failure: %s", type(exc).__name__)
        finish_start(run_id, "attention", message, message)


def provider_recovery_option(db: sqlite3.Connection, run: dict) -> dict | None:
    """One saved unresolved operation, never an invitation to make a new call."""
    if (run["mode"] != "live" or CALL_MODE != "live"
            or run["status"] not in {"failed", "interrupted", "attention", "stopped"}
            or run.get("scope_warning") or run.get("legacy") or run.get("engine_version", 0) < 3
            or not run.get("definition")):
        return None
    if db.execute("SELECT 1 FROM coordination_runs WHERE status IN ('queued','running','starting')").fetchone():
        return None
    table = "rescue_actions" if run.get("actions") else "calls"
    for saved in db.execute(f"SELECT * FROM {table} WHERE run_id=? ORDER BY ordinal DESC", (run["id"],)):
        item = dict(saved)
        if item["status"] not in {"failed", "interrupted", "needs_attention"} or item.get("analysis_json"):
            continue
        known_id = item.get("provider_call_id")
        if not known_id:
            original = item.get("provider_request_json")
            if not original:
                continue  # Legacy lost-response records cannot be reconstructed safely.
            ledger = db.execute("SELECT * FROM provider_requests WHERE idempotency_key=?", (item["idempotency_key"],)).fetchone()
            if not ledger or ledger["request_json"] != original or ledger["request_hash"] != item.get("provider_request_hash"):
                continue
            contact_row = db.execute("SELECT * FROM businesses WHERE id=?", (item["business_id"],)).fetchone()
            if not contact_row:
                continue
            contact = internal_business(contact_row)
            old_fingerprint = (recipient_fingerprint(json.loads(item["contact_json"])) if table == "rescue_actions"
                               else item.get("recipient_fingerprint"))
            if (not contact["active"] or not contact["consent_to_contact"] or contact["simulated_only"]
                    or is_fictional_number(contact["phone"]) or recipient_fingerprint(contact) != old_fingerprint):
                continue
        signature = {k: item.get(k) for k in ("id", "idempotency_key", "provider_call_id", "provider_request_hash", "status", "updated_at")}
        signature["table"] = table
        token = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()
        return {"operation_id": item["id"], "kind": "callback" if table == "rescue_actions" else "inquiry",
                "name": item.get("business_name") or item.get("business_name_snapshot") or "Saved contact",
                "method": "read" if known_id else "replay", "provider_call_id": known_id,
                "idempotency_key": item["idempotency_key"], "request_hash": item.get("provider_request_hash"),
                "token": token, "label": "Check saved call status" if known_id else "Recover original call request",
                "explanation": ("Read the saved Calls API ID to check its status. No create request or new call will be made." if known_id else
                    "No Calls API ID is saved, so creation and dialing are unconfirmed. Replay only the unchanged original request and idempotency key. This can create the originally authorized call if the first request was not accepted, or recover the same operation if it was; it never authorizes a replacement or a different contact.")}
    return None


class ProviderRecoveryRequest(CoordinateRequest):
    operation_id: str = Field(min_length=3, max_length=100)
    recovery_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirm_recovery: bool = False


@app.post("/api/runs/{run_id}/recover-provider", status_code=202)
async def recover_provider(run_id: str, body: ProviderRecoveryRequest):
    validate_live_request(body)
    if CALL_MODE != "live" or not body.confirm_recovery:
        raise HTTPException(422, "Explicitly confirm recovery of this saved live operation.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Rescue run not found")
        run = hydrate_run(db, row)
        option = run.get("provider_recovery")
        if not option or option["operation_id"] != body.operation_id or option["token"] != body.recovery_token:
            raise HTTPException(409, "The saved operation changed or cannot be recovered safely. Refresh its status before continuing.")
        table = "rescue_actions" if option["kind"] == "callback" else "calls"
        saved = dict(db.execute(f"SELECT * FROM {table} WHERE id=?", (body.operation_id,)).fetchone())
        phase = "starting" if table == "rescue_actions" else "running"
        db.execute("UPDATE coordination_runs SET status=?,cancel_requested=0,error=NULL,completed_at=NULL WHERE id=?", (phase, run_id))
        if table == "rescue_actions":
            db.execute("UPDATE coordination_runs SET execution_status='starting' WHERE id=?", (run_id,))
        db.execute(f"UPDATE {table} SET status=?,updated_at=? WHERE id=?",
                   ("contacting" if table == "rescue_actions" else "waiting", utc_now(), body.operation_id))
        db.execute("UPDATE incidents SET status=? WHERE id=?", ("starting" if table == "rescue_actions" else "calling", run["incident_id"]))
        incident = dict(db.execute("SELECT * FROM incidents WHERE id=?", (run["incident_id"],)).fetchone())
        if table == "rescue_actions":
            contact = json.loads(saved["contact_json"])
        else:
            current = db.execute("SELECT * FROM businesses WHERE id=?", (saved["business_id"],)).fetchone()
            contact = internal_business(current) if current else {"id": saved["business_id"], "capabilities": []}
            contact = {**contact, "name": saved["business_name_snapshot"], "description": saved["business_description_snapshot"] or ""}
        db.commit()
    emit(run_id, "provider_recovery", option["explanation"], operation_id=saved["id"], method=option["method"])
    task = asyncio.create_task(run_provider_recovery(run_id, incident, run, saved, contact, table))
    RUNNING_TASKS.add(task)
    task.add_done_callback(RUNNING_TASKS.discard)
    return {"run_id": run_id, "operation_id": saved["id"], "status": phase, "method": option["method"]}


async def run_provider_recovery(run_id: str, incident: dict, run: dict, saved: dict, contact: dict, table: str):
    """Recover and analyze ONE operation, then pause. Never resume the contact loop."""
    callback = table == "rescue_actions"
    update = (lambda **fields: update_action(saved["id"], **fields)) if callback else (lambda **fields: update_call(saved["id"], **fields))
    finish_recovery = finish_start if callback else finish
    try:
        if is_stopped(run_id):
            update(status="interrupted", error="Recovery stopped before making a provider request.")
            finish_recovery(run_id, "stopped", "Recovery stopped. No provider request was sent.")
            return
        # Never regenerate task, metadata, schema, recipient or idempotency key.
        provider_id, evidence = await calling.execute_saved_call(
            saved.get("provider_request_json"), saved["idempotency_key"], CALLE_API_KEY,
            (lambda **fields: update(**{**fields, "status": "contacting"})) if callback else update,
            provider_call_id=saved.get("provider_call_id"))
        evidence["provider_recovery"] = {"same_operation": True, "at": utc_now()}
        if not callback and ":followup:" in saved["idempotency_key"]:
            evidence["offer_followup"] = {"source_call_id": saved["idempotency_key"].split(":followup:", 1)[1], "information_only": True}
        update(status="analyzing", provider_call_id=provider_id, provider_status=evidence["provider_status"],
               evidence_json=json.dumps(evidence), error=None, provider_error_json=None)
        if evidence["provider_status"] == "completed" and not evidence["transcript"]:
            raise PlannerUnavailable("The saved call completed without a readable transcript. No further contact was called; inspect its CALL-E record.")
        if callback:
            assignments = json.loads(saved["assignments_json"])
            analysis = await planner.confirm_start(contact, assignments, evidence)
            approved = assignments[0]["assignment"].get("quote") or CostQuote().model_dump()
            price_ok, quote, note = check_callback_price(approved, evidence)
            analysis.update(cost_quote=quote, price_check=note, price_approved=price_ok)
            if analysis["status"] == "confirmed" and not price_ok:
                analysis.update(status="conditional", confirmed_requirement_ids=[], summary=note,
                                conditions=analysis.get("conditions", []) + [note])
            ready = analysis["status"] == "confirmed"
            update(status="confirmed" if ready else "needs_attention", progress="ready" if ready else "waiting", analysis_json=json.dumps(analysis))
            record_reasoning(run_id, analysis)
            with closing(connect()) as db:
                pending = db.execute("SELECT 1 FROM rescue_actions WHERE run_id=? AND status!='confirmed'", (run_id,)).fetchone()
            state = "active" if ready and not pending else "attention"
            finish_recovery(run_id, "stopped" if is_stopped(run_id) else state,
                            "The original callback result is saved. No other helper was called. Existing agreements may still be active.")
        else:
            analysis = await planner.analyze(incident, run["definition"], evidence, contact, run["plan"])
            new_needs = [n for n in analysis.get("new_requirements", []) if n["id"] not in {v["id"] for v in run["definition"]["requirements"]}]
            if len(run["definition"]["requirements"]) + len(new_needs) > 8:
                raise PlannerUnavailable("The recovered conversation contains too many needs to track safely. No other contact was called.")
            if new_needs:
                definition = {**run["definition"], "requirements": run["definition"]["requirements"] + new_needs}
                with closing(connect()) as db:
                    db.execute("UPDATE coordination_runs SET definition_json=? WHERE id=?", (json.dumps(definition), run_id))
                    db.commit()
            update(status="completed", analysis_json=json.dumps(analysis))
            record_reasoning(run_id, analysis)
            plan = get_run(run_id)["plan"]
            state = "covered" if plan["complete"] else "partial"
            finish_recovery(run_id, "stopped" if is_stopped(run_id) else state,
                            "The original inquiry result is saved for review. No next contact was called and no responder was engaged.")
    except asyncio.CancelledError:
        message = "Provider recovery was interrupted. The original request and key remain saved; no replacement call was created."
        update(status="interrupted", error=message)
        finish_recovery(run_id, "interrupted", message, message)
        raise
    except Exception as exc:
        message = str(exc) if isinstance(exc, (PlannerUnavailable, calling.CallUncertain)) else f"Provider recovery stopped ({type(exc).__name__}). No replacement call or next contact was created."
        update(status="needs_attention" if callback else "failed", error=message)
        finish_recovery(run_id, "attention" if callback else "failed", "Recovery paused. The original operation remains saved.", message)


@app.post("/api/runs/{run_id}/decisions/{decision_id}")
def record_decision(run_id: str, decision_id: str, body: DecisionUpdate):
    """Record the reporter's account of the assigned helper's assessment.

    No model decision, call, price increase, task replacement or automatic progress.
    A recorded result is immutable here; opposite branches cannot be switched on
    after work may have begun. Repeating an identical submission is a safe no-op.
    """
    if not body.confirmed_assessment:
        raise HTTPException(422, "Confirm that this is the assigned responder's reported assessment, not a guess.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Rescue not found")
        if row["mode"] != CALL_MODE:
            raise HTTPException(409, "This report belongs to another call setting.")
        run = hydrate_run(db, row)
        option = next((d for d in run["decision_options"] if d["id"] == decision_id), None)
        if not option:
            raise HTTPException(404, "Condition not found in the approved plan")
        prior = run["decision_results"].get(decision_id)
        if prior:
            if prior["value"] == body.value and prior["note"] == body.note:
                return {"status": "already_recorded", "result": prior, "calls_placed": 0}
            raise HTTPException(409, "This assessment is already recorded. It cannot be overwritten to activate the opposite branch; review changed circumstances with the helpers.")
        if body.plan_token != run["plan_token"]:
            raise HTTPException(409, "The plan changed. Refresh the latest assessment and branch rules before recording a result.")
        if not option["can_record"]:
            raise HTTPException(409, "Approve and confirm the assigned assessment helper first. The assessment task must belong to the active branch.")
        need = next(n for n in run["plan"]["requirements"] if n["id"] == option["assessed_by"])
        result = {"value": body.value, "note": body.note, "source": "reporter",
                  "assessor_requirement_id": need["id"], "assessor_contact_id": need["assignment"]["contact_id"],
                  "assessor_name": option["assessor_name"], "at": utc_now()}
        results = {**run["decision_results"], decision_id: result}
        db.execute("UPDATE coordination_runs SET decision_results_json=? WHERE id=?", (json.dumps(results), run_id))
        db.commit()
    emit(run_id, "assessment_reported", "You reported the assigned helper's assessment: " +
         ("YES" if body.value else "NO") + " for " + option["condition"] +
         ". Only the matching branch is eligible; no call or progress update was made.",
         source="reporter", decision_id=decision_id, value=body.value)
    return {"status": "recorded", "result": result, "calls_placed": 0}


@app.post("/api/actions/{action_id}/progress")
def update_progress(action_id: str, body: ProgressUpdate):
    """Progress is an explicit witness update, NEVER an AI guess or timer."""
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT a.*,r.mode,r.status run_status FROM rescue_actions a JOIN coordination_runs r ON r.id=a.run_id WHERE a.id=?", (action_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Helper not found")
        if row["mode"] != CALL_MODE:
            raise HTTPException(409, "This rescue belongs to another call setting.")
        if row["status"] != "confirmed" or row["run_status"] == "completed":
            raise HTTPException(409, "Only a confirmed helper in an open rescue can have progress recorded.")
        run_row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (row["run_id"],)).fetchone()
        definition = json.loads(run_row["definition_json"] or "null") or {}
        results = json.loads(run_row["decision_results_json"] or "{}")
        states = gate_states(definition, results)
        assignments = json.loads(row["assignments_json"])
        assigned_states = [states.get(n["id"], "pending") for n in assignments]
        if assigned_states and all(s == "not_needed" for s in assigned_states):
            raise HTTPException(409, "This helper's tasks are not needed for the reported branch. Do not mark unused work as performed.")
        if assigned_states and all(s in {"pending", "not_needed"} for s in assigned_states):
            raise HTTPException(409, "This helper is on standby. Record the assigned responder's assessment before updating gated work.")
        if body.progress == "finished" and "pending" in assigned_states:
            raise HTTPException(409, "A conditional task is still unresolved. Record the assessment; do not mark both branches finished.")
        stationary = all(kind(n) == "receiving_care" for n in assignments)
        sequence = ["ready", "arrived", "finished"] if stationary else ["ready", "on_the_way", "arrived", "finished"]
        try:
            valid = sequence.index(body.progress) == sequence.index(row["progress"]) + 1
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(409, "Record the next step only when you know it has happened.")
        updates = json.loads(row["progress_log_json"])
        updates.append({"progress": body.progress, "note": body.note, "source": "reporter", "at": utc_now()})
        db.execute("UPDATE rescue_actions SET progress=?,note=?,progress_log_json=?,updated_at=? WHERE id=?",
                   (body.progress, body.note, json.dumps(updates), utc_now(), action_id))
        db.commit()
    labels = {"on_the_way": "on the way", "arrived": "the animal has been received" if stationary else "arrived", "finished": "their part is done"}
    emit(row["run_id"], "progress", f"You reported that {row['business_name']}: {labels[body.progress]}.", source="reporter")
    return {"status": "updated", "progress": body.progress}


@app.post("/api/runs/{run_id}/complete")
def complete_rescue(run_id: str, body: CloseRescue):
    if not body.confirmed_safe:
        raise HTTPException(422, "Only close the rescue when you know the animal is safe.")
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM coordination_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Rescue not found")
        if row["mode"] != CALL_MODE or row["status"] != "active":
            raise HTTPException(409, "The rescue must be active in this call setting before it can be closed.")
        run = hydrate_run(db, row)
        actions = run["actions"]
        if any(n.get("gate_state") == "pending" for n in run["plan"]["requirements"]):
            raise HTTPException(409, "Record the remaining assessment before closing this conditional rescue.")
        if not actions or any(a["status"] != "confirmed" or (not a["not_required"] and a["progress"] != "finished") for a in actions):
            raise HTTPException(409, "Confirm each helper has finished their part first, except helpers not required by the recorded branch. Unused work must not be marked complete.")
        db.execute("UPDATE coordination_runs SET status='completed',execution_status='completed',completed_at=?,stop_reason=? WHERE id=?",
                   (utc_now(), "Closed by the person who reported the incident: " + body.note, run_id))
        db.execute("UPDATE incidents SET status='completed' WHERE id=?", (row["incident_id"],))
        db.commit()
    emit(run_id, "closed", "You confirmed that the animal is safe. " + body.note, source="reporter")
    return {"status": "completed"}
