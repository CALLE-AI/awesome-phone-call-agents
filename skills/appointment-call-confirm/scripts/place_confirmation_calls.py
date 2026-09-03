#!/usr/bin/env python3
"""
place_confirmation_calls.py — appointment-call-confirm skill runner.

Reads a batch of upcoming appointments (CSV or JSON), dry-runs the list
for explicit approval, then places one outbound CALL-E call per
recipient (serially), polls each to a terminal state, and writes a
structured results CSV.

Dependency-free dry run: `--in appointments.csv` with no `--confirm`
uses only the Python standard library — no install step needed to
review a batch before deciding whether to call anyone.

Live calls need one dependency:
    pip install -r requirements.txt

Usage:
    # 1. Always dry-run first — this places NO calls and needs no install.
    python place_confirmation_calls.py --in appointments.csv

    # 2. Once the list looks right, install the one dependency and run for real:
    pip install -r requirements.txt
    export CALLE_API_KEY=...
    python place_confirmation_calls.py \
        --in appointments.csv \
        --authorized-numbers authorized_numbers.txt \
        --out results.csv \
        --confirm

appointments.csv columns (header row required):
    recipient_name, phone, appointment_time, context, business_name[, region, locale]

    - phone: E.164, e.g. +14155550101
    - appointment_time: ISO 8601 with timezone, e.g. 2026-09-05T15:00:00-04:00
    - context: one sentence, e.g. "annual checkup with Dr. Rao"
    - business_name: who the call says it's calling on behalf of
    - region / locale: optional; region is inferred from the phone's
      country code when omitted (see references/result-schema.md)

authorized_numbers.txt (required for --confirm — see references/safety.md):
    One E.164 number per line. Every recipient's `phone` must appear
    in this file before this script will place a live call to them.
    This is a separate, explicit gate from --confirm: --confirm says
    "I want this batch to place real calls"; the authorized-numbers
    file says "I have confirmed consent for these specific numbers."
    Keep this file out of version control — see assets/authorized_numbers.example.txt
    for the format only.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.heycall-e.com"

# The only CALL-E origins this script will ever send the API key to.
# CALLE_BASE_URL can override the URL used (e.g. for a documented
# staging environment) but never the *trust* decision — an override
# pointing anywhere outside this allowlist is refused rather than
# silently sending the bearer key to an arbitrary host. Extend this
# set explicitly if CALL-E ever documents another real origin.
_ALLOWED_CALLE_HOSTS = {"api.heycall-e.com"}

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

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")

# Coarse national-numbering-plan digit-length check (country code +
# subscriber number, total digits after the leading '+'). This is not
# a full numbering-plan validator — CALL-E's API is the final
# authority — but it catches obviously malformed numbers (wrong
# length, missing country code, copy-paste typos) before any of them
# are ever sent to a live endpoint. A tuple means either length is
# valid for that region.
_REGION_DIGIT_LENGTHS = {
    "US": 11, "CA": 11, "SG": 10, "MY": (11, 12), "IN": 12,
    "AE": 12, "AU": (11, 12), "GB": 12, "VN": (10, 12),
    "DE": (11, 13), "JP": (12, 13), "FR": 11, "MX": 12,
    "BR": 12, "ID": (11, 13), "PH": 12, "KE": 12,
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


def _require_requests():
    """Import requests lazily, so dry-run never needs it installed."""
    try:
        import requests
        return requests
    except ImportError as e:
        print(
            "The `requests` package is required to place live calls.\n"
            "Install it first:\n\n    pip install -r requirements.txt\n\n"
            "(Dry-run mode above doesn't need it — this is only needed with --confirm.)",
            file=sys.stderr,
        )
        raise SystemExit(1) from e


def _validate_base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        raise SystemExit(
            f"Refusing to run: CALL-E base URL {base_url!r} is not HTTPS. "
            f"The API key is never sent over a non-HTTPS origin."
        )
    if parsed.hostname not in _ALLOWED_CALLE_HOSTS:
        raise SystemExit(
            f"Refusing to run: {parsed.hostname!r} is not an allowlisted CALL-E "
            f"origin ({sorted(_ALLOWED_CALLE_HOSTS)}). CALLE_BASE_URL is never "
            f"trusted blindly, since it decides where the bearer API key gets "
            f"sent. If this is a genuine alternate CALL-E origin, add it to "
            f"_ALLOWED_CALLE_HOSTS in this script explicitly first."
        )
    return base_url.rstrip("/")


def _load_authorized_numbers(path: Optional[str]) -> set[str]:
    if not path:
        return set()
    numbers = set()
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            numbers.add(line)
    return numbers


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


def _validate_e164_for_region(phone: str, region: str) -> Optional[str]:
    """Returns None if the number passes validation, else a reason it didn't."""
    if not _E164_RE.match(phone):
        return f"{_mask(phone)} is not a valid E.164 number (must be + followed by 7-15 digits)"
    digits = len(phone) - 1  # exclude leading '+'
    expected = _REGION_DIGIT_LENGTHS.get(region)
    if expected is None:
        return f"region {region!r} has no known digit-length rule — add one before calling this destination"
    allowed = expected if isinstance(expected, tuple) else (expected,)
    if digits not in allowed:
        return (f"{_mask(phone)} has {digits} digits, which doesn't match the "
                f"expected length for region {region} ({'/'.join(map(str, allowed))})")
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
        reason = None
        if region and region != "UNKNOWN — will be rejected at call time":
            reason = _validate_e164_for_region(a.phone, region)
        flag = f"  [WOULD BE REJECTED: {reason}]" if reason else ""
        print(f"- {a.recipient_name:<20} {_mask(a.phone):<14} {a.appointment_time:<26} "
              f"region={region:<6} \"{a.context}\"{flag}")
    print(f"{'='*72}\nRe-run with --confirm (and --authorized-numbers) to actually place "
          f"these {len(appts)} call(s).\n")


def place_call(requests, base_url: str, api_key: str, appt: Appointment,
                webhook_url: Optional[str]) -> dict:
    region = appt.region or _infer_region(appt.phone)
    if not region:
        return {"_local_error": f"could not infer region for {_mask(appt.phone)}; set region explicitly"}

    e164_error = _validate_e164_for_region(appt.phone, region)
    if e164_error:
        return {"_local_error": f"refusing to call: {e164_error}"}

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

    # Deterministic (not random) idempotency key: if this exact call is
    # ever submitted twice — e.g. an operator naively re-runs after a
    # halt without checking what actually happened — CALL-E's
    # idempotency handling gets a chance to recognize the duplicate
    # instead of dialing the same recipient twice.
    idem_seed = f"{appt.phone}|{appt.appointment_time}|{appt.context}"
    idempotency_key = str(uuid.uuid5(uuid.NAMESPACE_URL, idem_seed))

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
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
        return {"_local_error": f"could not reach CALL-E (outcome unknown — do not assume this call was not created): {e}"}


def poll_call(requests, base_url: str, api_key: str, call_id: str, timeout_seconds: int) -> dict:
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


def _write_results(out_path: Optional[str], rows: list[dict]) -> None:
    if not out_path:
        return
    fieldnames = ["recipient_name", "phone_masked", "appointment_time", "call_id",
                  "status", "requested_new_time", "notes", "detail"]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nWrote {len(rows)} result(s) so far to {out_path}")


def run(args: argparse.Namespace) -> int:
    appts = load_appointments(Path(args.infile))

    if not args.confirm:
        dry_run_report(appts)
        return 0

    if not args.authorized_numbers:
        print(
            "Refusing to run: --confirm requires --authorized-numbers <file>.\n"
            "--confirm says you want this batch to place real calls;\n"
            "--authorized-numbers is the separate, explicit record of which\n"
            "specific phone numbers you've actually confirmed consent for.\n"
            "See assets/authorized_numbers.example.txt for the format, and\n"
            "references/safety.md for why these are kept as two separate gates.",
            file=sys.stderr,
        )
        return 1
    authorized = _load_authorized_numbers(args.authorized_numbers)

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        print("CALLE_API_KEY is not set — cannot place real calls.", file=sys.stderr)
        return 1

    requests = _require_requests()
    base_url = _validate_base_url(os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL))

    rows: list[dict] = []
    for appt in appts:
        print(f"\nCalling {appt.recipient_name} ({_mask(appt.phone)}) re: {appt.context}")

        if appt.phone not in authorized:
            print(f"  HALTED: {_mask(appt.phone)} is not listed in {args.authorized_numbers}.")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": "not in authorized-numbers file — call not placed",
            })
            _write_results(args.out, rows)
            print(
                "\nBatch halted before this call was placed. Nothing was dialed for "
                "this recipient or anyone listed after them. Add the number to the "
                "authorized-numbers file once consent is confirmed, then re-run."
            )
            return 1

        created = place_call(requests, base_url, api_key, appt, args.webhook_url)

        if "_local_error" in created:
            print(f"  HALTED: {created['_local_error']}")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": created["_local_error"],
            })
            _write_results(args.out, rows)
            print(
                "\nBatch halted — the create-call response was ambiguous, so whether "
                "this call actually went out is unknown. Check the CALL-E dashboard "
                "or GET /v1/calls with this recipient's number before re-running, to "
                "avoid dialing them twice. Nobody after this recipient was called."
            )
            return 1

        call_id = created.get("id")
        if not call_id:
            print(f"  HALTED: CALL-E did not return a call id: {created}")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": "no call_id returned",
            })
            _write_results(args.out, rows)
            print(
                "\nBatch halted — CALL-E accepted the request but returned no call id, "
                "so this call's real state can't be tracked. Check the CALL-E dashboard "
                "before re-running. Nobody after this recipient was called."
            )
            return 1

        final_call = poll_call(requests, base_url, api_key, call_id, args.timeout_seconds)
        status, structured = resolve_result(final_call)

        if status == "pending":
            print(f"  HALTED: polling timed out before call {call_id} reached a terminal state.")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": call_id,
                "status": "pending", "detail": "poll timed out — true outcome unknown",
            })
            _write_results(args.out, rows)
            print(
                f"\nBatch halted — call {call_id}'s real outcome is unknown (it may "
                f"still be in progress on CALL-E's side). Check "
                f"GET /v1/calls/{call_id} directly before re-running any remaining "
                f"recipients, to avoid a duplicate call reaching someone CALL-E is "
                f"still processing."
            )
            return 1

        # Known, terminal outcome — confirmed/declined/no_answer/voicemail/unclear
        # are all certain results even when the appointment itself still needs a
        # human follow-up (e.g. declined). Safe to continue to the next recipient.
        print(f"  -> {status}" + (f" ({structured.get('requested_new_time')})"
                                    if structured.get("requested_new_time") else ""))
        rows.append({
            "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
            "appointment_time": appt.appointment_time, "call_id": call_id,
            "status": status,
            "requested_new_time": structured.get("requested_new_time", ""),
            "notes": structured.get("notes", ""),
        })

    _write_results(args.out, rows)

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
    p.add_argument("--authorized-numbers", dest="authorized_numbers", default=None,
                   help="path to a file of E.164 numbers you've confirmed consent for; required with --confirm")
    p.add_argument("--webhook-url", default=None, help="optional webhook CALL-E should POST terminal results to")
    p.add_argument("--timeout-seconds", type=int, default=180, help="max seconds to poll each call (default 180)")
    args = p.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
