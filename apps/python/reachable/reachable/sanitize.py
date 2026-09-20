"""Sanitisation of all free text.

Requirement 2 of docs/SAFETY.md: transcripts, CALL-E results and any provider
text are stored and displayed escaped, length-limited, and with control
characters stripped. Raw provider text never reaches JSON output or exports.

Sanitisation happens at the **ingestion boundary** -- text is cleaned as it
enters storage, not on the way out to a template -- so a consumer added later
cannot forget to do it.
"""

from __future__ import annotations

import re
import unicodedata

from .phone import mask_display

#: Default cap for a free-text field. Long enough for a sentence a parent said,
#: short enough that nothing can be smuggled in bulk.
DEFAULT_MAX_LENGTH = 500

#: Longer cap for a whole transcript turn list rendered as one blob.
TRANSCRIPT_MAX_LENGTH = 4000

TRUNCATION_MARKER = "…[truncated]"

#: Bidirectional overrides and other invisible formatting characters. These can
#: make a stored string *display* as something other than what it is, which
#: matters when a member of staff is reading a transcript to make a
#: safeguarding decision.
_BIDI_AND_INVISIBLE = {
    "​", "‌", "‍", "‎", "‏",
    "‪", "‫", "‬", "‭", "‮",
    "⁦", "⁧", "⁨", "⁩",
    "﻿",
}

#: Characters a spreadsheet treats as the start of a formula. A school office
#: opens exports in Excel, so a cell beginning with one of these is neutralised.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def strip_control_characters(text: str) -> str:
    """Remove control and invisible formatting characters, keeping ordinary text.

    Tabs and newlines are folded to single spaces rather than dropped, so words
    do not run together.
    """
    out: list[str] = []
    for char in text:
        if char in _BIDI_AND_INVISIBLE:
            continue
        if char in ("\n", "\r", "\t"):
            out.append(" ")
            continue
        # Cc = control, Cf = format, Cs = surrogate, Co = private use.
        if unicodedata.category(char) in {"Cc", "Cf", "Cs", "Co"}:
            continue
        out.append(char)
    return "".join(out)


def clean_text(value: object, *, max_length: int = DEFAULT_MAX_LENGTH) -> str:
    """Sanitise one free-text value for storage.

    Not HTML-escaped here: escaping is the template layer's job and doing it at
    ingestion would double-escape on render and corrupt exports. What this
    guarantees is that the stored string contains no control characters, no
    invisible reordering, and no unbounded length.
    """
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = unicodedata.normalize("NFC", text)
    text = strip_control_characters(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_length:
        keep = max(0, max_length - len(TRUNCATION_MARKER))
        text = text[:keep].rstrip() + TRUNCATION_MARKER
    return text


def clean_quote(value: object) -> str:
    """Sanitise a verbatim quote.

    The quote is evidence a member of staff reads, so it is cleaned but never
    reworded: a tidied quote is a sentence the speaker never said.
    """
    return clean_text(value, max_length=300)


def clean_for_csv(value: object, *, max_length: int = DEFAULT_MAX_LENGTH) -> str:
    """Sanitise a value bound for a CSV export.

    Adds formula neutralisation on top of ``clean_text``: a cell beginning with
    ``=``, ``+``, ``-`` or ``@`` is prefixed with an apostrophe so a spreadsheet
    shows the text instead of evaluating it.
    """
    text = clean_text(mask_display(value), max_length=max_length)
    if text.startswith(_CSV_FORMULA_PREFIXES):
        return "'" + text
    return text


def clean_transcript_turns(turns: object) -> list[dict[str, object]]:
    """Sanitise CALL-E transcript turns into a stable, storable shape.

    Input is ``recipients[].attempts[].transcript_turns`` from OpenAPI 0.7.0:
    ``{offset_seconds: int|null, speaker: bot|user|unknown, text: str}``.

    An unrecognised speaker becomes ``unknown``, never silently promoted to
    ``user``: the identity-binding rule depends on ``user`` meaning the
    recipient actually spoke.
    """
    cleaned: list[dict[str, object]] = []
    if not isinstance(turns, list):
        return cleaned
    for turn in turns:
        if not isinstance(turn, dict):
            continue
        speaker = turn.get("speaker")
        if speaker not in ("bot", "user", "unknown"):
            speaker = "unknown"
        offset = turn.get("offset_seconds")
        cleaned.append(
            {
                "offset_seconds": offset if isinstance(offset, int) and offset >= 0 else None,
                "speaker": speaker,
                "text": clean_text(turn.get("text"), max_length=600),
            }
        )
    return cleaned
