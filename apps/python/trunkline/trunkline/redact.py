"""Scrub patient identifiers out of text before anything is written to disk.

CALL-E returns a transcript of what was actually said. On a payer call that
transcript contains the member id and date of birth the agent read out and the
representative read back. Trunkline persists transcripts, so the transcript is
scrubbed on the way in, not on the way out to a screen.

The matcher is deliberately loose. A member id spoken digit by digit comes back
as ``W 1 2 3 4 5 6 7 8 9``; a date of birth comes back as ``March 11, 1984``.
Exact string matching would miss both.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from . import policy

REDACTION = "[redacted]"

MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

# Shorter than this, an identifier is too collision-prone to match at all.
MIN_SECRET_ALNUM = 4

# At this length and above, an identifier is distinctive enough to match even
# when a transcript spells it out character by character. Below it, only an
# exact run counts: a four-digit fragment spelled "4 4 1 7" is indistinguishable
# from the tail of a claim number read the same way, and redacting the claim
# number destroys the answer the biller called for.
LOOSE_MATCH_MIN_ALNUM = 6

SSN_RE = re.compile(r"\b[0-9]{3}[-\s][0-9]{2}[-\s][0-9]{4}\b")
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
E164_PHONE_RE = re.compile(r"(?<![\w])\+[1-9](?:[\s().-]*[0-9]){7,14}(?![\w])")
NANP_PHONE_RE = re.compile(
    r"(?<![\w])(?:\+?1[\s.-]*)?(?:\([0-9]{3}\)|[0-9]{3})[\s.-]+[0-9]{3}[\s.-]+[0-9]{4}(?![\w])"
)

# Separators a transcript may insert between characters of an identifier:
# whitespace from digit-by-digit speech, and the punctuation of a written date.
_SEP = r"[\s\-\.,/]*"


def _pattern_for(value: str) -> "re.Pattern[str]":
    """Compile the right matcher for one identifier.

    Both ends are always anchored on a word boundary. Without that anchor a short
    identifier matches inside a longer unrelated number: the fragment ``4417``
    would be found inside the claim number ``CLM-2026-004417``.

    Long identifiers additionally tolerate separators between their characters,
    because a member id read aloud comes back as ``W 8 8 4 2 1 3 0 9 7``.
    """
    chars = [ch for ch in value if ch.isalnum()]
    joiner = _SEP if len(chars) >= LOOSE_MATCH_MIN_ALNUM else ""
    body = joiner.join(re.escape(ch) for ch in chars)
    return re.compile(r"\b" + body + r"\b", re.IGNORECASE)


def _date_variants(value: str) -> List[str]:
    """Spoken and written forms of an ISO date."""
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return []
    month = MONTHS[parsed.month - 1]
    return [
        "%02d/%02d/%d" % (parsed.month, parsed.day, parsed.year),
        "%d/%d/%d" % (parsed.month, parsed.day, parsed.year),
        "%02d-%02d-%d" % (parsed.month, parsed.day, parsed.year),
        "%s %d, %d" % (month, parsed.day, parsed.year),
        "%s %d %d" % (month, parsed.day, parsed.year),
        "%d %s %d" % (parsed.day, month, parsed.year),
        "%s %s" % (month[:3], parsed.strftime("%d %Y")),
    ]


def build_patterns(secrets: Iterable[str]) -> List["re.Pattern[str]"]:
    """Compile one matcher per secret, longest first so the widest match wins."""
    ordered = sorted(
        {
            item.strip()
            for item in secrets
            if isinstance(item, str) and len([c for c in item if c.isalnum()]) >= MIN_SECRET_ALNUM
        },
        key=len,
        reverse=True,
    )
    patterns: List["re.Pattern[str]"] = []
    for secret in ordered:
        patterns.append(_pattern_for(secret))
        for variant in _date_variants(secret):
            patterns.append(_pattern_for(variant))
    return patterns


def build_phone_patterns(phones: Iterable[str]) -> List[Tuple["re.Pattern[str]", str]]:
    """Match known destinations even when a transcript spaces every digit."""
    patterns: List[Tuple["re.Pattern[str]", str]] = []
    ordered = sorted({phone.strip() for phone in phones if isinstance(phone, str) and phone.strip()})
    for phone in ordered:
        patterns.append((_pattern_for(phone), policy.mask_phone(phone)))
    return patterns


def mask_phone_text(
    text: str,
    phone_patterns: Sequence[Tuple["re.Pattern[str]", str]] = (),
) -> str:
    """Mask known, E.164, and conventionally formatted phone numbers in text."""
    if not isinstance(text, str) or not text:
        return text
    out = text
    for pattern, masked in phone_patterns:
        out = pattern.sub(masked, out)
    out = E164_PHONE_RE.sub(lambda match: policy.mask_phone(match.group(0)), out)
    out = NANP_PHONE_RE.sub(lambda match: policy.mask_phone(match.group(0)), out)
    return out


def scrub_text(
    text: str,
    patterns: Sequence["re.Pattern[str]"],
    phone_patterns: Sequence[Tuple["re.Pattern[str]", str]] = (),
) -> str:
    if not isinstance(text, str) or not text:
        return text
    out = text
    for pattern in patterns:
        out = pattern.sub(REDACTION, out)
    out = SSN_RE.sub(REDACTION, out)
    out = EMAIL_RE.sub(REDACTION, out)
    return mask_phone_text(out, phone_patterns)


def scrub_value(
    value: Any,
    patterns: Sequence["re.Pattern[str]"],
    phone_patterns: Sequence[Tuple["re.Pattern[str]", str]] = (),
) -> Any:
    """Recursively scrub every string inside a JSON-shaped value."""
    if isinstance(value, str):
        return scrub_text(value, patterns, phone_patterns)
    if isinstance(value, list):
        return [scrub_value(item, patterns, phone_patterns) for item in value]
    if isinstance(value, dict):
        return {key: scrub_value(item, patterns, phone_patterns) for key, item in value.items()}
    return value


def scrub_transcript(
    turns: Sequence[Dict[str, Any]],
    patterns: Sequence["re.Pattern[str]"],
    phone_patterns: Sequence[Tuple["re.Pattern[str]", str]] = (),
) -> List[Dict[str, Any]]:
    scrubbed: List[Dict[str, Any]] = []
    for turn in turns:
        item = dict(turn)
        item["text"] = scrub_text(str(item.get("text", "")), patterns, phone_patterns)
        scrubbed.append(item)
    return scrubbed


def contains_any(text: str, secrets: Iterable[str]) -> bool:
    """Test helper: does ``text`` still carry any of these identifiers?"""
    patterns = build_patterns(secrets)
    return any(pattern.search(text) for pattern in patterns)
