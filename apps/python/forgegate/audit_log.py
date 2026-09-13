"""Flat JSONL audit trail: incident, task text, call id, transcript-backed
decision, final action state, timestamps.

Deliberately not SQLite — this is a hackathon MVP and a flat append-only
file is enough to demo and enough to grep during the recording.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

LOG_DIR = Path(os.environ.get("FORGEGATE_LOG_DIR", Path(__file__).parent / "data"))
LOG_PATH = LOG_DIR / "audit_log.jsonl"
ACTIVITY_PATH = LOG_DIR / "activity_feed.jsonl"

_lock = threading.Lock()


def _ensure_log_dir() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def append_entry(entry: dict) -> dict:
    _ensure_log_dir()
    entry = dict(entry)
    entry.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    with _lock:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    return entry


def read_all() -> List[dict]:
    if not LOG_PATH.exists():
        return []
    entries = []
    with LOG_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def read_for_incident(incident_id: str) -> List[dict]:
    return [e for e in read_all() if e.get("incident_id") == incident_id]


def has_existing_call(incident_id: str) -> Optional[dict]:
    """Returns the prior entry with a call_id for this incident, if any.
    The app layer uses this to enforce idempotency: a retry or double-POST
    of the same incident_id must not place a second call."""
    for entry in read_for_incident(incident_id):
        if entry.get("call_id"):
            return entry
    return None


def clear_all() -> None:
    """Removes the audit log file so the exchange can be cleanly reset."""
    with _lock:
        if LOG_PATH.exists():
            LOG_PATH.unlink()
    clear_activity()


def append_activity(event: str, incident_id: str, detail: str) -> dict:
    _ensure_log_dir()
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "incident_id": incident_id,
        "detail": detail,
    }
    with _lock:
        ACTIVITY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with ACTIVITY_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    return entry


def read_activity(limit: int = 100) -> List[dict]:
    if not ACTIVITY_PATH.exists():
        return []
    entries = []
    with ACTIVITY_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries[-limit:]


def clear_activity() -> None:
    with _lock:
        if ACTIVITY_PATH.exists():
            ACTIVITY_PATH.unlink()
