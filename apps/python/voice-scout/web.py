"""Browser demo for Voice Scout with preview and short-lived BYOK live calls."""
from __future__ import annotations

import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from calle import CalleClient
from flask import Flask, jsonify, render_template, request

from app import idempotency_key, mask_phone, preview, safe_lead

app = Flask(__name__, template_folder=str(Path(__file__).parent / "templates"))
DEMO_ENABLE_LIVE = os.environ.get("DEMO_ENABLE_LIVE", "false").lower() == "true"
MAX_CONCURRENT = max(1, int(os.environ.get("DEMO_MAX_CONCURRENT", "2")))
JOB_TTL_SECONDS = 15 * 60
PHONE_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
GOAL_RE = re.compile(r"^goal_[a-z0-9]+$")
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def build_lead(data: dict, phone: str) -> dict:
    return {
        "id": "web-demo-" + uuid.uuid4().hex[:12],
        "business_name": (data.get("business_name") or "Demo Business").strip()[:120],
        "industry": (data.get("industry") or "General business").strip()[:120],
        "phone": phone,
        "lead_source": "public_demo",
        "known_company_size": (data.get("company_size") or "unknown").strip()[:80],
        "known_workflow": (data.get("workflow") or "").strip()[:500],
        "known_pain_points": (data.get("pain_points") or "").strip()[:500],
    }


def _cleanup_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with JOBS_LOCK:
        for job_id in [k for k, v in JOBS.items() if v.get("created", 0) < cutoff]:
            del JOBS[job_id]


def _active_jobs() -> int:
    return sum(1 for job in JOBS.values() if job.get("status") in {"starting", "running"})


def _run_byok(job_id: str, lead: dict, api_key: str, goal_id: str) -> None:
    try:
        client = CalleClient(api_key=api_key)
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "running"
        variables = {
            "lead_source": str(lead.get("lead_source", "")),
            "known_company_size": str(lead.get("known_company_size", "")),
            "known_workflow": str(lead.get("known_workflow", "")),
            "known_pain_points": str(lead.get("known_pain_points", "")),
            "business_name": str(lead["business_name"]),
            "industry": str(lead["industry"]),
        }
        run = client.goals.run(
            goal_id=goal_id,
            phone=lead["phone"],
            variables=variables,
            idempotency_key=idempotency_key(lead["id"]),
        )
        run_id = run.get("id")
        if run.get("result") is None and run.get("error") is None and run_id:
            run = client.goals.wait_for_result(goal_id, str(run_id), timeout_seconds=600)
        result = {"mode": "live", "lead": safe_lead(lead), "run": run}
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id].update(status="completed", result=result, finished=time.time())
    except Exception as exc:
        # Return only a coarse provider category; never expose raw exceptions or request data.
        response = getattr(exc, "response", None)
        status_code = getattr(exc, "status_code", None) or getattr(response, "status_code", None)
        if status_code in (401, 403):
            message = "CALL-E rejected the API key (HTTP %s). Check that the key is active and belongs to this account." % status_code
        elif status_code == 404:
            message = "CALL-E could not find that Goal ID (HTTP 404). Check that the Goal is published and belongs to this account."
        elif status_code == 402:
            message = "CALL-E rejected the request (HTTP 402). Check account credits or billing status."
        elif status_code == 429:
            message = "CALL-E rate-limited this request (HTTP 429). Wait a moment and try again."
        elif status_code in (400, 422):
            message = "CALL-E rejected the request (HTTP %s). Check the Goal variables and E.164 phone number." % status_code
        elif status_code is not None:
            message = "CALL-E returned an error (HTTP %s). No call result was returned." % status_code
        else:
            message = "CALL-E could not complete the run. Check the API key, Goal ID, phone number, and account credits."
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id].update(status="error", error=message, finished=time.time())
    finally:
        # Drop the client/key references as soon as the job is finished.
        client = None
        api_key = ""


@app.get("/health")
def health():
    return jsonify({"ok": True, "live_demo_enabled": DEMO_ENABLE_LIVE})


@app.get("/")
def index():
    return render_template("index.html", live_enabled=DEMO_ENABLE_LIVE)


@app.post("/api/preview")
def api_preview():
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    if not PHONE_RE.fullmatch(phone):
        phone = "+15550000000"
    return jsonify(preview(build_lead(data, phone)))


@app.post("/api/live")
def api_live():
    _cleanup_jobs()
    if not DEMO_ENABLE_LIVE:
        return jsonify({"error": "Live demo is disabled; preview mode is available."}), 403
    data = request.get_json(silent=True) or {}
    api_key = str(data.get("api_key", "")).strip()
    goal_id = str(data.get("goal_id", "")).strip()
    phone = str(data.get("phone", "")).strip()
    if len(api_key) < 20:
        return jsonify({"error": "Enter a valid-looking CALL-E API key. It is used temporarily and not stored."}), 400
    if not GOAL_RE.fullmatch(goal_id):
        return jsonify({"error": "Goal ID must look like goal_..."}), 400
    if not PHONE_RE.fullmatch(phone):
        return jsonify({"error": "Phone must be E.164 format, such as +15551234567."}), 400
    if data.get("confirm") is not True:
        return jsonify({"error": "Confirm that you own or have permission to call this number."}), 400
    lead = build_lead(data, phone)
    with JOBS_LOCK:
        if _active_jobs() >= MAX_CONCURRENT:
            return jsonify({"error": "The demo is at its live-call capacity. Try again later."}), 429
        job_id = uuid.uuid4().hex
        JOBS[job_id] = {"status": "starting", "created": time.time()}
    threading.Thread(target=_run_byok, args=(job_id, lead, api_key, goal_id), daemon=True).start()
    return jsonify({"job_id": job_id, "status": "starting", "phone": mask_phone(phone)}), 202


@app.get("/api/live/<job_id>")
def api_job(job_id: str):
    _cleanup_jobs()
    with JOBS_LOCK:
        job = dict(JOBS.get(job_id, {}))
    if not job:
        return jsonify({"error": "Job not found or expired."}), 404
    job.pop("created", None)
    job.pop("finished", None)
    return jsonify(job)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "18901")))
