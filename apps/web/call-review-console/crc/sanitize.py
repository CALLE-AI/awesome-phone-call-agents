"""Redaction applied at ingest, before anything is written to disk.

Masking only at render time left raw contact details sitting in the snapshot on
disk, in the structured result, and in whatever the evidence pass derived from
them. A review console does not need any of that at rest: it needs to know a
number was *said*, not what the number was.

Two things make this harder than one regex.

**Spoken and written numbers are not E.164.** A transcript says
``+1 555 010 0123``, ``(555) 010-0123`` or ``555.010.0123``. Matching only
``\\+\\d{7,15}`` caught none of those. Candidates are therefore found loosely --
any run of digits and separators -- and then accepted or rejected by counting
the digits in them.

**Timestamps look exactly like phone numbers to a loose matcher.**
``2026-09-04T15:03:06Z`` is eight digits with separators, and these snapshots
are full of them. Redacting those would corrupt every ``created_at`` and break
the timing analysis, so datetimes, times, dates and durations are protected
before any redaction runs and restored afterwards.

The compliance signal is preserved across all of it: findings are computed
*before* the digits are removed and recorded on ``metadata.pii``, so "the agent
read a card number back" is still reported without keeping the number.

Redaction is idempotent -- redacted text no longer matches -- and a second pass
merges the recorded findings rather than overwriting them.
"""
from __future__ import annotations

import re
from typing import Any

# --- things that must survive, protected before anything is redacted --------
# ISO-8601 datetimes, plain dates, clock times, and decimal durations. Ordered
# longest-first so a full timestamp is protected as one unit.
KEEP = re.compile(
    r"""
    \d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?  # datetime
  | \d{4}-\d{2}-\d{2}                                                              # date
  | \d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?                                     # clock time
  | (?<![\d.])\d{1,4}\.\d{1,3}(?![\d.])                                             # decimal, but
    #   not one group of a dotted phone number: 555.010.0123 must stay redactable,
    #   so a decimal may not touch another dot or digit on either side.
    """,
    re.X | re.I,
)

EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
GOV_ID = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

#: Any run of digits with optional separators. Deliberately loose: what it
#: actually is gets decided by :func:`_classify` on the digit count.
DIGIT_RUN = re.compile(r"(?<![\w@.])\+?\d[\d\s().\-]{4,24}\d(?![\w])|(?<![\w@.])\+?\d{5,19}(?![\w])")

EMAIL_PLACEHOLDER = "[redacted-email]"
CARD_PLACEHOLDER = "[redacted-card]"
GOV_ID_PLACEHOLDER = "[redacted-gov-id]"

PHONE_DIGITS = range(7, 16)  # 7-15, the E.164 range
CARD_DIGITS = range(13, 20)  # 13-19, the ISO/IEC 7812 range


def mask_phone(phone: str) -> str:
    """+15550100123 -> +1********23. Keeps the shape, drops the number."""
    p = (phone or "").strip()
    if len(p) <= 4:
        return "****"
    return p[:2] + "*" * (len(p) - 4) + p[-2:]


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _classify(span: str) -> str | None:
    """What a digit run is, by length: ``card``, ``phone``, or nothing."""
    n = len(_digits(span))
    if n in CARD_DIGITS and n > 15:
        return "card"
    if n in PHONE_DIGITS:
        return "phone"
    if n in CARD_DIGITS:
        return "card"
    return None


def _protect(text: str) -> tuple[str, list[str]]:
    """Swap timestamps and times out for sentinels so redaction cannot eat them."""
    kept: list[str] = []

    def take(m: re.Match) -> str:
        kept.append(m.group(0))
        return f"\x00{len(kept) - 1}\x00"

    return KEEP.sub(take, text), kept


def _restore(text: str, kept: list[str]) -> str:
    return re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], text)


def _redact_text(text: str) -> str:
    if not text:
        return text
    guarded, kept = _protect(text)
    guarded = EMAIL.sub(EMAIL_PLACEHOLDER, guarded)
    guarded = GOV_ID.sub(GOV_ID_PLACEHOLDER, guarded)

    def one(m: re.Match) -> str:
        span = m.group(0)
        kind = _classify(span)
        if kind == "card":
            return CARD_PLACEHOLDER
        if kind == "phone":
            return mask_phone(span.strip())
        return span

    guarded = DIGIT_RUN.sub(one, guarded)
    return _restore(guarded, kept)


def _walk(value: Any, fn) -> Any:
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_walk(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _walk(v, fn) for k, v in value.items()}
    return value


def findings(task: dict) -> dict:
    """Which sensitive shapes appear anywhere in the snapshot, before redaction."""
    seen = {"phone": False, "card": False, "gov_id": False, "email": False}

    def look(s: str) -> str:
        if not s:
            return s
        guarded, _ = _protect(s)
        if EMAIL.search(guarded):
            seen["email"] = True
        if GOV_ID.search(guarded):
            seen["gov_id"] = True
        for m in DIGIT_RUN.finditer(guarded):
            kind = _classify(m.group(0))
            if kind:
                seen[kind] = True
        return s

    _walk(task, look)
    return seen


def redact(task: dict) -> dict:
    """A copy of ``task`` with contact details removed and the findings recorded."""
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
