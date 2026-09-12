"""Small browser demo for Voice Scout. Preview is public; live calls are gated."""
from __future__ import annotations

import os
from pathlib import Path
from flask import Flask, jsonify, render_template, request

from app import load_lead, preview, run_live

app = Flask(__name__, template_folder=str(Path(__file__).parent / "templates"))
DEMO_PHONE = os.environ.get("DEMO_PHONE", "")
DEMO_ENABLE_LIVE = os.environ.get("DEMO_ENABLE_LIVE", "false").lower() == "true"
DEMO_OPERATOR_TOKEN = os.environ.get("DEMO_OPERATOR_TOKEN", "")


def build_lead(data: dict) -> dict:
    return {
        "id": "web-demo-business",
        "business_name": (data.get("business_name") or "Demo Business").strip()[:120],
        "industry": (data.get("industry") or "General business").strip()[:120],
        "phone": DEMO_PHONE,
        "lead_source": "public_demo",
        "known_company_size": (data.get("company_size") or "unknown").strip()[:80],
        "known_workflow": (data.get("workflow") or "").strip()[:500],
        "known_pain_points": (data.get("pain_points") or "").strip()[:500],
    }


@app.get("/health")
def health():
    return jsonify({"ok": True, "live_demo_enabled": DEMO_ENABLE_LIVE and bool(DEMO_PHONE)})


@app.get("/")
def index():
    return render_template("index.html", live_enabled=DEMO_ENABLE_LIVE and bool(DEMO_PHONE))


@app.post("/api/preview")
def api_preview():
    lead = build_lead(request.get_json(silent=True) or {})
    return jsonify(preview(lead))


@app.post("/api/live")
def api_live():
    if not DEMO_ENABLE_LIVE or not DEMO_PHONE:
        return jsonify({"error": "Live demo is disabled; preview mode is available."}), 403
    if not DEMO_OPERATOR_TOKEN or request.headers.get("X-Demo-Token") != DEMO_OPERATOR_TOKEN:
        return jsonify({"error": "Operator authorization required."}), 401
    try:
        return jsonify(run_live(build_lead(request.get_json(silent=True) or {})))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "18901")))
