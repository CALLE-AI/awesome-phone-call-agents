#!/usr/bin/env python3
"""
place_confirmation_calls.py — appointment-call-confirm skill runner.

Reads a batch of upcoming appointments (CSV or JSON), dry-runs the list
for explicit approval, then places one outbound CALL-E call per
recipient (serially), polls each to a terminal state, and writes a
structured results CSV.

Standalone by design: only depends on `requests` and a CALL-E API key.
No dependency on any particular agent framework, so it can be pointed
at CALL-E's SDK/API/CLI/MCP directly by any host that adopts this
skill.

Usage:
    export CALLE_API_KEY=...              # required
    export CALLE_BASE_URL=...             # optional, defaults below

    # 1. Always dry-run first — this places NO calls.
    python place_confirmation_calls.py --in appointments.csv --dry-run

    # 2. Once the list looks right, run for real:
    python place_confirmation_calls.py --in appointments.csv --out results.csv

appointments.csv columns (header row required):
    recipient_name, phone, appointment_time, context, business_name[, region, locale]

    - phone: E.164, e.g. +14155550101
    - appointment_time: ISO 8601 with timezone, e.g. 2026-09-05T15:00:00-04:00
    - context: one sentence, e.g. "annual checkup with Dr. Rao"
    - business_name: who the call says it's calling on behalf of
    - region / locale: optional; region is inferred from the phone's
      country code when omitted (see references/result-schema.md)
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests

DEFAULT_BASE_URL = "https://api.heycall-e.com"

# Same region set CALL-E's Developer API documents. Only used when a
# row doesn't explicitly supply `region` — see references/result-schema.md.
_COUNTRY_CODE_TO_REGION = {
    "1": "US",   # also covers CA; CA rows should set region explicitly
    "65": "SG",
    "60": "MY",
    "91": "IN",
    "971": "AE",
    "61": "AU",
    "44": "GB",
    "84": "VN",
    "49": "DE",
    "81": "JP",
    "33": "FR",
    "52": "MX",
    "55": "BR",
    "62": "ID",
    "63": "PH",
    "254": "KE",
}

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {
            "type": "string",
            "enum": [
                "confirmed", "needs_reschedule", "declined",
                "no_answer", "voicemail", "unclear",
            ],
        },
        "requested_new_time": {"type": "string"},
        "notes": {"type": "string"},
    },
    "required": ["status"],
}

_TERMINAL_STATUSES = {"succeeded", "completed", "failed", "canceled", "cancelled", "error"}
_STRUCTURED_STATUSES = {
    "confirmed", "needs_reschedule", "declined", "no_answer", "voicemail", "unclear",
}


def _mask(phone: str) -> str:
    phone = phone.strip()
    if len(phone) <= 4:
        return "•" * len(phone)
    return phone[:5] + "•" * max(0, len(phone) - 7) + phone[-2:]


def _infer_region(phone: str) -> Optional[str]:
    digits = phone.lstrip("+")
    for length in (3, 2, 1):
        code = digits[:length]
        if code in _COUNTRY_CODE_TO_REGION:
            return _COUNTRY_CODE_TO_REGION[code]
    return None


@dataclass
class Appointment:
    recipient_name: str
    phone: str
    appointment_time: str
    context: str
    business_name: str
    region: Optional[str] = None
    locale: Optional[str] = None
    metadata: dict = field(default_factory=dict)


def load_appointments(path: Path) -> list[Appointment]:
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8"))
    else:
        with path.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))

    appts = []
    for i, row in enumerate(rows, start=1):
        missing = [
            k for k in ("recipient_name", "phone", "appointment_time", "context", "business_name")
            if not str(row.get(k, "")).strip()
        ]
        if missing:
            raise ValueError(f"Row {i}: missing required field(s): {', '.join(missing)}")
        appts.append(Appointment(
            recipient_name=row["recipient_name"].strip(),
            phone=row["phone"].strip(),
            appointment_time=row["appointment_time"].strip(),
            context=row["context"].strip(),
            business_name=row["business_name"].strip(),
            region=(row.get("region") or "").strip() or None,
            locale=(row.get("locale") or "").strip() or None,
        ))
    return appts


def build_task(appt: Appointment) -> str:
    try:
        when = datetime.fromisoformat(appt.appointment_time)
        when_human = when.strftime("%A, %B %d at %I:%M %p %Z").replace("  ", " ").strip()
    except ValueError:
        when_human = appt.appointment_time

    return (
        f"You are calling on behalf of {appt.business_name} to confirm an "
        f"upcoming appointment: {appt.context}, scheduled for {when_human}. "
        f"Politely confirm whether {appt.recipient_name} can still make it. "
        f"If not, ask whether they'd like to reschedule and to what time, or "
        f"would prefer to cancel. Keep the call brief and courteous."
    )


def dry_run_report(appts: list[Appointment]) -> None:
    print(f"\n{'='*72}\nDRY RUN — {len(appts)} appointment(s). No calls will be placed.\n{'='*72}")
    for a in appts:
        region = a.region or _infer_region(a.phone) or "UNKNOWN — will be rejected at call time"
        print(f"- {a.recipient_name:<20} {_mask(a.phone):<14} {a.appointment_time:<26} "
              f"region={region:<6} \"{a.context}\"")
    print(f"{'='*72}\nRe-run with --confirm to actually place these {len(appts)} call(s).\n")


def place_call(base_url: str, api_key: str, appt: Appointment, webhook_url: Optional[str]) -> dict:
    region = appt.region or _infer_region(appt.phone)
    if not region:
        return {"_local_error": f"could not infer region for {_mask(appt.phone)}; set region explicitly"}

    recipient = {"phones": [appt.phone], "region": region}
    if appt.locale:
        recipient["locale"] = appt.locale

    payload = {
        "task": build_task(appt),
        "recipients": [recipient],
        "result_schema": RESULT_SCHEMA,
    }
    if webhook_url:
        payload["webhook_url"] = webhook_url
    payload["metadata"] = {"recipient_name": appt.recipient_name, "appointment_time": appt.appointment_time}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": str(uuid.uuid4()),
    }
    try:
        resp = requests.post(f"{base_url}/v1/calls", headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as e:
        detail = ""
        try:
            body = e.response.json()
            err = body.get("error", body)
            detail = err.get("message", "")
            errs = (err.get("details") or {}).get("validation_errors")
            if errs:
                detail += " (" + "; ".join(
                    f"{'.'.join(str(p) for p in ve.get('loc', []))}: {ve.get('msg')}"
                    for ve in errs
                ) + ")"
        except Exception:
            detail = e.response.text[:200] if e.response is not None else str(e)
        return {"_local_error": f"CALL-E rejected the call: {detail or e}"}
    except requests.exceptions.RequestException as e:
        return {"_local_error": f"could not reach CALL-E: {e}"}


def poll_call(base_url: str, api_key: str, call_id: str, timeout_seconds: int) -> dict:
    deadline = time.time() + timeout_seconds
    headers = {"Authorization": f"Bearer {api_key}"}
    last_status = None
    while time.time() < deadline:
        resp = requests.get(f"{base_url}/v1/calls/{call_id}", headers=headers, timeout=30)
        resp.raise_for_status()
        call = resp.json()
        status = str(call.get("status", "")).lower()
        if status != last_status:
            print(f"    call {call_id} -> {status}")
            last_status = status
        if status in _TERMINAL_STATUSES:
            return call
        time.sleep(5)
    call = {"status": "pending", "_timed_out": True, "call_id": call_id}
    return call


def resolve_result(call: dict) -> tuple[str, dict]:
    status = str(call.get("status", "")).lower()
    structured = call.get("structured_result") or call.get("structuredResult") or {}

    if call.get("_timed_out"):
        return "pending", structured
    if status in {"failed", "canceled", "cancelled", "error"}:
        return "failed", structured

    result_status = str(structured.get("status", "")).lower()
    if result_status in _STRUCTURED_STATUSES:
        return result_status, structured
    return "unclear", structured


def run(args: argparse.Namespace) -> int:
    appts = load_appointments(Path(args.infile))

    if not args.confirm:
        dry_run_report(appts)
        return 0

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        print("CALLE_API_KEY is not set — cannot place real calls.", file=sys.stderr)
        return 1
    base_url = os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL).rstrip("/")

    rows = []
    for appt in appts:
        print(f"\nCalling {appt.recipient_name} ({_mask(appt.phone)}) re: {appt.context}")
        created = place_call(base_url, api_key, appt, args.webhook_url)

        if "_local_error" in created:
            print(f"  FAILED: {created['_local_error']}")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": created["_local_error"],
            })
            continue

        call_id = created.get("id")
        if not call_id:
            print(f"  FAILED: CALL-E did not return a call id: {created}")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": "no call_id returned",
            })
            continue

        final_call = poll_call(base_url, api_key, call_id, args.timeout_seconds)
        status, structured = resolve_result(final_call)
        print(f"  -> {status}" + (f" ({structured.get('requested_new_time')})"
                                    if structured.get("requested_new_time") else ""))
        rows.append({
            "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
            "appointment_time": appt.appointment_time, "call_id": call_id,
            "status": status,
            "requested_new_time": structured.get("requested_new_time", ""),
            "notes": structured.get("notes", ""),
        })

    if args.out:
        fieldnames = ["recipient_name", "phone_masked", "appointment_time", "call_id",
                      "status", "requested_new_time", "notes", "detail"]
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote {len(rows)} result(s) to {args.out}")

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    summary = ", ".join(f"{v} {k}" for k, v in counts.items())
    print(f"\nBatch summary: {summary}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="infile", required=True, help="appointments.csv or .json")
    p.add_argument("--out", dest="out", default=None, help="results CSV to write (real runs only)")
    p.add_argument("--confirm", action="store_true",
                   help="actually place calls; without this flag, always dry-runs")
    p.add_argument("--dry-run", action="store_true", help="explicit alias for the default (no --confirm) behavior")
    p.add_argument("--webhook-url", default=None, help="optional webhook CALL-E should POST terminal results to")
    p.add_argument("--timeout-seconds", type=int, default=180, help="max seconds to poll each call (default 180)")
    args = p.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())