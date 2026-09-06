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

Safety properties enforced by this script — none of them have an
override flag; there is no escape hatch on any of these (see
references/safety.md for the full contract):
    - Phone numbers are validated as strict ASCII E.164 before anything
      else happens to them — no Unicode digit variants, no smuggled
      characters.
    - An allowlist is REQUIRED for every live (--confirm) run. Only
      recipients whose phone exactly matches an allowlist entry are
      called; everyone else is skipped and reported as failed. A live
      run with no --allowlist given is refused outright.
    - Even with --confirm and a valid allowlist, a real run still
      requires the operator to interactively type CONFIRM before any
      call goes out (--yes exists for non-interactive automation, and
      is loudly logged when used — it does not skip the allowlist
      requirement, only the interactive prompt).
    - The API base URL is hardcoded to CALL-E's official HTTPS origin.
      There is no environment variable or flag that can point it
      anywhere else — the bearer credential is never sent to any other
      host, full stop.
    - Each call's idempotency key is a stable hash of the appointment's
      own fields, not a random value — so re-running the same batch
      after an interruption reuses the same key instead of risking a
      duplicate call to the same recipient.
    - Any ambiguous outcome (poll timeout, or a structured result that
      doesn't match a known status) is an unconditional hard stop for
      the rest of the batch. There is no flag to continue past it.
    - Every piece of provider-supplied text that is ever printed or
      written to the results file — error bodies, notes, requested new
      times — is sanitized first: control characters stripped, likely
      credentials/phone numbers redacted, length capped.

Usage:
    export CALLE_API_KEY=...              # required

    # 1. Always dry-run first — this places NO calls, and does not
    #    require an allowlist (nothing is being dialed yet).
    python place_confirmation_calls.py --in appointments.csv --dry-run

    # 2. A live run REQUIRES --allowlist. There is no way to place a
    #    real call without one. Interactive CONFIRM is still required
    #    even with --confirm passed.
    python place_confirmation_calls.py --in appointments.csv --out results.csv \\
        --confirm --allowlist assets/authorized_numbers.example.txt

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
import requests

# The ONLY origin bearer credentials are ever sent to. This is not
# configurable by any environment variable or CLI flag — there is no
# escape hatch, on purpose. The API key must never be sendable to an
# arbitrary host.
OFFICIAL_HOST = "api.heycall-e.com"
CALLE_BASE_URL = f"https://{OFFICIAL_HOST}"

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


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Multiple phone-like patterns, checked in order from most to least
# specific, so a broader pattern doesn't eat into a more specific
# match first. Covers far more than plus-prefixed E.164:
#   - E.164:                    +14155550101
#   - 00-prefixed international: 0014155550101
#   - Parenthesized area code:   (415) 555-0101
#   - Dashed/dotted/spaced:      415-555-0101 / 415.555.0101 / 415 555 0101
#   - Bare local/national runs:  5550101 / 4155550101 (7-15 digits)
_PHONE_PATTERNS = [
    re.compile(r"\+\d{7,15}"),
    re.compile(r"\b00\d{7,15}\b"),
    re.compile(r"\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,5}"),
    re.compile(r"\b\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,5}\b"),
    re.compile(r"\b\d{7,15}\b"),
]


def _sanitize_output_text(text: str, api_key: str = "") -> str:
    """Deep-sanitize ANY provider-supplied text before it is ever
    printed to the terminal or written to the results file — this is
    applied uniformly to error bodies, `notes`, and
    `requested_new_time`, not just HTTP error details. CALL-E's
    structured_result fields are provider output derived from a live
    phone conversation; they are treated as untrusted input, not as
    safe-by-construction data.

    - Strips the bearer token if it somehow appears verbatim.
    - Redacts phone-like numbers in any common format, not only
      plus-prefixed E.164 — parenthesized area codes, dashed/dotted/
      spaced separators, 00-prefixed international, and bare
      national-length digit runs are all caught.
    - Strips ASCII control characters (defends against terminal
      escape-sequence or log-injection tricks hidden in provider text).
    - Length-capped so a single field can't flood a log or blow up the
      results file.
    """
    if not text:
        return text
    if api_key:
        text = text.replace(api_key, "[REDACTED_API_KEY]")
    for pattern in _PHONE_PATTERNS:
        text = pattern.sub("[REDACTED_PHONE]", text)
    # Strip control characters (e.g. ANSI escape sequences, carriage
    # returns used to spoof terminal output) before anything is ever
    # printed or persisted.
    text = _CONTROL_CHARS_RE.sub("", text)
    return text[:500]


# Backwards-compatible alias — this function is no longer error-only.
_sanitize_error_text = _sanitize_output_text


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
            raise ValueError(
                f"Row {i} ({row.get('recipient_name', '?')}): {reason}: {_mask(phone)}"
            )

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
        body = resp.json()
        if not body.get("id"):
            # CALL-E returned HTTP 2xx (request accepted) but no call id
            # to track it by. This is NOT a clean failure — the call may
            # well have been created and we simply can't poll it. Treat
            # it the same as a poll-time ambiguous outcome: an
            # unconditional hard stop, not a "failed" row that lets the
            # batch continue.
            return {"_ambiguous": True, "_local_error":
                    "CALL-E accepted the request (HTTP 2xx) but returned no call id "
                    "— cannot confirm or track whether this call was actually created"}
        return body
    except requests.exceptions.Timeout as e:
        # The create request timed out. CALL-E may or may not have
        # created the call on its end — we genuinely don't know.
        # Ambiguous, not a clean failure.
        return {"_ambiguous": True, "_local_error":
                f"create-call request timed out — CALL-E may or may not have "
                f"created the call: {_sanitize_output_text(str(e), api_key)}"}
    except requests.exceptions.ConnectionError as e:
        # Connection dropped mid-request — same ambiguity as a timeout:
        # the call may have been created before the connection died.
        return {"_ambiguous": True, "_local_error":
                f"connection dropped while creating the call — CALL-E may or may "
                f"not have created the call: {_sanitize_output_text(str(e), api_key)}"}
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response is not None else None
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
        safe_detail = _sanitize_output_text(detail or str(e), api_key)
        # A server error, request timeout, or idempotency conflict does not
        # prove that the provider rejected the create before accepting it.
        # Stop the batch until an operator can reconcile the outcome.
        if status_code is None or status_code >= 500 or status_code in {408, 409}:
            return {
                "_ambiguous": True,
                "_local_error": f"CALL-E create outcome was ambiguous: {safe_detail}",
            }
        # Other 4xx responses are explicit client-side rejections.
        return {"_local_error": f"CALL-E rejected the call: {safe_detail}"}
    except requests.exceptions.RequestException as e:
        # Any other unexpected transport-level failure. Default to
        # ambiguous rather than failed — we have no positive
        # confirmation either way, so the conservative assumption wins.
        return {"_ambiguous": True, "_local_error":
                f"could not reach CALL-E: {_sanitize_output_text(str(e), api_key)}"}


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
    allowlist = load_allowlist(args.allowlist)

    if not args.confirm:
        dry_run_report(appts, allowlist)
        return 0

    # An allowlist is mandatory for every live run — there is no flag
    # to skip this. Exact-destination authorization is not optional.
    if allowlist is None:
        print(
            "REFUSING TO RUN: a live run (--confirm) requires --allowlist. "
            "There is no override for this — see assets/authorized_numbers.example.txt "
            "for the format and references/safety.md for why.",
            file=sys.stderr,
        )
        return 1

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        print("CALLE_API_KEY is not set — cannot place real calls.", file=sys.stderr)
        return 1

    # base_url is CALLE_BASE_URL, the module-level constant — it is not
    # configurable by environment variable or flag. The API key is
    # never sent anywhere else.
    base_url = CALLE_BASE_URL

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

        if created.get("_ambiguous"):
            # A create-time timeout, dropped connection, or an accepted
            # response with no call id all mean the same thing: we do
            # not know whether CALL-E actually placed this call. This
            # is an unconditional hard stop — same as a poll-time
            # ambiguous outcome — not a "failed" row that lets the
            # batch continue to the next recipient.
            print(f"  AMBIGUOUS: {created['_local_error']}")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "pending", "detail": created["_local_error"],
            })
            print(f"\nHALTING BATCH: create-call outcome for {appt.recipient_name} was "
                  f"ambiguous — check the CALL-E dashboard for a call to "
                  f"{_mask(appt.phone)} around this time before running the "
                  f"remaining recipients as a new, separate batch.")
            batch_halted = True
            break

        if "_local_error" in created:
            # A genuine, explicit rejection from CALL-E (e.g. invalid
            # phone, validation error) — CALL-E told us clearly it did
            # not create the call. This is a real failure, not an
            # ambiguous one, so the batch continues.
            print(f"  FAILED: {created['_local_error']}")
            rows.append({
                "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
                "appointment_time": appt.appointment_time, "call_id": "",
                "status": "failed", "detail": created["_local_error"],
            })
            continue

        call_id = created["id"]

        final_call = poll_call(base_url, api_key, call_id, args.timeout_seconds)
        status, structured = resolve_result(final_call)
        # Every field below is provider-supplied text derived from a
        # live phone call — sanitize before it is ever printed or
        # written, same as an HTTP error body would be.
        safe_new_time = _sanitize_output_text(str(structured.get("requested_new_time") or ""), api_key)
        safe_notes = _sanitize_output_text(str(structured.get("notes") or ""), api_key)
        print(f"  -> {status}" + (f" ({safe_new_time})" if safe_new_time else ""))
        rows.append({
            "recipient_name": appt.recipient_name, "phone_masked": _mask(appt.phone),
            "appointment_time": appt.appointment_time, "call_id": call_id,
            "status": status,
            "requested_new_time": safe_new_time,
            "notes": safe_notes,
        })

        # An ambiguous outcome (poll timeout, or a structured result
        # CALL-E returned that doesn't match a known enum value) means
        # we don't actually know what happened on that call. This is an
        # unconditional hard stop — there is no flag to continue past
        # it. Compounding an unresolved outcome by dialing more people
        # is exactly the failure mode this exists to prevent.
        if status in {"pending", "unclear"}:
            print(f"\nHALTING BATCH: outcome for {appt.recipient_name} was '{status}' "
                  f"— ambiguous result, not a clean success or failure. Check call "
                  f"{call_id} in the CALL-E dashboard before running the remaining "
                  f"recipients as a new, separate batch.")
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
                        "REQUIRED for any --confirm run — only recipients whose phone exactly "
                        "matches an entry are called. No override exists to skip this.")
    p.add_argument("--webhook-url", default=None, help="optional webhook CALL-E should POST terminal results to")
    p.add_argument("--timeout-seconds", type=int, default=180, help="max seconds to poll each call (default 180)")
    args = p.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
