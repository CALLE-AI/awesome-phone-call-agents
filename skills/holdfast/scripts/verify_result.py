#!/usr/bin/env python3
"""Cross-check a CALL-E call's structured result against its transcript.

The platform's completion flag is its own judgment, not evidence. This script
marks each extracted field `verified` only when the transcript contains
supporting text for it, and reports the call as verified / partially
verified / unverified accordingly.

Field-level binding (not whole-transcript loose matching):

- Each field is matched inside a *zone*: the transcript sentences that name
  the field (or a known synonym) plus one sentence of context on each side.
- Numeric and date-like fields verify only inside their zone. A number that
  appears elsewhere in the transcript — another daypart, a timestamp, a
  different reading — does not verify the field.
- If the zone names the field but shows a different value of comparable
  magnitude, the field is marked `contradicted` automatically.
- If the transcript never names the field, non-numeric fields may still
  verify on a strong global text match, but the verdict says the field name
  was never spoken. Numeric/date fields do not get this fallback.
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

STRUCTURED_KEYS = ("structured_result", "structuredResult")
TRANSCRIPT_KEYS = ("transcript_turns", "transcriptTurns", "transcript")

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")

DATE_LIKE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$|^\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?$")

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
MONTH_NAME_RE = "|".join(MONTH_NAMES)
SPOKEN_DATE_RES = (
    re.compile(rf"\b({MONTH_NAME_RE})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", re.IGNORECASE),
    re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+of\s+({MONTH_NAME_RE})\b", re.IGNORECASE),
)


def dates_in_text(text: str) -> set[tuple[int, int]]:
    """(month, day) pairs spoken in the text, whatever the format."""
    found: set[tuple[int, int]] = set()
    for match in SPOKEN_DATE_RES[0].finditer(text):
        found.add((MONTH_NAMES[match.group(1).lower()], int(match.group(2))))
    for match in SPOKEN_DATE_RES[1].finditer(text):
        found.add((MONTH_NAMES[match.group(2).lower()], int(match.group(1))))
    return found


def value_date_parts(value: object) -> tuple[int, int] | None:
    text = str(value).strip()
    match = re.match(r"^\d{4}-(\d{2})-(\d{2})", text)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    match = re.match(r"^(\d{1,2})[/.](\d{1,2})(?:[/.]\d{2,4})?$", text)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    return None

FIELD_HINT_SYNONYMS = {
    "high": ("high", "highs"),
    "low": ("low", "lows"),
    "temp": ("temperature", "temp"),
    "temperature": ("temperature", "temp"),
    "status": ("status",),
    "forecast": ("forecast",),
    "summary": ("summary", "skies"),
    "ready": ("ready", "available", "filled"),
    "pickup": ("pickup", "pick up", "ready"),
    "ref": ("reference", "confirmation", "number", "ref"),
    "reference": ("reference", "confirmation", "number"),
    "confirmation": ("confirmation", "reference", "number"),
    "hours": ("hours", "open", "closing", "closings"),
    "balance": ("balance", "owed", "due"),
    "appointment": ("appointment", "scheduled", "visit"),
    "date": ("date", "on"),
    "time": ("time", "at", "am", "pm"),
}

GENERIC_FIELD_TOKENS = {
    "today", "tomorrow", "tonight", "current", "now", "value", "result",
    "field", "the", "a", "an", "of", "for", "to", "and", "weather",
}


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
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts = []
        for turn in raw:
            if isinstance(turn, dict) and "text" in turn:
                parts.append(str(turn["text"]))
            elif isinstance(turn, str):
                parts.append(turn)
        return "\n".join(parts)
    return ""


def normalize(text: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def compact(text: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(text).lower())


def digit_string(text: object) -> str:
    return re.sub(r"\D", "", str(text))


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


def ranges_in_text(text: str) -> list[tuple[int, int, str]]:
    """Spoken temperature-style ranges: 'mid 80s' -> 83-87, 'lower nineties'
    -> 90-93, plain '80s'/'eighties' -> 80-89. Returns (lo, hi, phrase)."""
    ranges: list[tuple[int, int, str]] = []
    for match in RANGE_RE.finditer(text):
        mod, decade = match.group(1).lower(), match.group(2)
        base = int(decade)
        lo_off, hi_off = RANGE_MODIFIER_SPAN.get(mod, (0, 9))
        ranges.append((base + lo_off, base + hi_off, match.group(0)))
    for match in DECADE_RANGE_RE.finditer(text):
        mod = (match.group(1) or "").lower() or None
        base = int(DECADE_WORDS[match.group(2).lower()]) * 10
        lo_off, hi_off = RANGE_MODIFIER_SPAN.get(mod, (0, 9))
        ranges.append((base + lo_off, base + hi_off, match.group(0)))
    covered = [r[:2] for r in ranges]
    for match in BARE_RANGE_RE.finditer(text):
        base = int(match.group(1))
        if (base, base + 9) not in covered:
            ranges.append((base, base + 9, match.group(0)))
    return ranges


def number_variants(value: object) -> set[str]:
    """Digit strings the value might appear as, including spelled-out forms."""
    digits = digit_string(value)
    if not digits:
        return set()
    variants = {digits}
    if digits.isdigit() and 0 <= int(digits) <= 99:
        n = int(digits)
        words = []
        if n < 21:
            words = [w for w, d in NUMBER_WORDS.items() if d == str(n)]
        else:
            tens = n // 10 * 10
            ones = n % 10
            tens_word = [w for w, d in NUMBER_WORDS.items() if d == str(tens)]
            ones_word = [w for w, d in NUMBER_WORDS.items() if d == str(ones)] if ones else []
            words = [f"{t} {o}" for t in tens_word for o in ones_word] or tens_word
        variants.update(words)
    # transcript may speak ranges/units: "mid eighties", "lower nineties"
    for word, d in DECADE_WORDS.items():
        if digits.startswith(d) and len(digits) == 2:
            variants.add(word)
    return variants


def is_numeric_like(value: object) -> bool:
    text = str(value).strip()
    if not text:
        return False
    return bool(number_variants(text)) or bool(re.fullmatch(r"-?\d+(\.\d+)?", text))


def is_date_like(value: object) -> bool:
    return bool(DATE_LIKE_RE.match(str(value).strip()))


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


def split_sentences(transcript: str) -> list[str]:
    return [s for s in (s.strip() for s in SENTENCE_SPLIT_RE.split(transcript)) if s]


def sentence_tokens(sentence: str) -> set[str]:
    return set(TOKEN_SPLIT_RE.split(normalize(sentence)))


def zone_indices(sentences: list[str], hints: set[str]) -> list[int]:
    hits = []
    for i, sentence in enumerate(sentences):
        tokens = sentence_tokens(sentence)
        if tokens & hints:
            hits.append(i)
    zone: set[int] = set()
    for i in hits:
        zone.update(range(max(0, i - 1), min(len(sentences), i + 2)))
    return sorted(zone)


def value_in_text(value: object, text: str) -> tuple[bool, str | None]:
    norm_text = normalize(text)
    norm_value = normalize(value)
    if norm_value and norm_value in norm_text:
        pos = norm_text.find(norm_value)
        excerpt = text[max(0, pos - 60): pos + len(str(value)) + 60].strip()
        return True, excerpt
    compact_value = compact(value)
    if len(compact_value) >= 3 and compact_value in compact(text):
        return True, f"value present with different spacing/spelling: {compact_value}"
    for variant in number_variants(value):
        if variant.isdigit():
            if variant in digit_string(text):
                return True, f"digit sequence {variant} present"
        elif variant in norm_text:
            return True, f"spoken form '{variant}' present"
    return False, None


def numbers_in_text(text: str) -> set[str]:
    found: set[str] = set()
    for word, d in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", text):
            found.add(d)
    for word, d in DECADE_WORDS.items():
        if re.search(rf"\b{word}\b", text):
            found.add(d + "0")
    for match in re.finditer(r"\d+(?:\.\d+)?", text):
        found.add(match.group(0))
    return found


def comparable(value: object, other: str) -> bool:
    """True when `other` is a number of the same magnitude as `value`
    (so it plausibly contradicts it, rather than being an unrelated count,
    timestamp fragment, or area code)."""
    digits = digit_string(value)
    if not digits or not digits.isdigit() or not other.isdigit():
        return False
    if digits == other:
        return False
    return len(digits) == len(other)


def verdict_for(field_name: str, value: object, transcript: str) -> tuple[str, str | None]:
    if value is None or isinstance(value, bool) or isinstance(value, (list, dict)):
        return "unverified", "not automatically verifiable (null, boolean, or structured value)"

    sentences = split_sentences(transcript)
    hints = field_hints(field_name)
    strict = is_numeric_like(value) or is_date_like(value)
    zone = zone_indices(sentences, hints) if hints else []

    if zone:
        zone_text = " ".join(sentences[i] for i in zone)
        found, excerpt = value_in_text(value, zone_text)
        if found:
            return "verified", f"field named in transcript; value found in the same context: {excerpt}"
        if strict:
            if is_date_like(value):
                parts = value_date_parts(value)
                if parts and parts in dates_in_text(zone_text):
                    return "verified", f"date {value} matches a spoken date in the field's context"
            digits = digit_string(value)
            if digits.isdigit():
                spoken_ranges = ranges_in_text(zone_text)
                n = int(digits)
                for lo, hi, phrase in spoken_ranges:
                    if lo <= n <= hi:
                        return "verified", f"value {value} is consistent with the spoken range '{phrase}' ({lo}-{hi}) near the field name"
                nearby_numbers = numbers_in_text(zone_text)
            else:
                nearby_numbers = numbers_in_text(zone_text)
            contradictions = [
                num for num in nearby_numbers
                if digit_string(value) and num != digit_string(value) and comparable(value, num)
            ]
            if contradictions:
                return (
                    "contradicted",
                    f"transcript names the field but gives {contradictions[0]} where the result claims {value}: {zone_text[:200]}",
                )
            return "unverified", "field named in transcript, but the claimed value does not appear near it"
        # non-numeric field: allow a global match but say the field name was
        # never spoken near it
        found, excerpt = value_in_text(value, transcript)
        if found:
            return "verified", f"value found globally, not near the field name (weak match): {excerpt}"
        return "unverified", "field named in transcript, but the claimed value appears nowhere"

    # No hint sentence at all.
    if strict:
        return "unverified", "field name never spoken in transcript; numeric/date values need field context"
    found, excerpt = value_in_text(value, transcript)
    if found:
        return "verified", f"field name never spoken; value matched globally (weak match): {excerpt}"
    return "unverified", "value not found in transcript"


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
    if not transcript:
        notes.append("no transcript found; nothing can be verified")
    if task_completed:
        notes.append("platform reported task_completed; treated as a claim, not evidence")

    fields: dict[str, dict] = {}
    if isinstance(structured, dict) and structured:
        for name, value in structured.items():
            verdict, evidence = verdict_for(name, value, transcript)
            fields[name] = {"value": value, "verdict": verdict, "evidence": evidence}
    else:
        notes.append("no structured_result found; nothing extracted to verify")

    verified = sum(1 for f in fields.values() if f["verdict"] == "verified")
    contradicted = sum(1 for f in fields.values() if f["verdict"] == "contradicted")
    if not fields:
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
