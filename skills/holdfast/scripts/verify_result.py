#!/usr/bin/env python3
"""Cross-check a CALL-E call's structured result against its transcript.

The platform's completion flag is its own judgment, not evidence. This script
marks each extracted field `verified` only when the transcript contains
supporting text for it, and reports the call as verified / partially
verified / unverified accordingly. A human reviewer may still downgrade a
field to `contradicted`; this script never marks fields contradicted on its
own.

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
    decade = {"eighties": "8", "nineties": "9", "seventies": "7", "sixties": "6", "fifties": "5"}
    for word, d in decade.items():
        if digits.startswith(d) and len(digits) == 2:
            variants.add(word)
    return variants


def verdict_for(value: object, transcript: str) -> tuple[str, str | None]:
    if value is None or isinstance(value, bool) or isinstance(value, (list, dict)):
        return "unverified", "not automatically verifiable (null, boolean, or structured value)"
    norm_value = normalize(value)
    norm_transcript = normalize(transcript)
    if norm_value and norm_value in norm_transcript:
        pos = norm_transcript.find(norm_value)
        excerpt = transcript[max(0, pos - 60) : pos + len(str(value)) + 60].strip()
        return "verified", excerpt
    compact_value = compact(value)
    if len(compact_value) >= 3 and compact_value in compact(transcript):
        return "verified", f"value present in transcript with different spacing/spelling: {compact_value}"
    for variant in number_variants(value):
        if variant.isdigit():
            if variant in digit_string(transcript):
                return "verified", f"digit sequence {variant} present in transcript"
        elif variant in norm_transcript:
            return "verified", f"spoken form '{variant}' present in transcript"
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
            verdict, evidence = verdict_for(value, transcript)
            fields[name] = {"value": value, "verdict": verdict, "evidence": evidence}
    else:
        notes.append("no structured_result found; nothing extracted to verify")

    verified = sum(1 for f in fields.values() if f["verdict"] == "verified")
    if not fields:
        overall = "unverified"
    elif verified == len(fields):
        overall = "verified"
    elif verified > 0:
        overall = "partially verified"
    else:
        overall = "unverified"

    print(json.dumps({"overall": overall, "fields": fields, "notes": notes}, indent=2, default=str))


if __name__ == "__main__":
    main()
