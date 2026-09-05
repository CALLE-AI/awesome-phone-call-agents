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

Safety properties enforced by this script (see references/safety.md):
    - Phone numbers are validated as strict ASCII E.164 before anything
      else happens to them — no Unicode digit variants, no smuggled
      characters.
    - If --allowlist is given, only recipients whose phone exactly
      matches an allowlist entry are called; everyone else is skipped
      and reported as failed, never silently dialed.
    - Even with --confirm passed, a real run requires the operator to
      interactively type CONFIRM before any call goes out (an explicit
      --yes flag exists for non-interactive automation, and is loudly
      logged when used).
    - The API base URL is pinned to CALL-E's official HTTPS origin.
      Overriding it (CALLE_BASE_URL) requires the explicit
      --allow-custom-host flag, so the API key is never silently sent
      to an unexpected host.
    - Each call's idempotency key is a stable hash of the appointment's
      own fields, not a random value — so re-running the same batch
      after an interruption reuses the same key instead of risking a
      duplicate call to the same recipient.
    - If any call's outcome is ambiguous (poll timeout or an
      unrecognized structured result), the batch stops by default
      instead of continuing to dial the rest of the list.
    - Provider error bodies are sanitized before being printed or
      written to the results CSV.

Usage:
    export CALLE_API_KEY=...              # required
    export CALLE_BASE_URL=...             # optional, must match the
                                           # official host unless
                                           # --allow-custom-host is set

    # 1. Always dry-run first — this places NO calls.
    python place_confirmation_calls.py --in appointments.csv --dry-run

    # 2. Once the list looks right, run for real (interactive prompt
    #    still required even with --confirm):
    python place_confirmation_calls.py --in appointments.csv --out results.csv --confirm

    # 3. Optional: restrict calls to a pre-approved recipient list —
    #    anything not on it is skipped, never dialed.
    python place_confirmation_calls.py --in appointments.csv --confirm \\
        --allowlist assets/authorized_numbers.example.txt

appointments.csv columns (header row required):
    recipient_name, phone, appointment_time, context, business_name[, region, locale]

    - phone: strict ASCII E.164, e.g. +14155550101
    - appointment_time: ISO 8601 with timezone, e.g. 2026-09-05T15:00:00-04:00
    - context: one sentence, e.g. "annual checkup with Dr. Rao"
    - business_name: who the call says it's calling on behalf of
    - region / locale: optional; region is inferred from the phone's
      country code when omitted (see references/result-schema.md)
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import requests

# The one HTTPS origin bearer credentials are ever sent to by default.
# Overriding this (CALLE_BASE_URL) requires --allow-custom-host, so a
# misconfigured or malicious base URL can never silently exfiltrate
# the API key.
OFFICIAL_HOST = "api.heycall-e.com"
DEFAULT_BASE_URL = f"https://{OFFICIAL_HOST}"

# Strict ASCII E.164: '+' followed by 7-15 ASCII digits, nothing else.
# Deliberately rejects Unicode digit look-alikes (e.g. Arabic-Indic,
# fullwidth digits) and any stray characters that a naive parser might
# tolerate — a phone field is attacker-influenceable input.
_E164_RE = re.compile(r"^\+[1-9][0-9]{6,14}$")

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


def _is_ascii(s: str) -> bool:
    try:
        s.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def validate_e164(phone: str) -> tuple[bool, str]:
    """Strict ASCII E.164 check. Returns (ok, reason_if_not_ok)."""
    if not _is_ascii(phone):
        return False, "phone contains non-ASCII characters (rejected — not E.164)"
    if not _E164_RE.match(phone):
        return False, "phone is not strict ASCII E.164 (expected +<7-15 digits>)"
    return True, ""


def normalize_phone_for_match(phone: str) -> str:
    """Canonical form used for allowlist comparisons — exact match only,
    no fuzzy/partial matching, so a substring can never slip through."""
    return phone.strip()


def load_allowlist(path: Optional[str]) -> Optional[set[str]]:
    if not path:
        return None
    entries: set[str] = set()
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # allowlist lines are "phone, name, source" — only the
            # first comma-separated field is the phone to match.
            phone = line.split(",", 1)[0].strip()
            if phone:
                entries.add(normalize_phone_for_match(phone))
    return entries


def _infer_region(phone: str) -> Optional[str]:
    digits = phone.lstrip("+")
    for length in (3, 2, 1):
        code = digits[:length]
        if code in _COUNTRY_CODE_TO_REGION:
            return _COUNTRY_CODE_TO_REGION[code]
    return None


def _stable_idempotency_key(appt: "Appointment") -> str:
    """Deterministic, content-bound idempotency key — re-running the
    same batch (e.g. after a crash) reuses the same key per recipient
    instead of a fresh random UUID each time, so a retry can't create
    a second real-world call to someone already confirmed. Bound to
    the exact fields that define "this appointment", so a genuinely
    different appointment for the same person still gets its own key."""
    basis = "|".join([
        appt.recipient_name, appt.phone, appt.appointment_time,
        appt.context, appt.business_name,
    ])
    return "acc-" + hashlib.sha256(basis.encode("utf-8")).hexdigest()[:32]


def _sanitize_error_text(text: str, api_key: str) -> str:
    """Strip anything that looks like the bearer token or an
    unmasked phone number before an error body is ever printed or
    written to the results file."""
    if not text:
        return text
    if api_key:
        text = text.replace(api_key, "[REDACTED_API_KEY]")
    # Redact anything that looks like a raw E.164 number (10+ digits
    # after a +) that isn't already masked with •.
    text = re.sub(r"\+\d{7,15}", "[REDACTED_PHONE]", text)
    return text[:500]


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

        phone = row["phone"].strip()
        ok, reason = validate_e164(phone)
        if not ok:
            raise ValueError(f"Row {i} ({row.get('recipient_name', '?')}): {reason}: {phone!r}")

        appts.append(Appointment(
            recipient_name=row["recipient_name"].strip(),
            phone=phone,
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


def dry_run_report(appts: list[Appointment], allowlist: Optional[set[str]]) -> None:
    print(f"\n{'='*72}\nDRY RUN — {len(appts)} appointment(s). No calls will be placed.\n{'='*72}")
    for a in appts:
        region = a.region or _infer_region(a.phone) or "UNKNOWN — will be rejected at call time"
        auth_note = ""
        if allowlist is not None:
            auth_note = "  [ALLOWLISTED]" if normalize_phone_for_match(a.phone) in allowlist \
                else "  [NOT ON ALLOWLIST — will be skipped]"
        print(f"- {a.recipient_name:<20} {_mask(a.phone):<14} {a.appointment_time:<26} "
              f"region={region:<6} \"{a.context}\"{auth_note}")
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
        # Stable, content-bound key — NOT a fresh random UUID per run.
        # See _stable_idempotency_key() docstring for why this matters.
        "Idempotency-Key": _stable_idempotency_key(appt),
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
        return {"_local_error": f"CALL-E rejected the call: {_sanitize_error_text(detail or str(e), api_key)}"}
    except requests.exceptions.RequestException as e:
        return {"_local_error": f"could not reach CALL-E: {_sanitize_error_text(str(e), api_key)}"}


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


def _validate_base_url(base_url: str, allow_custom_host: bool) -> tuple[bool, str]:
    """Refuse to send bearer credentials anywhere but the official
    HTTPS origin unless the operator explicitly opts into a custom
    host (e.g. for local/staging testing)."""
    parts = urlsplit(base_url)
    if parts.scheme != "https":
        return False, f"base URL must use https (got {parts.scheme!r})"
    if parts.hostname != OFFICIAL_HOST and not allow_custom_host:
        return False, (
            f"base URL host {parts.hostname!r} does not match the official "
            f"CALL-E host {OFFICIAL_HOST!r}. Pass --allow-custom-host if this "
            f"is intentional (e.g. local/staging testing) — otherwise the API "
            f"key would be sent to an unexpected host."
        )
    return True, ""


def run(args: argparse.Namespace) -> int:
    appts = load_appointments(Path(args.infile))
    allowlist = load_allowlist(args.allowlist)

    if not args.confirm:
        dry_run_report(appts, allowlist)
        return 0

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        print("CALLE_API_KEY is not set — cannot place real calls.", file=sys.stderr)
        return 1
    base_url = os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL).rstrip("/")

    ok, reason = _validate_base_url(base_url, args.allow_custom_host)
    if not ok:
        print(f"REFUSING TO RUN: {reason}", file=sys.stderr)
        return 1

    # Always show the dry-run list again immediately before a real run,
    # then require an interactive typed confirmation. --confirm alone
    # is not sufficient — this is the real per-run safety gate, not
    # just a CLI flag that could be baked into a script unattended.
    dry_run_report(appts, allowlist)
    if args.yes:
        print("--yes passed: skipping interactive confirmation prompt "
              "(non-interactive/automation mode).")
    else:
        typed = input(f"Type CONFIRM to place these {len(appts)} call(s), "
                       f"or anything else to cancel: ").strip()
        if typed != "CONFIRM":
            print("Not confirmed — no calls placed.")
            return 0

    rows = []
    batch_halted = False
    for appt in appts:
        if allowlist is not None and normalize_phone_for_match(appt.phone) not in allowlist:
            print(f"\nSkipping {appt.recipient_name} ({_mask(appt.phone)}): not on allowlist")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": "not authorized: phone not on allowlist",
            })
            continue

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
            detail = _sanitize_error_text(json.dumps(created), api_key)
            print(f"  FAILED: CALL-E did not return a call id: {detail}")
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

        # An ambiguous outcome (poll timeout, or a structured result
        # CALL-E returned that doesn't match a known enum value) means
        # we don't actually know what happened on that call. Stop the
        # batch rather than compounding the uncertainty by dialing
        # more people — unless the operator explicitly opted out.
        if status in {"pending", "unclear"} and not args.continue_on_ambiguous:
            print(f"\nHALTING BATCH: outcome for {appt.recipient_name} was '{status}' "
                  f"— ambiguous result, not a clean success or failure. Check call "
                  f"{call_id} in the CALL-E dashboard before resuming. "
                  f"(Pass --continue-on-ambiguous to disable this safety stop.)")
            batch_halted = True
            break

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
    print(f"\nBatch summary: {summary}" + (" (halted early — see warning above)" if batch_halted else ""))
    return 1 if batch_halted else 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="infile", required=True, help="appointments.csv or .json")
    p.add_argument("--out", dest="out", default=None, help="results CSV to write (real runs only)")
    p.add_argument("--confirm", action="store_true",
                   help="actually place calls; without this flag, always dry-runs")
    p.add_argument("--dry-run", action="store_true", help="explicit alias for the default (no --confirm) behavior")
    p.add_argument("--yes", action="store_true",
                   help="skip the interactive CONFIRM prompt for non-interactive/automation use "
                        "(dangerous — only use when the batch has already been reviewed by a human "
                        "some other way)")
    p.add_argument("--allowlist", default=None,
                   help="path to a phone allowlist file (see assets/authorized_numbers.example.txt); "
                        "if set, only recipients whose phone exactly matches an entry are called")
    p.add_argument("--allow-custom-host", action="store_true",
                   help="allow CALLE_BASE_URL to point somewhere other than the official CALL-E host "
                        "(only for local/staging testing — bearer credentials are sent to this host)")
    p.add_argument("--continue-on-ambiguous", action="store_true",
                   help="do not halt the batch when a call's outcome is ambiguous (pending/unclear); "
                       "off by default as a safety stop")
    p.add_argument("--webhook-url", default=None, help="optional webhook CALL-E should POST terminal results to")
    p.add_argument("--timeout-seconds", type=int, default=180, help="max seconds to poll each call (default 180)")
    args = p.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
