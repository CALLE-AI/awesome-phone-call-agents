#!/usr/bin/env python3
"""Resolve one claim from a completed call. Enforces evidence-span-or-abstain in code.

    python3 scripts/verdict.py \
        --record '{"record_id":"p1","name":"Northline Family Clinic",
            "phone":"+12025550110","claims":{"accepts_plan":true}}' \
        --pack examples/healthcare.json \
        --claim accepts_plan \
        --transcript transcript.json \
        --extraction '{"answer":"no","evidence_span":"we stopped taking that plan last month"}'

`transcript.json` is CALL-E's get_call_run output OR a simple list of {speaker,text} turns.
`--extraction` is what you (the agent) read from the transcript: the answer plus a quote you
copied verbatim from a recipient turn (or evidence_span:null if there is no such quote).

Prints the attestation. Appends a row to `corrections.csv` only for an evidence-backed MISMATCH.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pcv import CORRECTION_FIELDS, corrections_row, evaluate, load_pack


def _turns(obj: object) -> list[dict]:
    """Accept a raw CALL-E call object or a plain [{speaker,text}] list."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for recipient in obj.get("recipients", []):
            for attempt in reversed(recipient.get("attempts", [])):
                turns = attempt.get("transcript_turns")
                if turns:
                    return [{"speaker": t.get("speaker"), "text": t.get("text", "")} for t in turns]
    return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--record", required=True)
    ap.add_argument("--pack", required=True, type=Path)
    ap.add_argument("--claim", required=True)
    ap.add_argument("--transcript", required=True, type=Path)
    ap.add_argument("--extraction", required=True)
    ap.add_argument("--corrections", type=Path, default=Path("corrections.csv"))
    args = ap.parse_args()

    record = json.loads(args.record)
    pack = load_pack(args.pack)
    transcript = _turns(json.loads(args.transcript.read_text(encoding="utf-8")))
    extraction = json.loads(args.extraction)

    att = evaluate(record, pack, args.claim, extraction, transcript)
    print(json.dumps(att, indent=2))

    row = corrections_row(att)
    if row:
        new = not args.corrections.exists()
        with open(args.corrections, "a", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=CORRECTION_FIELDS)
            if new:
                w.writeheader()
            w.writerow(row)
        print(f"\n-> appended a correction to {args.corrections}", file=sys.stderr)


if __name__ == "__main__":
    main()
