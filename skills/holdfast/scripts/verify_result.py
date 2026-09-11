#!/usr/bin/env python3
"""Cross-check a CALL-E call's structured result against its transcript.

The platform's completion flag is its own judgment, not evidence. This script
marks each extracted field `verified` only when the transcript proves it, and
reports the call as verified / partially verified / unverified accordingly.

Evidence model (fail-closed by design):

- Provider status gate: `ok: false` or a non-COMPLETED status caps the whole
  report at `unverified`, no matter how clean the fields look.
- Speaker gate: only callee-side turns can prove a field. The assistant's
  own turns ("BOT:") are claims, not evidence.
- Field anchoring: a field verifies only in the transcript sentence that
  names it (or a known synonym). Numbers or dates from neighboring
  sentences, other dayparts, timestamps, or unrelated passages do not count.
- Negation: a value inside a negated span ("not ready", "isn't held") is
  not evidence; a negated span that denies the field is `contradicted`.
- Typed values: alphanumeric references must appear literally; the
  digit-sequence fallback applies only to values that are pure digits of
  four or more digits.
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

STRUCTURED_KEYS = ("structured_result", "structuredResult")
TRANSCRIPT_KEYS = ("transcript_turns", "transcriptTurns", "transcript")

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")
TURN_PREFIX_RE = re.compile(r"^\s*(?:\[[\d:]+\]\s*)?([A-Za-z]+)\s*:\s*")

NEGATORS = {
    "not", "no", "never", "isnt", "wasnt", "doesnt", "didnt", "hasnt",
    "havent", "wont", "cant", "couldnt", "without", "unable", "neither",
}
UN_NEGATORS = {"unavailable", "unknown", "unconfirmed", "unverified", "unready"}

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
    "ref": ("reference", "confirmation", "number", "ref"),
    "reference": ("reference", "confirmation", "number"),
    "confirmation": ("confirmation", "reference", "number"),
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

DAYPART_TOKENS = {"today", "tonight", "tomorrow", "morning", "afternoon", "evening"}
CALENDAR_DAYPARTS = {"today", "tonight", "tomorrow"}


def field_daypart(field_name: str) -> str | None:
    for token in TOKEN_SPLIT_RE.split(field_name.lower()):
        if token in CALENDAR_DAYPARTS:
            return token
    return None

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
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        return True
    return any(v.isdigit() for v in number_variants(text))


def is_date_like(value: object) -> bool:
    return bool(DATE_LIKE_RE.match(str(value).strip()))


def is_pure_digit_value(value: object) -> bool:
    return bool(re.fullmatch(r"\d{4,15}", str(value).strip()))


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


# --------------------------------------------------------------------------
# Turn and sentence model
# --------------------------------------------------------------------------

class Turn:
    def __init__(self, raw: str, speaker: str, text: str):
        self.raw = raw
        self.speaker = speaker  # "assistant" | "callee" | "unknown"
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
        if speaker_label in ("bot", "assistant", "ai", "agent"):
            speaker = "assistant"
        elif speaker_label in ("user", "callee", "human", "system", "recording", "ivr"):
            speaker = "callee"
        else:
            speaker = "unknown"
        turns.append(Turn(raw, speaker, text))
    return turns


def sentence_tokens(sentence: str) -> set[str]:
    return set(TOKEN_SPLIT_RE.split(normalize(sentence)))


def negated_span(sentence: str, value_text: str) -> bool:
    """True when the matched value sits inside a negated span."""
    norm = normalize(sentence)
    pos = norm.find(value_text)
    if pos == -1:
        return False
    before = norm[max(0, pos - 48):pos]
    return bool(re.search(
        r"\b(no|not|never|isn't|wasn't|doesn't|didn't|hasn't|haven't|won't|can't|without|un\w+)\b",
        before,
    ))


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


def dates_in_text(text: str) -> set[tuple[int, int]]:
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


def find_value_in_sentence(value: object, sentence: str) -> tuple[bool, str | None, bool]:
    """Return (found, normalized_match, negated) for one sentence."""
    norm_sentence = normalize(sentence)
    norm_value = normalize(value)
    matched_on: str | None = None
    if norm_value and norm_value in norm_sentence:
        matched_on = norm_value
    else:
        compact_value = compact(value)
        # compact fallback only for genuinely alphanumeric-resistant matches;
        # pure digit values skip it (digit fallback below handles those)
        if not is_pure_digit_value(value) and len(compact_value) >= 4 and compact_value in compact(sentence):
            matched_on = f"compact:{compact_value}"
    if matched_on:
        negated = negated_span(sentence, matched_on.split(":", 1)[-1] if matched_on.startswith("compact:") else norm_value)
        return True, matched_on, negated
    digits = digit_string(value)
    if is_pure_digit_value(value) and len(digits) >= 4 and digits in digit_string(sentence):
        return True, f"digits:{digits}", negated_span(sentence, digits)
    for variant in number_variants(value):
        if variant.isdigit():
            continue  # covered by the pure-digit rule above
        if re.search(rf"\b{re.escape(variant)}\b", norm_sentence):
            return True, f"spoken:{variant}", negated_span(sentence, variant)
    return False, None, False


def verdict_for(field_name: str, value: object, transcript: str) -> dict:
    if value is None or isinstance(value, bool) or isinstance(value, (list, dict)):
        return {
            "value": value,
            "verdict": "unverified",
            "evidence": "not automatically verifiable (null, boolean, or structured value)",
        }

    hints = field_hints(field_name)
    strict = is_numeric_like(value) or is_date_like(value)
    turns = split_turns(transcript)
    digits = digit_string(value)
    daypart = field_daypart(field_name)

    # 1) Sentence-exact, callee-side, non-negated evidence: the sentence
    #    naming the field also carries the value (literally, as a spoken
    #    variant, as a containing range, or as a matching date). A sentence
    #    anchored to a different daypart ("today" vs a "tomorrow" field)
    #    never verifies the field.
    for turn in turns:
        if turn.speaker == "assistant":
            continue
        for sentence in turn.sentences():
            tokens = sentence_tokens(sentence)
            if not tokens & hints:
                continue
            if daypart and (tokens & (CALENDAR_DAYPARTS - {daypart})):
                continue
            if is_date_like(value):
                parts = value_date_parts(value)
                if parts and parts in dates_in_text(sentence) and not negated_span(sentence, str(value)):
                    return {
                        "value": value,
                        "verdict": "verified",
                        "evidence": f"date {value} matches a spoken date in the field's sentence",
                        "speaker": turn.speaker,
                        "span": sentence[:220],
                    }
                continue
            found, matched_on, negated = find_value_in_sentence(value, sentence)
            if found and not negated:
                return {
                    "value": value,
                    "verdict": "verified",
                    "evidence": f"field named in a callee turn; value matched ('{matched_on}')",
                    "speaker": turn.speaker,
                    "span": sentence[:220],
                }
            if strict and digits.isdigit():
                n = int(digits)
                for lo, hi, phrase in ranges_in_text(sentence):
                    if lo <= n <= hi and not negated_span(sentence, phrase):
                        return {
                            "value": value,
                            "verdict": "verified",
                            "evidence": f"value {value} is consistent with the spoken range '{phrase}' ({lo}-{hi}) in the field's sentence",
                            "speaker": turn.speaker,
                            "span": sentence[:220],
                        }

    # 2) Negated, contradicted, or wrong-daypart evidence in the field's own
    #    sentence.
    for turn in turns:
        if turn.speaker == "assistant":
            continue
        for sentence in turn.sentences():
            tokens = sentence_tokens(sentence)
            if not tokens & hints:
                continue
            daypart_conflict = bool(daypart and (tokens & (CALENDAR_DAYPARTS - {daypart})))
            found, matched_on, negated = find_value_in_sentence(value, sentence)
            if found and negated:
                return {
                    "value": value,
                    "verdict": "contradicted",
                    "evidence": f"transcript denies the field value ('{matched_on}' appears in a negated span)",
                    "speaker": turn.speaker,
                    "span": sentence[:220],
                }
            if found and daypart_conflict:
                return {
                    "value": value,
                    "verdict": "unverified",
                    "evidence": f"value appears under a different daypart than the field's '{daypart}'; not evidence for this field",
                    "speaker": turn.speaker,
                    "span": sentence[:220],
                }
            if daypart_conflict:
                continue
            if strict:
                if is_date_like(value):
                    continue
                if digits.isdigit():
                    n = int(digits)
                    in_range = any(lo <= n <= hi for lo, hi, _ in ranges_in_text(sentence))
                    if in_range:
                        continue
                contradicted_number = contradicting_number_in_sentence(value, sentence)
                if contradicted_number:
                    return {
                        "value": value,
                        "verdict": "contradicted",
                        "evidence": f"transcript names the field but gives {contradicted_number} where the result claims {value}",
                        "speaker": turn.speaker,
                        "span": sentence[:220],
                    }

    # 3) Plausible: same turn but a different sentence, or assistant-only.
    for turn in turns:
        if turn.speaker == "assistant":
            continue
        for sentence in turn.sentences():
            tokens = sentence_tokens(sentence)
            if tokens & hints:
                continue
            found, matched_on, negated = find_value_in_sentence(value, sentence)
            if found and not negated:
                return {
                    "value": value,
                    "verdict": "plausible",
                    "evidence": f"value found in the same turn but not in the sentence naming the field ('{matched_on}')",
                    "speaker": turn.speaker,
                    "span": sentence[:220],
                }
    for turn in turns:
        if turn.speaker != "assistant":
            continue
        for sentence in turn.sentences():
            tokens = sentence_tokens(sentence)
            if not tokens & hints:
                continue
            found, matched_on, negated = find_value_in_sentence(value, sentence)
            if found and not negated:
                return {
                    "value": value,
                    "verdict": "plausible",
                    "evidence": f"only the assistant's own turn supports this field ('{matched_on}'); not independent evidence",
                    "speaker": turn.speaker,
                    "span": sentence[:220],
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
        "evidence": "value not found in any callee turn",
    }


def contradicting_number_in_sentence(value: object, sentence: str) -> str | None:
    digits = digit_string(value)
    if not digits.isdigit():
        return None
    n = int(digits)
    for lo, hi, phrase in ranges_in_text(sentence):
        if lo <= n <= hi:
            return None
    for num in numbers_in_text(sentence):
        if comparable(value, num):
            return num
    return None


NON_TERMINAL_OK = {"COMPLETED"}


def provider_blocks_verification(result: dict) -> str | None:
    """Return a reason string when provider-level signals cap the report."""
    ok = find_key(result, ("ok",))
    if ok is False:
        return "provider reported ok=false; the call output cannot be trusted"
    status = find_key(result, ("status",))
    if status is not None and str(status).upper() not in NON_TERMINAL_OK:
        return f"call status is {status}, not COMPLETED; fields are not evidence of success"
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

    fields: dict[str, dict] = {}
    if isinstance(structured, dict) and structured:
        for name, value in structured.items():
            fields[name] = verdict_for(name, value, transcript)
    else:
        notes.append("no structured_result found; nothing extracted to verify")

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
