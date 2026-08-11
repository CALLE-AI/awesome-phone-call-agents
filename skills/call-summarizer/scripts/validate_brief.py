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
REQUIRED_TOP = {"outcome", "summary", "actions", "sentiment", "caller_fingerprint", "masked"}


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
    if brief.get("masked") is not True:
        errors.append("masked must be true")
    # Masking check: no raw PII should survive in summary or action source spans
    summary = str(brief.get("summary", ""))
    if RAW_PHONE_RE.search(summary) or RAW_EMAIL_RE.search(summary):
        errors.append("summary contains unmasked phone or email")
    for i, action in enumerate(brief.get("actions", [])):
        if isinstance(action, dict):
            span = str(action.get("source_span", ""))
            if RAW_PHONE_RE.search(span) or RAW_EMAIL_RE.search(span):
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
