"""Place a DIALTONE-wrapped CALL-E call, then classify and attest the result.

Default is a preview: the compiled task and result schema are printed and
nothing is dialled. A real call needs ``--live`` and an explicit confirmation.

Raw CALL-E responses (with transcripts) go to data/real/raw/, which is
git-ignored. Only derived results - features, detection, verdict, timing,
masked numbers, no transcript text - go to data/real/results/.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from . import attestation, features, protocol
from .classifier import Classifier
from .models import Transcript

RAW_DIR = Path("data/real/raw")
RESULTS_DIR = Path("data/real/results")


def mask(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return f"+{digits[:-4][:2]}******{digits[-2:]}" if len(digits) > 6 else "***"


def build_request(to_phone: str, goal: str, principal: str, mode: str, nonce: str, region: str = "US",
                  locale: str = "en-US") -> dict[str, Any]:
    if not re.fullmatch(r"\+[1-9]\d{7,14}", to_phone):
        raise SystemExit("destination must be E.164, e.g. +14155550123")
    if mode == "dialtone":
        task = protocol.compile_task(goal, principal, nonce, language=locale)
    else:
        task = (f"GOAL: {goal}\nYou are an AI assistant calling on behalf of {principal}. Disclose that you are an AI "
                "assistant, be polite, and report exactly what the other party confirmed and any confirmation code.")
        if locale.startswith("fr"):
            task += "\nLANGUAGE: Conduct the whole conversation in French."
    return {
        "task": task,
        "recipients": [{"phones": [to_phone], "region": region, "locale": locale}],
        "result_schema": protocol.RESULT_SCHEMA,
        "metadata": {"app": "dialtone", "mode": mode, "protocol_version": protocol.VERSION, "task_prompt_revision": "2"},
    }


def _pickup_collision(t: Transcript, window: float = 1.5) -> bool:
    first = {}
    for turn in t.turns:
        if turn.offset_seconds is not None:
            first.setdefault(turn.speaker, turn.offset_seconds)
    return "bot" in first and "user" in first and max(first["bot"], first["user"]) < window


def fetch_events(call_id: str) -> list[dict]:
    """All realtime events for a call (paged)."""
    from calle import CalleClient

    out, cursor = [], None
    with CalleClient(api_key=os.environ["CALLE_API_KEY"]) as client:
        while True:
            page = client.calls.list_events(call_id, cursor=cursor, limit=100)
            out += page.get("data") or page.get("events") or []
            cursor = page.get("next_cursor")
            if not cursor:
                return out


def load_events(name: str) -> list[dict] | None:
    path = RAW_DIR / f"{name}.events.json"
    return json.loads(path.read_text()) if path.exists() else None


def analyse(call: dict, name: str, label: str | None, mode: str, nonce: str | None, clf: Classifier | None = None,
            events: list[dict] | None = None) -> dict:
    clf = clf or Classifier.load()
    events = events if events is not None else load_events(name)
    t = Transcript.from_calle_events(call, events, label) if events else Transcript.from_calle(call, label)
    if nonce is None and mode == "dialtone":
        nonce = protocol.inspect(t).nonce_expected
    t.meta["task"] = call.get("task") or t.meta.get("task")
    hs = protocol.inspect(t, nonce if mode == "dialtone" else None)
    points, ttd = clf.timeline(t, nonce=nonce)
    det = clf.classify(t, nonce=nonce)
    behaviour_only = clf.classify(t, use_protocol=False)
    structured = call.get("structured_result") or {}
    commitment = attestation.infer_commitment(t.meta.get("task"))
    verdict = attestation.evaluate(t, det, call.get("task_completed"), commitment, hs)
    return {
        "name": name,
        "label": label,
        "mode": mode,
        "calle_call_id": call.get("id"),
        "status": call.get("status"),
        "duration": round(t.duration, 1),
        "n_turns": len(t.turns),
        "timing_source": t.meta.get("timing_source", "transcript_turns"),
        "task_prompt_revision": (call.get("metadata") or {}).get("task_prompt_revision", "1" if mode == "dialtone" else None),
        "interruptions": t.meta.get("interruptions") or [],
        # Both sides started speaking in the first 1.5 s: the agent-to-agent pickup collision seen live.
        "pickup_collision": _pickup_collision(t),
        "handshake": {"offered": hs.offered, "acknowledged": hs.acknowledged, "nonce_ok": hs.nonce_ok,
                      "acknowledged_at": hs.acknowledged_at, "human_review": hs.human_review, "notes": hs.notes},
        "detection": det.to_dict(),
        "detection_behaviour_only": behaviour_only.to_dict(),
        "time_to_detection": ttd,
        "timeline": [{"t": w, "label": d.label, "conf": round(d.confidence, 3), "via": d.via} for w, d in points],
        "features": {k: round(v, 3) for k, v in features.extract(t).items()},
        "calle_reported": {"task_completed": call.get("task_completed"),
                           "completion_confidence": call.get("completion_confidence"),
                           "counterpart_type": structured.get("counterpart_type"),
                           "outcome": structured.get("outcome"),
                           "human_review": structured.get("human_review")},
        "verdict": verdict.to_dict(),
    }


def place(request: dict, name: str, timeout: float = 900, busy_wait: float = 1800) -> dict:
    import hashlib

    from calle import CalleClient
    from calle.errors import CalleRateLimitError

    key = os.environ.get("CALLE_API_KEY")
    if not key:
        raise SystemExit("CALLE_API_KEY is not set (add it to .env)")
    # Same request -> same key (safe network retries); a changed request (new nonce, locale) gets a new key.
    digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16]
    with CalleClient(api_key=key) as client:
        deadline = time.monotonic() + busy_wait
        while True:
            try:
                created = client.calls.create(**request, idempotency_key=f"dialtone-{name}-{digest}")
                break
            except CalleRateLimitError:
                # Free accounts run one call at a time; wait for the line instead of failing the run.
                if time.monotonic() > deadline:
                    raise
                print("line busy (account concurrency limit) - retrying in 20s", flush=True)
                time.sleep(20)
        print(f"created {created['id']} - waiting for the terminal result (Ctrl+C stops waiting, not the call)")
        started = time.monotonic()
        call = client.calls.wait_for_result(created["id"], interval_seconds=5, timeout_seconds=timeout)
        call["_dialtone_wall_seconds"] = round(time.monotonic() - started, 1)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"{name}.json").write_text(json.dumps(call, indent=1))
    try:
        (RAW_DIR / f"{name}.events.json").write_text(json.dumps(fetch_events(call["id"]), indent=1))
    except Exception as exc:  # events improve timing but are not required
        print(f"could not fetch events: {exc}")
    return call


def fetch(call_id: str, name: str) -> dict:
    from calle import CalleClient

    with CalleClient(api_key=os.environ["CALLE_API_KEY"]) as client:
        call = client.calls.get(call_id)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"{name}.json").write_text(json.dumps(call, indent=1))
    return call


def save_result(result: dict) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{result['name']}.json"
    path.write_text(json.dumps(result, indent=1))
    return path
