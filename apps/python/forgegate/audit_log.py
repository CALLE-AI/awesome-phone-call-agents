"""Flat JSONL audit trail: incident, task text, call id, transcript-backed
decision, final action state, timestamps.

Thread-safe via reentrant lock (threading.RLock), avoiding reset deadlocks.
Preserves ambiguous incident intent and masks credentials / phones at storage boundary.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import safety

LOG_DIR = Path(os.environ.get("FORGEGATE_LOG_DIR", Path(__file__).parent / "data"))
LOG_PATH = LOG_DIR / "audit_log.jsonl"
ACTIVITY_PATH = LOG_DIR / "activity_feed.jsonl"

_lock = threading.RLock()


def _ensure_log_dir() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def append_entry(entry: dict) -> dict:
    _ensure_log_dir()
    sanitized = dict(entry)
    sanitized.setdefault("timestamp", datetime.now(timezone.utc).isoformat())

    # Mask any free text fields before writing
    for field in ("task_text", "reason", "transcript_evidence", "error", "description", "proposed_action", "post_action_reason"):
        if field in sanitized and isinstance(sanitized[field], str):
            sanitized[field] = safety.mask_text(sanitized[field])

    with _lock:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(sanitized) + "\n")
    return sanitized


def read_all() -> List[dict]:
    with _lock:
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


def get_latest_for_incident(incident_id: str) -> Optional[dict]:
    entries = read_for_incident(incident_id)
    return entries[-1] if entries else None


def has_existing_call(incident_id: str) -> Optional[dict]:
    """Returns prior entry with a call_id or active dispatch for this incident, if any.
    Used to enforce idempotency and prevent duplicate calls."""
    for entry in read_for_incident(incident_id):
        if entry.get("call_id") or entry.get("disposition") in ("DISPATCH_FAILED", "UNCLEAR", "NO_ANSWER"):
            return entry
    return None


def has_unreconciled_incident(incident_id: str) -> Optional[dict]:
    """Detects whether an incident has a prior recorded state (call, auto-cleared,
    or ambiguous/held) that prevents redispatch without explicit operator reconciliation."""
    entries = read_for_incident(incident_id)
    if not entries:
        return None
    latest = entries[-1]
    # If the latest entry already resolved via a post-action, or is recorded, return it
    return latest


def clear_all() -> None:
    """Removes the audit log and activity feed files so the exchange can be cleanly reset.
    Thread-safe and deadlock-free under reentrant lock."""
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
        "detail": safety.mask_text(detail),
    }
    with _lock:
        ACTIVITY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with ACTIVITY_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    return entry


def read_activity(limit: int = 100) -> List[dict]:
    with _lock:
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
