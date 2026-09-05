"""Snapshots and reviews. JSON files on disk (fixtures + anything ingested), in-memory index. No database."""
from __future__ import annotations

import json
import os
from pathlib import Path

from . import compliance

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.getenv("CRC_DATA_DIR", ROOT / "data"))
FIXTURES = ROOT / "fixtures"


def _load_dir(d: Path) -> dict[str, dict]:
    out = {}
    for p in sorted(d.glob("*.json")):
        try:
            j = json.loads(p.read_text())
            if j.get("object") == "call_task" and j.get("id"):
                out[j["id"]] = j
        except Exception:
            continue
    return out


def load_all() -> dict[str, dict]:
    tasks = _load_dir(FIXTURES)
    if DATA.exists():
        tasks.update(_load_dir(DATA))
    return tasks


def save(task: dict) -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    p = DATA / f"{task['id']}.json"
    p.write_text(json.dumps(task, indent=1))
    return p


def save_review_note(call_id: str, note: dict) -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    p = DATA / f"{call_id}.review.json"
    p.write_text(json.dumps(note, indent=1))
    return p


def review_note(call_id: str) -> dict | None:
    p = DATA / f"{call_id}.review.json"
    return json.loads(p.read_text()) if p.exists() else None


def masked(task: dict) -> dict:
    """A copy safe to render: every phone number masked, everywhere it appears."""
    t = json.loads(json.dumps(task))
    for r in t.get("recipients") or []:
        r["phones"] = [compliance.mask_phone(p) for p in r.get("phones") or []]
        for a in r.get("attempts") or []:
            if a.get("phone"):
                a["phone"] = compliance.mask_phone(a["phone"])
    import re
    t["task"] = re.sub(r"\+\d{7,15}", lambda m: compliance.mask_phone(m.group(0)), t.get("task") or "")
    return t
