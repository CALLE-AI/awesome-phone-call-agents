"""Call Review Console — FastAPI app. Fixtures by default; webhook receiver; opt-in live fetch by id."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import live, review, store

app = FastAPI(title="Call Review Console")
STATIC = Path(__file__).resolve().parents[1] / "static"
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
USE_LLM = os.getenv("CRC_USE_LLM", "false").lower() == "true"


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC / "index.html").read_text()


@app.get("/api/calls")
def calls():
    out = []
    for cid, t in store.load_all().items():
        r = review.review(t, schema=(t.get("metadata") or {}).get("result_schema"), use_llm=False)
        note = store.review_note(cid) or {}
        out.append({"id": cid, "status": t.get("status"), "task": store.masked(t)["task"], "task_completed": t.get("task_completed"), "confidence": (t.get("completion_confidence") or {}).get("score"), "verdict": r["verdict"], "reasons": r["reasons"], "p50": r["timing"]["response_p50_s"], "p95": r["timing"]["response_p95_s"], "unsupported": r["unsupported_count"], "reviewed": bool(note), "human_verdict": note.get("verdict"), "source": "fixture" if (t.get("metadata") or {}).get("fixture") else "ingested"})
    return sorted(out, key=lambda x: (x["verdict"] == "approve", x["id"]))


@app.get("/api/calls/{call_id}")
def call(call_id: str, llm: bool = False):
    t = store.load_all().get(call_id)
    if not t:
        raise HTTPException(404)
    r = review.review(t, schema=(t.get("metadata") or {}).get("result_schema"), use_llm=llm or USE_LLM)
    return {"task": store.masked(t), "review": r, "note": store.review_note(call_id)}


class Note(BaseModel):
    verdict: str
    note: str = ""
    reviewer: str = "reviewer"


@app.post("/api/calls/{call_id}/note")
def note(call_id: str, body: Note):
    if call_id not in store.load_all():
        raise HTTPException(404)
    import datetime as dt
    n = {"verdict": body.verdict, "note": body.note[:2000], "reviewer": body.reviewer[:80], "reviewed_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    store.save_review_note(call_id, n)
    return n


@app.post("/calle/webhook")
async def webhook(request: Request):
    """Terminal-event receiver (call.completed / call.failed / call.result_validation_failed). Stores the snapshot.
    CALL-E deliveries are unsigned (SDK 0.7), so when CRC_WEBHOOK_TOKEN is set the request must carry it in the
    X-CRC-Token header; otherwise put the endpoint behind your proxy's own check."""
    token = os.getenv("CRC_WEBHOOK_TOKEN")
    if token and request.headers.get("x-crc-token") != token:
        raise HTTPException(401, "missing or wrong X-CRC-Token")
    body = await request.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not data or data.get("object") != "call_task" or not data.get("id"):
        raise HTTPException(400, "expected a CALL-E webhook event with a call_task in data")
    data.setdefault("metadata", {})["webhook_event"] = body.get("type")
    store.save(data)
    return {"ok": True, "stored": data["id"]}


class Fetch(BaseModel):
    call_id: str


@app.post("/api/fetch")
def fetch(body: Fetch):
    """Opt-in: pull one existing call task by id with CALLE_API_KEY. Never creates a call."""
    try:
        t = live.fetch_call(body.call_id)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"fetch failed: {str(e)[:200]}")
    store.save(t)
    return {"ok": True, "stored": t.get("id")}


@app.get("/api/benchmark")
def benchmark():
    """Across every call on file: completion, evidence and latency. Fixtures are synthetic and labelled as such."""
    rows = []
    for cid, t in store.load_all().items():
        r = review.review(t, schema=(t.get("metadata") or {}).get("result_schema"), use_llm=False)
        rows.append({"id": cid, "source": "fixture" if (t.get("metadata") or {}).get("fixture") else "ingested", "status": t.get("status"), "task_completed": t.get("task_completed"), "p50": r["timing"]["response_p50_s"], "p95": r["timing"]["response_p95_s"], "silences": r["timing"]["silences_over_threshold"], "overlaps": r["timing"]["overlaps"], "unsupported": r["unsupported_count"], "ai_disclosed": r["compliance"]["ai_disclosed"], "verdict": r["verdict"]})
    lat = sorted(x["p50"] for x in rows if x["p50"] is not None)
    agg = {"calls": len(rows), "completed": sum(1 for x in rows if x["status"] == "completed"), "task_completed": sum(1 for x in rows if x["task_completed"]), "approve": sum(1 for x in rows if x["verdict"] == "approve"), "needs_human": sum(1 for x in rows if x["verdict"] == "needs_human"), "reject": sum(1 for x in rows if x["verdict"] == "reject"), "median_p50_s": lat[len(lat) // 2] if lat else None, "unsupported_claims": sum(x["unsupported"] for x in rows), "sources": sorted({x["source"] for x in rows})}
    return {"aggregate": agg, "rows": rows}


@app.get("/api/health")
def health():
    return {"ok": True, "calls_on_file": len(store.load_all()), "live_fetch_enabled": bool(os.getenv("CALLE_API_KEY")), "llm": USE_LLM}
