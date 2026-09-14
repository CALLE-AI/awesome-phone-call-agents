#!/usr/bin/env python3
"""Turn a table of records + a claim pack into per-record call plans.

    python3 scripts/plan.py records.csv --pack examples/healthcare.json
    python3 scripts/plan.py --record '{"record_id":"p1","name":"Northline Family Clinic",
        "phone":"+12025550110","claims":{"accepts_plan":true}}' --pack examples/healthcare.json

For each record it prints a JSON object: the E.164 number to dial (from the record only), the
natural-language `goal` to hand to CALL-E's plan_call, and the `result_schema`. It never dials.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pcv import build_goal, build_result_schema, load_pack

E164 = re.compile(r"^\+[1-9]\d{7,14}$")
_CORE = {"record_id", "name", "phone", "address", "region", "locale"}


def _coerce(v: str) -> object:
    s = v.strip()
    low = s.lower()
    if low in {"true", "yes", "y", "1"}:
        return True
    if low in {"false", "no", "n", "0"}:
        return False
    return s


def record_from_row(row: dict) -> dict:
    row = {k.strip(): (v or "").strip() for k, v in row.items()}
    claims = {k: _coerce(v) for k, v in row.items() if k not in _CORE and v != ""}
    return {
        "record_id": row.get("record_id") or row.get("name", "record"),
        "name": row.get("name", ""),
        "phone": row.get("phone", ""),
        "address": row.get("address", ""),
        "region": row.get("region") or None,
        "locale": row.get("locale") or None,
        "claims": claims,
    }


def plan_one(record: dict, pack: dict) -> dict:
    phone = (record.get("phone") or "").strip()
    if not E164.match(phone):
        return {"record_id": record.get("record_id"), "error": f"not E.164: {phone!r}"}
    return {
        "record_id": record["record_id"],
        "dial": phone,  # the ONLY number that may be dialed for this record
        "region": record.get("region"),
        "locale": record.get("locale"),
        "goal": build_goal(pack, record),
        "result_schema": build_result_schema(pack),
        "claim_ids": [c["claim_id"] for c in pack["claims"]],
        "idempotency_key": f"pcv:{record['record_id']}:{pack['pack_id']}@{pack['version']}",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="?", type=Path)
    ap.add_argument("--record", help="a single record as a JSON object")
    ap.add_argument("--pack", required=True, type=Path)
    args = ap.parse_args()

    pack = load_pack(args.pack)
    if args.record:
        records = [json.loads(args.record)]
    elif args.csv:
        with open(args.csv, newline="", encoding="utf-8-sig") as fh:
            records = [record_from_row(r) for r in csv.DictReader(fh)]
    else:
        ap.error("give a CSV path or --record")

    for rec in records:
        print(json.dumps(plan_one(rec, pack), indent=2))


if __name__ == "__main__":
    main()
