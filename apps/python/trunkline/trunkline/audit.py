"""Append-only, hash-chained audit log.

Every entry carries the hash of the entry before it, so removing or editing a
line breaks the chain from that point onward and ``verify_chain`` reports where.
This does not stop an operator with write access from rewriting the whole file;
it makes a quiet edit of one record detectable, which is what an audit trail for
a payment-related disclosure needs to do.

Audit entries record which patient reference and which field *names* were
disclosed. They never record the values.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Optional, Tuple

GENESIS = "0" * 64


def audit_path(data_dir: str) -> str:
    return os.path.join(data_dir, "audit.log")


def _digest(previous: str, body: Dict[str, Any]) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((previous + canonical).encode("utf-8")).hexdigest()


def _last_hash(path: str) -> Tuple[str, int]:
    if not os.path.exists(path):
        return GENESIS, 0
    previous, seq = GENESIS, 0
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            previous = entry.get("hash", GENESIS)
            seq = int(entry.get("seq", seq))
    return previous, seq


def record(
    data_dir: str,
    *,
    actor: str,
    action: str,
    subject: str,
    detail: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    from .models import now_iso

    os.makedirs(data_dir, exist_ok=True)
    path = audit_path(data_dir)
    previous, seq = _last_hash(path)
    body = {
        "seq": seq + 1,
        "at": now_iso(),
        "actor": actor,
        "action": action,
        "subject": subject,
        "detail": detail or {},
        "prev": previous,
    }
    entry = dict(body)
    entry["hash"] = _digest(previous, body)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def read_all(data_dir: str) -> List[Dict[str, Any]]:
    path = audit_path(data_dir)
    if not os.path.exists(path):
        return []
    entries: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


@dataclass
class ChainCheck:
    ok: bool
    entries: int
    broken_at: Optional[int] = None
    reason: str = ""


def verify_chain(data_dir: str) -> ChainCheck:
    previous = GENESIS
    count = 0
    for entry in read_all(data_dir):
        count += 1
        body = {key: entry[key] for key in ("seq", "at", "actor", "action", "subject", "detail", "prev")}
        if entry.get("prev") != previous:
            return ChainCheck(False, count, int(entry.get("seq", count)), "previous hash does not match")
        if _digest(previous, body) != entry.get("hash"):
            return ChainCheck(False, count, int(entry.get("seq", count)), "entry hash does not match its contents")
        previous = entry["hash"]
    return ChainCheck(True, count)
