#!/usr/bin/env python3
"""Validate a call-summarizer brief is well-formed before downstream use.

Usage:
    python3 scripts/validate_brief.py --brief path/to/brief.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

RAW_PHONE_RE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)")
RAW_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Account/reference/order/etc identifiers — same classes the skill masks in
# summarize_call.py. The validator must check the same PII classes the brief
# promises to remove (review item #1).
RAW_ID_RE = re.compile(
    r"\b(?:account|reference|order|case|ticket|claim|policy|invoice)\s*(?:#|no\.?|number)?\s*[A-Z0-9][A-Z0-9-]{3,}\b",
    re.IGNORECASE,
)
# Personal names following the same introduction cues the summarizer masks
# (review item #1, second pass: names were leaking through summary/verb/
# source_span while the brief claimed masked:true). The validator checks the
# same name classes the skill promises to redact.
RAW_NAME_TITLE_RE = re.compile(
    r"\b(?:Dr\.|Mr\.|Ms\.|Mrs\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b"
)
RAW_NAME_CUE_RE = re.compile(
    r"\b(?:this is|I am|I'm|my name is|name is|with me is|speaking,?\s*this is)\s+"
    r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b",
)
REQUIRED_TOP = {"outcome", "summary", "actions", "sentiment", "caller_fingerprint", "masked"}


def _leaks_pii(text: str) -> bool:
    """True if `text` contains any raw phone, email, account identifier, or
    personal name that should have been redacted."""
    return bool(
        RAW_PHONE_RE.search(text)
        or RAW_EMAIL_RE.search(text)
        or RAW_ID_RE.search(text)
        or RAW_NAME_TITLE_RE.search(text)
        or RAW_NAME_CUE_RE.search(text)
    )


def validate(brief: dict[str, Any]) -> list[str]:
    """Return a list of error strings; empty list means valid."""
    errors: list[str] = []
    missing = REQUIRED_TOP - brief.keys()
    if missing:
        errors.append(f"Missing required top-level fields: {sorted(missing)}")
    if not brief.get("outcome"):
        errors.append("outcome must be non-empty")
    if not brief.get("summary"):
        errors.append("summary must be non-empty")
    actions = brief.get("actions", [])
    if not isinstance(actions, list):
        errors.append("actions must be a list")
    else:
        for i, action in enumerate(actions):
            if not isinstance(action, dict):
                errors.append(f"action[{i}] must be an object")
                continue
            if "owner" not in action or not action["owner"]:
                errors.append(f"action[{i}] missing owner")
            if "verb" not in action or not action["verb"]:
                errors.append(f"action[{i}] missing verb")
    sentiment = brief.get("sentiment", {})
    if not isinstance(sentiment, dict) or "label" not in sentiment:
        errors.append("sentiment must be an object with a label")
    fp = brief.get("caller_fingerprint", "")
    if not isinstance(fp, str) or not fp.startswith("sha256:"):
        errors.append("caller_fingerprint must be a sha256: prefixed string")
    # The brief's `masked` field may be `true` (legacy: claims all PII masked) or
    # `"partial"` (honest: documents exactly which PII classes are tokenized and
    # which are not).  Both are valid; the validator checks that the field is
    # present and truthy.  When `"partial"`, a `masking_scope` field must also be
    # present so downstream consumers know the redaction boundary.
    masked_val = brief.get("masked")
    if masked_val is True:
        pass  # legacy form — claims all PII masked
    elif masked_val == "partial":
        if not brief.get("masking_scope"):
            errors.append("masked='partial' requires a masking_scope field")
    else:
        errors.append("masked must be true or 'partial'")
    # Masking check: no raw PII should survive in summary, action verbs, or
    # action source spans (review item #1 — verb and source_span both copy
    # raw transcript content and must be masked + validated; the second pass
    # also covers personal names, which were leaking while masked:true).
    summary = str(brief.get("summary", ""))
    if _leaks_pii(summary):
        errors.append("summary contains unmasked phone, email, account identifier, or personal name")
    for i, action in enumerate(brief.get("actions", [])):
        if isinstance(action, dict):
            verb = str(action.get("verb", ""))
            if _leaks_pii(verb):
                errors.append(f"action[{i}] verb contains unmasked PII")
            span = str(action.get("source_span", ""))
            if _leaks_pii(span):
                errors.append(f"action[{i}] source_span contains unmasked PII")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brief", required=True, help="Path to a brief JSON file.")
    args = parser.parse_args(argv)

    path = Path(args.brief)
    if not path.is_file():
        print(f"ERROR: brief file not found: {path}", file=sys.stderr)
        return 2

    try:
        brief = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in brief file: {exc}", file=sys.stderr)
        return 2

    errors = validate(brief)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 1

    print("Brief is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
