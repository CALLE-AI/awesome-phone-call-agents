"""Snapshots and reviews. JSON files on disk (fixtures + anything ingested), in-memory index. No database."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from . import compliance, sanitize
from .security import UnsafeCallId, safe_call_id

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.getenv("CRC_DATA_DIR", ROOT / "data"))
FIXTURES = ROOT / "fixtures"


def _within(base: Path, name: str) -> Path:
    """Resolve ``name`` under ``base`` and refuse anything that escapes it.

    ``safe_call_id`` already rejects separators; this is the second line, so a
    future caller that forgets to validate still cannot write outside the
    directory.
    """
    p = (base / name).resolve()
    if not p.is_relative_to(base.resolve()):
        raise UnsafeCallId(f"path escapes the data directory: {name!r}")
    return p


def _load_dir(d: Path) -> dict[str, dict]:
    out = {}
    for p in sorted(d.glob("*.json")):
        try:
            j = json.loads(p.read_text())
            if j.get("object") != "call_task":
                continue
            # An id that would be unsafe to write is also unsafe to serve: it
            # reaches the browser inside a JS string literal.
            out[safe_call_id(j.get("id"))] = j
        except (UnsafeCallId, Exception):
            continue
    return out


def load_all() -> dict[str, dict]:
    tasks = _load_dir(FIXTURES)
    if DATA.exists():
        tasks.update(_load_dir(DATA))
    return tasks


def save(task: dict) -> Path:
    """Persist a snapshot under its own id.

    The id arrives from a webhook body or the CALL-E API, so it is validated
    before it is allowed anywhere near a path: ``../`` in an id would otherwise
    write outside the data directory.
    """
    cid = safe_call_id(task.get("id"))
    # Redact before the snapshot touches disk. Rendering-time masking left raw
    # numbers in the file, in the structured result, and in anything the
    # evidence pass derived from them.
    clean = sanitize.redact(task)
    clean["id"] = cid
    DATA.mkdir(parents=True, exist_ok=True)
    p = _within(DATA, f"{cid}.json")
    p.write_text(json.dumps(clean, indent=1))
    return p


def save_review_note(call_id: str, note: dict) -> Path:
    cid = safe_call_id(call_id)
    DATA.mkdir(parents=True, exist_ok=True)
    p = _within(DATA, f"{cid}.review.json")
    p.write_text(json.dumps(note, indent=1))
    return p


def review_note(call_id: str) -> dict | None:
    try:
        cid = safe_call_id(call_id)
    except UnsafeCallId:
        return None
    p = _within(DATA, f"{cid}.review.json")
    return json.loads(p.read_text()) if p.exists() else None


_PHONE_IN_TEXT = re.compile(r"\+\d{7,15}")


def _mask_text(value: str) -> str:
    return _PHONE_IN_TEXT.sub(lambda m: compliance.mask_phone(m.group(0)), value)


def _mask_deep(value):
    """Mask phone-shaped runs in every string anywhere in the structure.

    Masking only ``recipients`` and ``task`` left numbers exposed in the two
    places a caller is most likely to say one out loud: transcript turns and the
    model's structured result. Both are rendered in the console.
    """
    if isinstance(value, str):
        return _mask_text(value)
    if isinstance(value, list):
        return [_mask_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: _mask_deep(v) for k, v in value.items()}
    return value


def masked(task: dict) -> dict:
    """A copy safe to render: every phone number masked, everywhere it appears."""
    t = json.loads(json.dumps(task))
    for r in t.get("recipients") or []:
        r["phones"] = [compliance.mask_phone(p) for p in r.get("phones") or []]
        for a in r.get("attempts") or []:
            if a.get("phone"):
                a["phone"] = compliance.mask_phone(a["phone"])
    return _mask_deep(t)
