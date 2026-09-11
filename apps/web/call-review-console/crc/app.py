"""Call Review Console — FastAPI app. Fixtures by default; webhook receiver; opt-in live fetch by id."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from . import live, review, security, store
from .security import UnsafeCallId, UnsafeOrigin, safe_call_id


def require_console(request: Request) -> None:
    """Every transcript-bearing route requires the console token.

    Transcripts, results and review notes are caller data, and ``/api/fetch``
    spends the CALL-E API key, so none of it may be reachable unauthenticated.
    Send ``CRC_CONSOLE_TOKEN`` as ``X-CRC-Console`` or a bearer token. When it
    is not configured the server generates one per process and prints it at
    startup, so the fixture demo runs out of the box without ever serving an
    anonymous console.
    """
    presented = request.headers.get("x-crc-console") or ""
    if not presented:
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            presented = auth[7:]
    if not security.token_matches(presented):
        raise HTTPException(401, "missing or wrong X-CRC-Console token")


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    print(security.startup_banner(), flush=True)
    yield


app = FastAPI(title="Call Review Console", lifespan=_lifespan)
STATIC = Path(__file__).resolve().parents[1] / "static"
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
USE_LLM = os.getenv("CRC_USE_LLM", "false").lower() == "true"


@app.get("/", response_class=HTMLResponse)
def index():
    """The shell only. It carries no call data and fetches with the token the
    operator pastes in, so it stays reachable in order to prompt for one."""
    return (STATIC / "index.html").read_text()


@app.get("/api/calls", dependencies=[Depends(require_console)])
def calls():
    out = []
    for cid, t in store.load_all().items():
        r = review.review(t, schema=(t.get("metadata") or {}).get("result_schema"), use_llm=False)
        note = store.review_note(cid) or {}
        out.append({"id": cid, "status": t.get("status"), "task": store.masked(t)["task"], "task_completed": t.get("task_completed"), "confidence": (t.get("completion_confidence") or {}).get("score"), "verdict": r["verdict"], "reasons": r["reasons"], "p50": r["timing"]["response_p50_s"], "p95": r["timing"]["response_p95_s"], "unsupported": r["unsupported_count"], "reviewed": bool(note), "human_verdict": note.get("verdict"), "source": "fixture" if (t.get("metadata") or {}).get("fixture") else "ingested"})
    return sorted(out, key=lambda x: (x["verdict"] == "approve", x["id"]))


@app.get("/api/calls/{call_id}", dependencies=[Depends(require_console)])
def call(call_id: str, llm: bool = False):
    try:
        call_id = safe_call_id(call_id)
    except UnsafeCallId:
        raise HTTPException(400, "malformed call id") from None
    t = store.load_all().get(call_id)
    if not t:
        raise HTTPException(404)
    r = review.review(t, schema=(t.get("metadata") or {}).get("result_schema"), use_llm=llm or USE_LLM)
    return {"task": store.masked(t), "review": r, "note": store.review_note(call_id)}


class Note(BaseModel):
    verdict: str
    note: str = ""
    reviewer: str = "reviewer"

    @field_validator("verdict")
    @classmethod
    def _known_verdict(cls, v: str) -> str:
        if v not in {"approve", "needs_human", "reject"}:
            raise ValueError("verdict must be approve, needs_human or reject")
        return v


@app.post("/api/calls/{call_id}/note", dependencies=[Depends(require_console)])
def note(call_id: str, body: Note):
    try:
        call_id = safe_call_id(call_id)
    except UnsafeCallId:
        raise HTTPException(400, "malformed call id") from None
    if call_id not in store.load_all():
        raise HTTPException(404)
    import datetime as dt
    n = {"verdict": body.verdict, "note": body.note[:2000], "reviewer": body.reviewer[:80], "reviewed_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    store.save_review_note(call_id, n)
    return n


@app.post("/calle/webhook")
async def webhook(request: Request):
    """Terminal-event receiver (call.completed / call.failed / call.result_validation_failed). Stores the snapshot.
    CALL-E deliveries are unsigned (SDK 0.7), so CRC_WEBHOOK_TOKEN is required and must be sent in the
    X-CRC-Token header. With no token configured the endpoint refuses every delivery rather than storing
    payloads from whoever finds the URL."""
    token = security.webhook_token()
    if not token:
        # Fail closed: an unconfigured receiver must not accept and store
        # caller payloads from anyone who finds the URL.
        raise HTTPException(
            503,
            "CRC_WEBHOOK_TOKEN is not set; this receiver refuses deliveries until it is. "
            "CALL-E deliveries are unsigned, so the token is the only thing "
            "distinguishing a real delivery from anyone who knows the URL.",
        )
    if not security.token_matches(request.headers.get("x-crc-token"), token):
        raise HTTPException(401, "missing or wrong X-CRC-Token")
    body = await request.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not data or data.get("object") != "call_task" or not data.get("id"):
        raise HTTPException(400, "expected a CALL-E webhook event with a call_task in data")
    try:
        # The id becomes a filename and reaches the browser; it is the one field
        # in an unsigned delivery that must not be taken on trust.
        cid = safe_call_id(data.get("id"))
    except UnsafeCallId:
        raise HTTPException(400, "malformed call id") from None
    data["id"] = cid
    data.setdefault("metadata", {})["webhook_event"] = body.get("type")
    store.save(data)
    return {"ok": True, "stored": cid}


class Fetch(BaseModel):
    call_id: str


@app.post("/api/fetch", dependencies=[Depends(require_console)])
def fetch(body: Fetch):
    """Opt-in: pull one existing call task by id with CALLE_API_KEY. Never creates a call."""
    try:
        t = live.fetch_call(body.call_id)
    except (UnsafeCallId, UnsafeOrigin) as e:
        raise HTTPException(400, str(e)) from None
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"fetch failed: {str(e)[:200]}")
    store.save(t)
    return {"ok": True, "stored": t.get("id")}


@app.get("/api/benchmark", dependencies=[Depends(require_console)])
def benchmark():
    """Across every call on file: completion, evidence and latency. Fixtures are synthetic and labelled as such."""
    rows = []
    for cid, t in store.load_all().items():
        r = review.review(t, schema=(t.get("metadata") or {}).get("result_schema"), use_llm=False)
        rows.append({"id": cid, "source": "fixture" if (t.get("metadata") or {}).get("fixture") else "ingested", "status": t.get("status"), "task_completed": t.get("task_completed"), "p50": r["timing"]["response_p50_s"], "p95": r["timing"]["response_p95_s"], "silences": r["timing"]["silences_over_threshold"], "overlaps": r["timing"]["overlaps"], "unsupported": r["unsupported_count"], "ai_disclosed": r["compliance"]["ai_disclosed"], "verdict": r["verdict"]})
    lat = sorted(x["p50"] for x in rows if x["p50"] is not None)
    agg = {"calls": len(rows), "completed": sum(1 for x in rows if x["status"] == "completed"), "task_completed": sum(1 for x in rows if x["task_completed"]), "approve": sum(1 for x in rows if x["verdict"] == "approve"), "needs_human": sum(1 for x in rows if x["verdict"] == "needs_human"), "reject": sum(1 for x in rows if x["verdict"] == "reject"), "median_p50_s": lat[len(lat) // 2] if lat else None, "unsupported_claims": sum(x["unsupported"] for x in rows), "sources": sorted({x["source"] for x in rows})}
    return {"aggregate": agg, "rows": rows}


@app.get("/api/health", dependencies=[Depends(require_console)])
def health():
    return {"ok": True, "calls_on_file": len(store.load_all()), "live_fetch_enabled": bool(os.getenv("CALLE_API_KEY")), "llm": USE_LLM}


@app.get("/api/ping")
def ping():
    """Unauthenticated liveness only: says nothing about the calls on file.

    The one exception is a deployment that has declared itself a fixtures-only
    public demo, which publishes its own console token here so the hosted link
    is usable. See ``security.demo_mode`` for what that costs.
    """
    body = {"ok": True, "auth_required": True, "demo": security.demo_mode()}
    if security.demo_mode():
        body["demo_token"] = security.console_token()
    return body
