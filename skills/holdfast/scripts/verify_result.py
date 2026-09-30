#!/usr/bin/env python3
"""Cross-check a CALL-E call's structured result against its transcript.

The platform's completion flag is its own judgment, not evidence. This script
marks each extracted field `verified` only when the transcript proves it, and
reports the call as verified / partially verified / unverified accordingly.

Evidence model (fail-closed by design):

- Provider gate: `ok` must exist in the provider envelope, be boolean, and be
  true; authoritative top-level/envelope statuses must exist and all be
  COMPLETED. Nested domain or metadata `status` fields never establish call
  completion. Missing flags, wrong types, or an authoritative non-completed
  status downgrade the overall report AND every field to `unverified`.
- Speaker gate: only callee-side turns can prove a field. Assistant turns
  ("BOT:") are claims (at most `plausible`); system and unlabeled turns are
  never evidence. Structured transcript turns keep their speaker role.
- Field anchoring: a field needs a sentence containing a relevant name or
  synonym hint. Strict fields (numbers, dates) prefer measure-style hints;
  without those, they use hints not shared with another returned field.
  These experimental heuristics are not a semantic guarantee.
- Daypart: a field named today/tomorrow verifies only in a sentence that
  positively names that daypart.
- Typed values: strings match whole token sequences; digit runs match with
  digit boundaries (so 85 never matches 185); identifiers must appear as a
  complete token; numbers compare exactly (sign, decimals) with unit
  compatibility (celsius vs fahrenheit or dollars vs cents do not verify each
  other); dates verify the year when the expected value carries one.
- Negation, contradiction, and corrections dominate: a negated match, an
  opposing same-magnitude number, or a denied date makes the field
  `contradicted` even when a positive match also exists.
- Hedge and approximation ("probably", "near", "should") and questions are
  never verified; they are `plausible` at best.
- Verdicts: `verified`, `plausible` (supportive but not conclusive; counts
  as not verified), `contradicted`, `unverified`. Every non-trivial verdict
  carries the supporting span and its speaker.
- A human reviewer may still downgrade any field to `contradicted` with a
  reason; this script's `contradicted` verdicts are heuristics, not proof.

Stdlib-only. Usage:
    python3 verify_result.py --result call-result.json
    cat call-result.json | python3 verify_result.py --result -

The result file may be the full CLI status output or just its
structuredContent; the script searches recursively for `structured_result`
(or `structuredResult`) and `transcript_turns` (or `transcript`).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from decimal import Decimal, InvalidOperation

STRUCTURED_KEYS = ("structured_result", "structuredResult")
TRANSCRIPT_KEYS = ("transcript_turns", "transcriptTurns", "transcript")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")
TURN_PREFIX_RE = re.compile(r"^\s*(?:\[[\d:]+\]\s*)?([A-Za-z]+)\s*[:：]\s*")

ASSISTANT_LABELS = {"assistant", "bot", "ai"}
CALLEE_LABELS = {"user", "callee", "human", "customer", "representative", "recording", "ivr"}
SYSTEM_LABELS = {"system"}

NEGATION_TOKENS = {
    "not", "no", "never", "isnt", "wasnt", "doesnt", "didnt", "hasnt",
    "havent", "wont", "cant", "couldnt", "cannot", "unable", "without",
    "neither", "nor", "none", "deny", "denies", "denied", "refuse",
    "refuses", "refused", "unavailable", "unknown", "unconfirmed",
    "unverified", "unready", "inactive", "incomplete", "undelivered",
}
HEDGE_TOKENS = {
    "probably", "maybe", "perhaps", "possibly", "roughly", "approximately",
    "about", "around", "near", "nearly", "almost", "think", "believe",
    "believes", "seem", "seems", "appear", "appears", "estimate",
    "estimated", "expected", "expects", "should", "might", "may", "could",
    "hopefully", "likely", "supposedly", "reportedly",
}
CLAUSE_RESET_TOKENS = {"but", "however", "though", "although", "yet", "except", "then"}

DATE_LIKE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$|^[+-]?\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?$")

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
MONTH_NAME_RE = "|".join(MONTH_NAMES)
SPOKEN_DATE_RES = (
    re.compile(rf"\b({MONTH_NAME_RE})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(\d{{4}}))?\b", re.IGNORECASE),
    re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+of\s+({MONTH_NAME_RE})(?:,?\s*(\d{{4}}))?\b", re.IGNORECASE),
)

FIELD_HINT_SYNONYMS = {
    "high": ("high", "highs"),
    "low": ("low", "lows"),
    "temp": ("temperature", "temp"),
    "temperature": ("temperature", "temp"),
    "status": ("status", "ready", "available"),
    "forecast": ("forecast",),
    "summary": ("summary", "skies"),
    "ready": ("ready", "available", "filled"),
    "pickup": ("pickup", "pick up", "ready", "held"),
    "ref": ("reference", "confirmation", "ref"),
    "reference": ("reference", "confirmation"),
    "confirmation": ("confirmation", "reference"),
    "hours": ("hours", "open", "closing", "closings"),
    "balance": ("balance", "owed", "due"),
    "appointment": ("appointment", "scheduled", "visit"),
    "date": ("date",),
    "time": ("time",),
}

GENERIC_FIELD_TOKENS = {
    "today", "tomorrow", "tonight", "current", "now", "value", "result",
    "field", "the", "a", "an", "of", "for", "to", "and", "weather", "by",
    "f", "c",
}

# Hints that describe a measure or an observable state; a strict (numeric or
# date) field verifies only with one of these, or with two distinct
# discriminative hints, so that "your claim number is 85" can never verify
# claim_balance_usd on the bare word "claim".
MEASURE_HINTS = {
    "balance", "amount", "total", "price", "cost", "fee", "owed", "due",
    "high", "highs", "low", "lows", "temp", "temperature", "forecast",
    "hours", "status", "ready", "available", "filled", "held", "pickup",
    "appointment", "scheduled", "date", "time", "reference", "confirmation",
    "ref", "delivery", "arrival", "eta", "delay",
}

DAYPART_TOKENS = {"today", "tonight", "tomorrow", "morning", "afternoon", "evening"}
CALENDAR_DAYPARTS = {"today", "tonight", "tomorrow"}

FIELD_UNIT_PATTERNS = (
    (re.compile(r"(_|^)(f|fahrenheit|farenheit|deg_f|degrees_f)(_|$)"), "fahrenheit"),
    (re.compile(r"(_|^)(c|celsius|centigrade|deg_c|degrees_c)(_|$)"), "celsius"),
    (re.compile(r"(_|^)(usd|dollars?|usdollars)(_|$)"), "usd"),
    (re.compile(r"(_|^)(eur|euros?)(_|$)"), "eur"),
    (re.compile(r"(_|^)(gbp|pounds?|sterling)(_|$)"), "gbp"),
    (re.compile(r"(_|^)(cents?|pence|penny)(_|$)"), "cent"),
    (re.compile(r"(_|^)(pct|percent)(_|$)"), "percent"),
)
TEXT_UNIT_WORDS = {
    "fahrenheit": "fahrenheit", "farenheit": "fahrenheit", "f": "fahrenheit",
    "celsius": "celsius", "centigrade": "celsius", "c": "celsius",
    "usd": "usd", "dollar": "usd", "dollars": "usd", "buck": "usd", "bucks": "usd",
    "euro": "eur", "euros": "eur", "pound": "gbp", "pounds": "gbp",
    "gbp": "gbp", "sterling": "gbp", "cent": "cent", "cents": "cent",
    "penny": "cent", "pence": "cent", "percent": "percent", "percentage": "percent",
}
CURRENCY_UNITS = {"usd", "eur", "gbp", "cent"}

NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
    "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70",
    "eighty": "80", "ninety": "90",
}

DECADE_WORDS = {"eighties": "8", "nineties": "9", "seventies": "7", "sixties": "6", "fifties": "5"}

RANGE_MODIFIER_SPAN = {
    "": (0, 9), None: (0, 9),
    "mid": (3, 7), "middle": (3, 7),
    "lower": (0, 3), "low": (0, 3),
    "upper": (7, 9), "high": (7, 9),
    "mid to upper": (3, 9), "mid to lower": (0, 7),
}
RANGE_RE = re.compile(r"\b(mid to upper|mid to lower|mid|lower|upper)\s+(\d0)s\b", re.IGNORECASE)
BARE_RANGE_RE = re.compile(r"\b(\d0)s\b")
DECADE_RANGE_RE = re.compile(r"\b(mid to upper|mid to lower|mid|lower|upper)?\s*(eighties|nineties|seventies|sixties|fifties)\b", re.IGNORECASE)

SIGNED_NUMBER_RE = re.compile(r"(?<![a-z0-9])([+-]?\d+(?:\.\d+)?)(?![a-z0-9])")
SIGN_WORDS_NEGATIVE = {"negative", "minus"}
SIGN_WORDS_POSITIVE = {"positive", "plus"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def find_key(node: object, keys: tuple[str, ...]) -> object | None:
    if isinstance(node, dict):
        for key in keys:
            if key in node and node[key] not in (None, "", [], {}):
                return node[key]
        for value in node.values():
            found = find_key(value, keys)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = find_key(item, keys)
            if found is not None:
                return found
    return None


def transcript_text(raw: object) -> str:
    """Render transcript turns to labeled lines, preserving speaker roles.

    A list of structured turns keeps its roles: assistant-side speakers
    render as BOT:, callee-side as USER:, system as SYSTEM:, anything else as
    UNKNOWN:. Roles must survive flattening, or assistant claims would be
    mistaken for independent evidence."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts = []
        for turn in raw:
            if isinstance(turn, dict):
                speaker = str(
                    turn.get("speaker") or turn.get("role") or turn.get("from") or ""
                ).lower()
                text = str(turn.get("text") or turn.get("message") or turn.get("content") or "")
                if speaker in ASSISTANT_LABELS:
                    label = "BOT"
                elif speaker in CALLEE_LABELS:
                    label = "USER"
                elif speaker in SYSTEM_LABELS:
                    label = "SYSTEM"
                else:
                    label = "UNKNOWN"
                parts.append(f"{label}: {text}" if text else f"{label}:")
            elif isinstance(turn, str):
                parts.append(turn)
        return "\n".join(parts)
    return ""


def normalize(text: object) -> str:
    lowered = str(text).lower()
    # keep contractions whole: "isn't" -> "isnt", so the negation lexicon matches
    lowered = re.sub(r"(?<=[a-z])'(?=[a-z])", "", lowered)
    return re.sub(r"[^a-z0-9]+", " ", lowered).strip()


def digit_string(text: object) -> str:
    return re.sub(r"\D", "", str(text))


def number_variants(value: object) -> set[str]:
    """Spoken forms the value might appear as (word forms, decade words)."""
    digits = digit_string(value)
    if not digits:
        return set()
    variants = set()
    if digits.isdigit() and 0 <= int(digits) <= 99:
        n = int(digits)
        if n < 21:
            words = [w for w, d in NUMBER_WORDS.items() if d == str(n)]
        else:
            tens = n // 10 * 10
            ones = n % 10
            tens_word = [w for w, d in NUMBER_WORDS.items() if d == str(tens)]
            ones_word = [w for w, d in NUMBER_WORDS.items() if d == str(ones)] if ones else []
            words = [f"{t} {o}" for t in tens_word for o in ones_word] or tens_word
        variants.update(words)
    for word, d in DECADE_WORDS.items():
        if digits.startswith(d) and len(digits) == 2:
            variants.add(word)
    return variants


def is_numeric_like(value: object) -> bool:
    text = str(value).strip()
    if not text:
        return False
    if re.fullmatch(r"[+-]?\d+(\.\d+)?", text):
        return True
    return any(v.isdigit() for v in number_variants(text))


def is_date_like(value: object) -> bool:
    return bool(DATE_LIKE_RE.match(str(value).strip()))


def is_pure_digit_value(value: object) -> bool:
    return bool(re.fullmatch(r"\d{4,15}", str(value).strip()))


def field_unit(field_name: str) -> str | None:
    lowered = f"_{field_name.lower()}_"
    for pattern, unit in FIELD_UNIT_PATTERNS:
        if pattern.search(lowered):
            return unit
    return None


def text_unit(norm_sentence: str) -> str | None:
    for token in TOKEN_SPLIT_RE.split(norm_sentence):
        if token in TEXT_UNIT_WORDS:
            return TEXT_UNIT_WORDS[token]
    return None


def units_compatible(field_u: str | None, text_u: str | None) -> bool:
    # A currency-coded field cannot be proven by a bare number. "Balance is
    # 85" does not establish balance_usd=85 without dollars/USD in the same
    # sentence. Temperature fields may still inherit their call context.
    if field_u in CURRENCY_UNITS and text_u is None:
        return False
    if not field_u or not text_u:
        return True
    return field_u == text_u


def field_hints(field_name: str) -> set[str]:
    """Spoken tokens that name this field in a transcript."""
    hints: set[str] = set()
    for token in TOKEN_SPLIT_RE.split(field_name.lower()):
        if not token or token in GENERIC_FIELD_TOKENS:
            continue
        token = re.sub(r"(_f|_c|_deg|_degrees|_temp)$", "", token)
        if token in GENERIC_FIELD_TOKENS or len(token) < 2:
            continue
        hints.add(token)
        hints.update(FIELD_HINT_SYNONYMS.get(token, ()))
    return hints


def field_daypart(field_name: str) -> str | None:
    for token in TOKEN_SPLIT_RE.split(field_name.lower()):
        if token in CALENDAR_DAYPARTS:
            return token
    return None


# --------------------------------------------------------------------------
# Turn and sentence model
# --------------------------------------------------------------------------

class Turn:
    def __init__(self, raw: str, speaker: str, text: str):
        self.raw = raw
        self.speaker = speaker  # "assistant" | "callee" | "system" | "unknown"
        self.text = text

    def sentences(self) -> list[str]:
        return [s for s in (s.strip() for s in SENTENCE_SPLIT_RE.split(self.text)) if s]


def split_turns(transcript: str) -> list[Turn]:
    turns: list[Turn] = []
    for raw in transcript.splitlines():
        if not raw.strip():
            continue
        match = TURN_PREFIX_RE.match(raw)
        speaker_label = match.group(1).lower() if match else ""
        text = TURN_PREFIX_RE.sub("", raw).strip()
        if speaker_label in ASSISTANT_LABELS:
            speaker = "assistant"
        elif speaker_label in CALLEE_LABELS:
            speaker = "callee"
        elif speaker_label in SYSTEM_LABELS:
            speaker = "system"
        else:
            speaker = "unknown"
        turns.append(Turn(raw, speaker, text))
    return turns


def sentence_tokens(sentence: str) -> set[str]:
    return {t for t in TOKEN_SPLIT_RE.split(normalize(sentence)) if t}


def _window_tokens_before(norm: str, char_start: int, limit: int = 8) -> list[str]:
    tokens = [t for t in TOKEN_SPLIT_RE.split(norm[:char_start]) if t]
    window: list[str] = []
    for token in reversed(tokens[-limit:]):
        if token in CLAUSE_RESET_TOKENS:
            break
        window.append(token)
    return window


def span_negated(norm: str, char_start: int) -> bool:
    window = _window_tokens_before(norm, char_start)
    return bool(set(window) & NEGATION_TOKENS)


def span_denied_after(norm: str, char_end: int) -> bool:
    """Catch terminal boolean denial that follows a value mention.

    This is deliberately narrow: it covers forms such as "ready flag is
    false" and "ready is not true" without treating every later "no" as a
    denial of the matched field.
    """
    after = norm[char_end:]
    return bool(re.match(
        r"\s+(?:flag\s+)?(?:is|was|equals?|reported\s+as)\s+(?:false|not\s+true)\b",
        after,
    ))


def span_hedged(norm: str, char_start: int, char_end: int) -> bool:
    before = _window_tokens_before(norm, char_start)
    after = [t for t in TOKEN_SPLIT_RE.split(norm[char_end:]) if t][:3]
    return bool((set(before) | set(after)) & HEDGE_TOKENS)


# --------------------------------------------------------------------------
# Typed value extraction
# --------------------------------------------------------------------------

def ranges_in_text(norm: str) -> list[tuple[int, int, str, int, int]]:
    """Spoken ranges with char spans: 'mid 80s' -> (83, 87, phrase, start, end)."""
    ranges: list[tuple[int, int, str, int, int]] = []
    for match in RANGE_RE.finditer(norm):
        mod, decade = match.group(1).lower(), match.group(2)
        base = int(decade)
        lo_off, hi_off = RANGE_MODIFIER_SPAN.get(mod, (0, 9))
        ranges.append((base + lo_off, base + hi_off, match.group(0), match.start(), match.end()))
    for match in DECADE_RANGE_RE.finditer(norm):
        mod = (match.group(1) or "").lower() or None
        base = int(DECADE_WORDS[match.group(2).lower()]) * 10
        lo_off, hi_off = RANGE_MODIFIER_SPAN.get(mod, (0, 9))
        ranges.append((base + lo_off, base + hi_off, match.group(0), match.start(), match.end()))
    covered = [(r[0], r[1]) for r in ranges]
    for match in BARE_RANGE_RE.finditer(norm):
        base = int(match.group(1))
        if (base, base + 9) not in covered:
            ranges.append((base, base + 9, match.group(0), match.start(), match.end()))
    return ranges


def spoken_dates(norm: str) -> list[tuple[int, int, int | None, str, int, int]]:
    """(month, day, year|None, phrase, start, end) for each spoken date."""
    found: list[tuple[int, int, int | None, str, int, int]] = []
    for match in SPOKEN_DATE_RES[0].finditer(norm):
        found.append((
            MONTH_NAMES[match.group(1).lower()], int(match.group(2)),
            int(match.group(3)) if match.group(3) else None,
            match.group(0), match.start(), match.end(),
        ))
    for match in SPOKEN_DATE_RES[1].finditer(norm):
        found.append((
            MONTH_NAMES[match.group(2).lower()], int(match.group(1)),
            int(match.group(3)) if match.group(3) else None,
            match.group(0), match.start(), match.end(),
        ))
    return found


def value_date_parts(value: object) -> tuple[int | None, int, int] | None:
    """(year|None, month, day) for an ISO or slash date value."""
    text = str(value).strip()
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        return (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    match = re.match(r"^[+-]?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$", text)
    if match:
        year = int(match.group(3)) if match.group(3) else None
        if year is not None and year < 100:
            year += 2000
        return (year, int(match.group(1)), int(match.group(2)))
    return None


def comparable(value: object, other: str) -> bool:
    """True when `other` is a number of the same magnitude as `value`
    (so it plausibly contradicts it, rather than being an unrelated count,
    timestamp fragment, or area code)."""
    digits = digit_string(value).lstrip("0") or "0"
    other_digits = other.lstrip("+-").replace(".", "").lstrip("0") or "0"
    if not digits.isdigit() or not other_digits.isdigit():
        return False
    if digits == other_digits:
        return False
    return len(digits) == len(other_digits)


def signed_numbers(norm: str) -> list[tuple[Decimal, str, int, int]]:
    """(value, raw_text, start, end) for every digit number in the text,
    applying explicit signs and negative/positive sign words."""
    found: list[tuple[Decimal, str, int, int]] = []
    for match in SIGNED_NUMBER_RE.finditer(norm):
        raw = match.group(1)
        sign = 1
        if raw.startswith("-"):
            sign = -1
        elif raw.startswith("+"):
            sign = 1
        else:
            before = norm[:match.start()].rstrip()
            word = re.search(r"([a-z]+)\s*$", before)
            if word and word.group(1) in SIGN_WORDS_NEGATIVE:
                sign = -1
            elif word and word.group(1) in SIGN_WORDS_POSITIVE:
                sign = 1
        try:
            found.append((Decimal(raw.lstrip("+-")) * sign, raw, match.start(), match.end()))
        except InvalidOperation:
            continue
    return found


def collect_matches(value: object, sentence: str, unit: str | None) -> list[dict]:
    """All typed matches of `value` in `sentence`, each tagged with negation
    and hedge status. Unit-incompatible candidates are dropped entirely."""
    norm = normalize(sentence)
    matches: list[dict] = []

    if is_date_like(value):
        parts = value_date_parts(value)
        if not parts:
            return matches
        expected_year, expected_month, expected_day = parts
        for month, day, year, phrase, start, end in spoken_dates(norm):
            if (month, day) != (expected_month, expected_day):
                continue
            negated = span_negated(norm, start) or span_hedged(norm, start, end)
            matches.append({
                "kind": "date", "phrase": phrase, "start": start, "end": end,
                "negated": span_negated(norm, start), "hedged": span_hedged(norm, start, end),
                "year": year, "expected_year": expected_year,
            })
        return matches

    if is_pure_digit_value(value):
        digits = digit_string(value)
        leading_zero = len(digits) > 1 and digits.startswith("0")
        exact = re.search(rf"(?<!\d){re.escape(digits)}(?!\d)", norm)
        if exact:
            matches.append({
                "kind": "literal", "phrase": digits, "start": exact.start(), "end": exact.end(),
                "negated": span_negated(norm, exact.start()),
                "hedged": span_hedged(norm, exact.start(), exact.end()),
            })
        if leading_zero:
            return matches
        as_int = int(digits)
        for lo, hi, phrase, start, end in ranges_in_text(norm):
            if lo <= as_int <= hi:
                matches.append({
                    "kind": "range", "phrase": phrase, "start": start, "end": end,
                    "negated": span_negated(norm, start), "hedged": span_hedged(norm, start, end),
                })
        for variant in number_variants(value):
            if variant.isdigit():
                continue
            spoken = re.search(rf"(?<![a-z0-9]){re.escape(normalize(variant))}(?![a-z0-9])", norm)
            if spoken:
                matches.append({
                    "kind": "spoken", "phrase": variant, "start": spoken.start(), "end": spoken.end(),
                    "negated": span_negated(norm, spoken.start()),
                    "hedged": span_hedged(norm, spoken.start(), spoken.end()),
                })
        return matches

    if is_numeric_like(value):
        try:
            target = Decimal(str(value).strip())
        except InvalidOperation:
            return matches
        sentence_unit = text_unit(norm)
        for cand, raw, start, end in signed_numbers(norm):
            if cand != target:
                continue
            if not units_compatible(unit, sentence_unit):
                continue
            matches.append({
                "kind": "number", "phrase": raw, "start": start, "end": end,
                "negated": span_negated(norm, start), "hedged": span_hedged(norm, start, end),
            })
        unsigned_int = target == target.to_integral_value() and target >= 0
        raw_digits = digit_string(value)
        no_leading_zero = not (len(raw_digits) > 1 and raw_digits.startswith("0"))
        if unsigned_int and no_leading_zero:
            as_int = int(target)
            for lo, hi, phrase, start, end in ranges_in_text(norm):
                if lo <= as_int <= hi and units_compatible(unit, sentence_unit):
                    matches.append({
                        "kind": "range", "phrase": phrase, "start": start, "end": end,
                        "negated": span_negated(norm, start), "hedged": span_hedged(norm, start, end),
                    })
        return matches

    # Generic string: whole token-sequence equality, never a substring.
    value_norm = normalize(value)
    value_tokens = [t for t in TOKEN_SPLIT_RE.split(value_norm) if t]
    if not value_tokens:
        return matches
    pattern = re.compile(rf"(?<![a-z0-9]){re.escape(' '.join(value_tokens))}(?![a-z0-9])")
    for occurrence in pattern.finditer(norm):
        char_start, char_end = occurrence.start(), occurrence.end()
        matches.append({
            "kind": "literal", "phrase": value_norm, "start": char_start,
            "end": char_end,
            "negated": span_negated(norm, char_start) or span_denied_after(norm, char_end),
            "hedged": span_hedged(norm, char_start, char_end),
        })
    return matches


# --------------------------------------------------------------------------
# Field verdict
# --------------------------------------------------------------------------

def verdict_for(
    field_name: str,
    value: object,
    transcript: str,
    sibling_hints: dict[str, set[str]] | None = None,
) -> dict:
    if value is None or isinstance(value, bool) or isinstance(value, (list, dict)):
        return {
            "value": value,
            "verdict": "unverified",
            "evidence": "not automatically verifiable (null, boolean, or structured value)",
        }

    own_hints = field_hints(field_name)
    if sibling_hints is None:
        sibling_hints = {field_name: own_hints}
    others: set[str] = set()
    for sibling, hints in sibling_hints.items():
        if sibling != field_name:
            others |= hints
    discriminative = {hint for hint in own_hints if hint not in others}
    strict = is_numeric_like(value) or is_date_like(value)
    if strict:
        # Strict fields need a measure-style hint (so "your claim number is
        # 85" can never anchor claim_balance_usd); when the field name has no
        # measure token at all, fall back to hints that no sibling field uses.
        anchored_hints = set(own_hints & MEASURE_HINTS)
        if not anchored_hints:
            anchored_hints = set(discriminative)
    else:
        anchored_hints = set(own_hints)

    daypart = field_daypart(field_name)
    unit = field_unit(field_name)
    turns = split_turns(transcript)

    verified_match: dict | None = None
    plausible_match: dict | None = None
    yearless_date: dict | None = None
    contradictions: list[dict] = []

    for turn in turns:
        if turn.speaker != "callee":
            continue
        for sentence in turn.sentences():
            if "?" in sentence:
                continue
            tokens = sentence_tokens(sentence)
            anchored = bool(tokens & anchored_hints)
            if anchored and daypart and daypart not in tokens:
                anchored = False
            if not anchored:
                continue
            for match in collect_matches(value, sentence, unit):
                if match["kind"] == "date":
                    if match["negated"] or (
                        match["expected_year"] and match["year"]
                        and match["year"] != match["expected_year"]
                    ):
                        contradictions.append({**match, "speaker": turn.speaker, "span": sentence[:220]})
                    elif match["expected_year"] and not match["year"]:
                        yearless_date = yearless_date or {**match, "speaker": turn.speaker, "span": sentence[:220]}
                    elif not match["hedged"]:
                        verified_match = verified_match or {**match, "speaker": turn.speaker, "span": sentence[:220]}
                    else:
                        plausible_match = plausible_match or {**match, "speaker": turn.speaker, "span": sentence[:220]}
                elif match["negated"]:
                    contradictions.append({**match, "speaker": turn.speaker, "span": sentence[:220]})
                elif match["hedged"]:
                    plausible_match = plausible_match or {**match, "speaker": turn.speaker, "span": sentence[:220]}
                else:
                    verified_match = verified_match or {**match, "speaker": turn.speaker, "span": sentence[:220]}

    # Contradiction sweep: a field-named sentence carrying an opposing
    # same-magnitude number, a denied value, or a wrong-year date contradicts
    # the field even without the field's daypart, and even when a positive
    # match also exists. Numbers covered by a range that contains the claimed
    # value are not opposing evidence.
    if not contradictions:
        for turn in turns:
            if turn.speaker != "callee":
                continue
            for sentence in turn.sentences():
                tokens = sentence_tokens(sentence)
                if not (tokens & anchored_hints) and not (tokens & own_hints):
                    continue
                norm = normalize(sentence)
                if is_date_like(value):
                    parts = value_date_parts(value)
                    if not parts:
                        continue
                    expected_year, expected_month, expected_day = parts
                    for month, day, year, phrase, start, end in spoken_dates(norm):
                        if (month, day) != (expected_month, expected_day):
                            continue
                        if span_negated(norm, start) or (
                            expected_year and year and year != expected_year
                        ):
                            contradictions.append({
                                "kind": "date", "phrase": phrase, "speaker": turn.speaker,
                                "span": sentence[:220],
                            })
                elif strict:
                    try:
                        target_dec = Decimal(str(value).strip())
                    except InvalidOperation:
                        target_dec = None
                    # Loose digit-run scan: "80s" carries the number 80 even
                    # though it is not a standalone token.
                    loose_numbers = re.findall(r"\d+", norm)
                    if target_dec is not None and target_dec == target_dec.to_integral_value():
                        value_int = int(target_dec)
                        if any(lo <= value_int <= hi for lo, hi, _, _, _ in ranges_in_text(norm)):
                            continue  # range evidence, not an opposing number
                    for num_text in loose_numbers:
                        if not comparable(value, num_text):
                            continue
                        contradictions.append({
                            "kind": "number", "phrase": num_text, "speaker": turn.speaker,
                            "span": sentence[:220],
                        })

    if contradictions:
        first = contradictions[0]
        return {
            "value": value,
            "verdict": "contradicted",
            "evidence": f"transcript contradicts the field value ('{first['phrase']}')",
            "speaker": first["speaker"],
            "span": first["span"],
        }
    if verified_match:
        return {
            "value": value,
            "verdict": "verified",
            "evidence": f"field named in a callee turn; value matched ('{verified_match['phrase']}')",
            "speaker": verified_match["speaker"],
            "span": verified_match["span"],
        }

    # Loose support: assistant claims, hedged anchors, yearless dates, and
    # (for non-strict values only) unanchored callee mentions.
    for turn in turns:
        if turn.speaker == "assistant":
            for sentence in turn.sentences():
                if "?" in sentence:
                    continue
                for match in collect_matches(value, sentence, unit):
                    if match["negated"]:
                        continue
                    plausible_match = plausible_match or {
                        **match, "speaker": turn.speaker, "span": sentence[:220],
                    }
    if not strict and not plausible_match:
        for turn in turns:
            if turn.speaker != "callee":
                continue
            for sentence in turn.sentences():
                if "?" in sentence:
                    continue
                tokens = sentence_tokens(sentence)
                if tokens & anchored_hints:
                    continue
                for match in collect_matches(value, sentence, unit):
                    if match["negated"] or match["kind"] == "date":
                        continue
                    plausible_match = plausible_match or {
                        **match, "speaker": turn.speaker, "span": sentence[:220],
                    }
                    break
                if plausible_match:
                    break
            if plausible_match:
                break
    if yearless_date:
        return {
            "value": value,
            "verdict": "plausible",
            "evidence": "the spoken date matches but the year is never stated; the expected value carries a year",
            "speaker": yearless_date["speaker"],
            "span": yearless_date["span"],
        }
    if plausible_match:
        source = "assistant" if plausible_match["speaker"] == "assistant" else "callee"
        return {
            "value": value,
            "verdict": "plausible",
            "evidence": f"{source} support is not conclusive ('{plausible_match['phrase']}'); not counted as verified",
            "speaker": plausible_match["speaker"],
            "span": plausible_match["span"],
        }
    if strict:
        return {
            "value": value,
            "verdict": "unverified",
            "evidence": "no callee sentence names the field with this value; numeric/date fields require that anchor",
        }
    return {
        "value": value,
        "verdict": "unverified",
        "evidence": "value not found in any trusted callee turn",
    }


# --------------------------------------------------------------------------
# Provider gate and report
# --------------------------------------------------------------------------

def provider_envelopes(result: dict) -> list[dict]:
    """Known CALL-E call-state envelopes, never arbitrary nested payloads.

    CLI 0.5.1 wraps get_call_run in result.structuredContent. Workflow
    commands expose the latest status in status_result.structuredContent;
    run_result is only the initial acknowledgement and must not veto it.
    Keep this helper aligned with run_task.py's display/polling boundary.
    """
    envelopes = [result]
    for key in ("structuredContent", "structured_content"):
        value = result.get(key)
        if isinstance(value, dict):
            envelopes.append(value)
    latest = None
    if result.get("tool_name") == "get_call_run":
        latest = result.get("result")
    elif (result.get("tool_name") == "run_call"
          and result.get("call_started") is True
          and result.get("run_id")):
        latest = result.get("status_result")
    if isinstance(latest, dict):
        for key in ("structuredContent", "structured_content"):
            value = latest.get(key)
            if isinstance(value, dict):
                envelopes.append(value)
    return envelopes


def authoritative_values(result: dict, key: str) -> list[object]:
    return [
        envelope[key]
        for envelope in provider_envelopes(result)
        if key in envelope and envelope[key] not in (None, "")
    ]


def provider_blocks_verification(result: dict) -> str | None:
    """Failure-dominant gate over authoritative CALL-E envelopes only.

    Domain fields such as metadata.status or result.status can describe an
    order, claim, or extraction. They must neither prove nor veto call
    completion. Conflicting authoritative envelope values still fail closed.
    """
    oks = authoritative_values(result, "ok")
    if not oks:
        return "provider ok flag is missing"
    if any(type(flag) is not bool for flag in oks):
        return "provider ok flag has a non-boolean value"
    if any(flag is not True for flag in oks):
        return "provider reported ok=false; the call output cannot be trusted"
    statuses = [str(status).upper() for status in authoritative_values(result, "status")]
    if not statuses:
        return "no authoritative call status found"
    if any(status != "COMPLETED" for status in statuses):
        return "authoritative call status is not COMPLETED; fields are not evidence of success"
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True, help="call result JSON file, or - for stdin")
    args = parser.parse_args()

    raw = sys.stdin.read() if args.result == "-" else open(args.result, encoding="utf-8").read()
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"result is not valid JSON: {exc}")

    structured = find_key(result, STRUCTURED_KEYS)
    transcript_raw = find_key(result, TRANSCRIPT_KEYS)
    transcript = transcript_text(transcript_raw) if transcript_raw else ""
    task_completed = bool(find_key(result, ("task_completed", "taskCompleted")))

    notes: list[str] = []
    block = provider_blocks_verification(result)
    if block:
        notes.append(block)
    if not transcript:
        notes.append("no transcript found; nothing can be verified")
    if task_completed:
        notes.append("platform reported task_completed; treated as a claim, not evidence")

    sibling_hints = (
        {name: field_hints(name) for name in structured}
        if isinstance(structured, dict)
        else None
    )
    fields: dict[str, dict] = {}
    if isinstance(structured, dict) and structured:
        for name, value in structured.items():
            fields[name] = verdict_for(name, value, transcript, sibling_hints)
    else:
        notes.append("no structured_result found; nothing extracted to verify")

    if block:
        for name, field in fields.items():
            fields[name] = {
                "value": field["value"],
                "verdict": "unverified",
                "evidence": f"provider gate failed ({block}); transcript-level assessment withheld",
            }

    verified = sum(1 for f in fields.values() if f["verdict"] == "verified")
    contradicted = sum(1 for f in fields.values() if f["verdict"] == "contradicted")
    if block:
        overall = "unverified"
    elif not fields:
        overall = "unverified"
    elif contradicted:
        overall = "contradicted"
    elif verified == len(fields):
        overall = "verified"
    elif verified > 0:
        overall = "partially verified"
    else:
        overall = "unverified"

    print(json.dumps({"overall": overall, "fields": fields, "notes": notes}, indent=2, default=str))


if __name__ == "__main__":
    main()
