"""Redaction applied at ingest, before anything is written to disk.

Masking only at render time left raw phone numbers, card-like runs and
government-id-like runs sitting in the snapshot on disk, in the structured
result, and in whatever the evidence pass derived from them. A review console
does not need any of that at rest: it needs to know a number was *said*, not
what the number was.

The catch is that redacting the digits would also destroy the compliance signal
that depends on them -- "did the agent read a card number back down the line" is
exactly the thing a reviewer must be told. So the findings are computed first,
recorded on the snapshot, and only then are the digits removed. The verdict
survives; the PII does not.

Redaction is deliberately idempotent: masked text does not match the patterns
again, so a snapshot that passes through twice is unchanged.
"""
from __future__ import annotations

import re
from typing import Any

# +15550100123 -> +1********23. Same shape as compliance.mask_phone, applied to
# every string rather than only the recipient fields.
PHONE = re.compile(r"\+\d{7,15}")
# 12-19 digit runs, optionally spaced or hyphenated: card-like when spoken aloud.
CARD = re.compile(r"\b(?:\d[ -]?){12,19}\b")
# US SSN shape. Kept separate from CARD so the finding can name which it was.
GOV_ID = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

CARD_PLACEHOLDER = "[redacted-card]"
GOV_ID_PLACEHOLDER = "[redacted-gov-id]"


def mask_phone(phone: str) -> str:
    p = (phone or "").strip()
    if len(p) <= 4:
        return "****"
    return p[:2] + "*" * (len(p) - 4) + p[-2:]


def _redact_text(text: str) -> str:
    t = GOV_ID.sub(GOV_ID_PLACEHOLDER, text)
    t = CARD.sub(CARD_PLACEHOLDER, t)
    return PHONE.sub(lambda m: mask_phone(m.group(0)), t)


def _walk(value: Any, fn) -> Any:
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_walk(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _walk(v, fn) for k, v in value.items()}
    return value


def findings(task: dict) -> dict:
    """What sensitive shapes appear anywhere in the snapshot, before redaction."""
    seen = {"phone": False, "card": False, "gov_id": False}

    def look(s: str) -> str:
        if PHONE.search(s):
            seen["phone"] = True
        if CARD.search(s):
            seen["card"] = True
        if GOV_ID.search(s):
            seen["gov_id"] = True
        return s

    _walk(task, look)
    return seen


def redact(task: dict) -> dict:
    """A copy of ``task`` with PII removed and the findings recorded on it.

    ``metadata.pii`` keeps the answer to "was a card read back", which the
    compliance check would otherwise have to re-derive from digits that are no
    longer there.
    """
    found = findings(task)
    clean = _walk(task, _redact_text)
    if not isinstance(clean, dict):  # pragma: no cover - snapshots are objects
        return clean
    meta = clean.setdefault("metadata", {})
    if isinstance(meta, dict):
        # Merge rather than overwrite. A second pass over already-clean data
        # finds nothing, and must not erase what the first pass recorded.
        prior = meta.get("pii") if isinstance(meta.get("pii"), dict) else {}
        meta["pii"] = {k: bool(found.get(k)) or bool(prior.get(k)) for k in found}
    return clean
