"""Masking and redaction.

Every surface except the access-controlled `contacts` table gets a masked number:
`+14155550142` renders as `+1415<dots>0142`. Free text that came back from a call is
additionally stripped of long digit runs and email addresses before it is stored
anywhere outside `contacts`.

`tests/test_masking.py` fails the build if a raw E.164 reaches a log line, a preview, a
report, a dashboard page, or a transition row.
"""

from __future__ import annotations

import re

MASK_DOTS = "•••"

# Any E.164-shaped run in free text, not anchored, so it can be found mid-sentence.
_E164_IN_TEXT_RE = re.compile(r"\+[1-9]\d{6,14}")

# A run of 7 or more digits that is not part of an already-masked value.
_LONG_DIGIT_RUN_RE = re.compile(r"\d{7,}")

_EMAIL_RE = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9]"
    r"(?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+"
)

DIGITS_REMOVED = "[digits removed]"
EMAIL_REMOVED = "[email removed]"


def mask_e164(value: str | None) -> str:
    """Mask one phone number for display.

    `+14155550142` becomes `+1415<dots>0142`. Shorter numbers keep less, never more.
    """
    if not value or not isinstance(value, str):
        return "(no number)"
    if len(value) >= 10:
        return f"{value[:5]}{MASK_DOTS}{value[-4:]}"
    if len(value) >= 7:
        return f"{value[:2]}{MASK_DOTS}{value[-2:]}"
    return MASK_DOTS


def mask_numbers_in_text(text: str) -> str:
    """Replace every E.164-shaped run inside free text with its masked form."""
    if not text:
        return text
    return _E164_IN_TEXT_RE.sub(lambda match: mask_e164(match.group(0)), text)


def redact_free_text(text: str | None) -> str | None:
    """Conservatively redact operator-visible free text.

    Applied to `notes_for_human` and to any transcript text stored or displayed outside
    the ledger's raw snapshot. Masks E.164 numbers, then removes remaining digit runs of
    seven or more and any email address.
    """
    if text is None:
        return None
    redacted = mask_numbers_in_text(text)
    redacted = _EMAIL_RE.sub(EMAIL_REMOVED, redacted)
    redacted = _LONG_DIGIT_RUN_RE.sub(DIGITS_REMOVED, redacted)
    return redacted


def find_raw_e164(text: str) -> list[str]:
    """Return every unmasked E.164 run found in `text`. Used by tests and by `pc run`."""
    if not text:
        return []
    return _E164_IN_TEXT_RE.findall(text)


def redact_snapshot(payload: object) -> object:
    """Deep-copy a CALL-E payload with every phone-shaped string masked.

    Used before a provider snapshot is written to `attempts.raw_snapshot_redacted_json`
    and before a recorded payload is saved to `fixtures/recorded/`.
    """
    if isinstance(payload, dict):
        return {key: redact_snapshot(value) for key, value in payload.items()}
    if isinstance(payload, list):
        return [redact_snapshot(item) for item in payload]
    if isinstance(payload, str):
        return mask_numbers_in_text(payload)
    return payload
