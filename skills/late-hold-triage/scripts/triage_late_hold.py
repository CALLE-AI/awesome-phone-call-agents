#!/usr/bin/env python3
"""
triage_late_hold.py — late-hold-triage skill runner.

One late guest, one hold window, at most one CALL-E call. Dry-run is the
default and uses only the Python standard library. Live calls need:

    pip install -r requirements.txt
    export CALLE_API_KEY=...
    python3 triage_late_hold.py --in holds.csv --authorized-numbers allow.txt --confirm

holds.csv columns (header required):
    guest_name, phone, slot_start, hold_until, business_name, context
    [, region, locale]

    phone: E.164, e.g. +14155550101
    slot_start / hold_until: ISO 8601 with timezone
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.heycall-e.com"
_ALLOWED_CALLE_HOSTS = {"api.heycall-e.com"}
_E164_RE = re.compile(r"\+[1-9][0-9]{6,14}$")
_FICTIONAL_NANP_RE = re.compile(r"^\+1[0-9]{3}55501[0-9]{2}$")

_COUNTRY_CODE_TO_REGION = {
    "1": "US",
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
    "82": "KR",
}

_REGION_DIGIT_LENGTHS = {
    "US": 11, "CA": 11, "SG": 10, "MY": (11, 12), "IN": 12,
    "AE": 12, "AU": (11, 12), "GB": 12, "VN": (10, 12),
    "DE": (11, 13), "JP": (12, 13), "FR": 11, "MX": 12,
    "BR": 12, "ID": (11, 13), "PH": 12, "KE": 12, "KR": 12,
}

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {
            "type": "string",
            "enum": ["answered", "no_answer", "voicemail", "unclear"],
        },
        "still_coming": {"type": "boolean"},
        "eta_minutes": {"type": "integer", "minimum": 0},
        "released": {"type": "boolean"},
        "confirmation_quote": {"type": "string"},
    },
    "required": ["status"],
}

_TERMINAL_STATUSES = {
    "succeeded", "completed", "failed", "canceled", "cancelled", "error",
}

KEEP_HOLD = "KEEP_HOLD"
RELEASE_NOW = "RELEASE_NOW"
NEEDS_HUMAN = "NEEDS_HUMAN"
HOLD_EXPIRED = "HOLD_EXPIRED"


@dataclass(frozen=True)
class Hold:
    guest_name: str
    phone: str
    slot_start: datetime
    hold_until: datetime
    business_name: str
    context: str
    region: Optional[str] = None
    locale: Optional[str] = None


@dataclass(frozen=True)
class Spoken:
    status: str
    still_coming: Optional[bool] = None
    eta_minutes: Optional[int] = None
    released: Optional[bool] = None
    confirmation_quote: Optional[str] = None


@dataclass(frozen=True)
class Decision:
    decision: str
    remaining_minutes: int
    spoken: Optional[Spoken]
    reason: str
    next_step: str
    call_id: Optional[str] = None


def mask_phone(phone: str) -> str:
    phone = phone.strip()
    if len(phone) <= 4:
        return "•" * len(phone)
    return phone[:5] + "•" * max(0, len(phone) - 7) + phone[-2:]


def infer_region(phone: str) -> Optional[str]:
    digits = phone.lstrip("+")
    for length in (3, 2, 1):
        code = digits[:length]
        if code in _COUNTRY_CODE_TO_REGION:
            return _COUNTRY_CODE_TO_REGION[code]
    return None


def is_reserved_fictional(phone: str) -> bool:
    return bool(_FICTIONAL_NANP_RE.match(phone.strip()))


def validate_e164_for_region(phone: str, region: str) -> Optional[str]:
    if not _E164_RE.fullmatch(phone):
        return f"{mask_phone(phone)} is not a valid E.164 number"
    inferred = infer_region(phone)
    compatible = {inferred}
    if inferred == "US":
        compatible.add("CA")
    if region not in compatible:
        return (
            f"{mask_phone(phone)} country calling code does not match "
            f"region {region!r}"
        )
    digits = len(phone) - 1
    expected = _REGION_DIGIT_LENGTHS.get(region)
    if expected is None:
        return f"region {region!r} has no digit-length rule"
    allowed = expected if isinstance(expected, tuple) else (expected,)
    if digits not in allowed:
        return (
            f"{mask_phone(phone)} has {digits} digits; "
            f"{region} expects {'/'.join(map(str, allowed))}"
        )
    return None


def parse_iso(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} is not ISO 8601: {value!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone: {value!r}")
    return parsed


def load_holds(path: Path) -> list[Hold]:
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(rows, dict):
            rows = [rows]
    else:
        with path.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))

    holds: list[Hold] = []
    required = (
        "guest_name", "phone", "slot_start", "hold_until",
        "business_name", "context",
    )
    for index, row in enumerate(rows, start=1):
        missing = [key for key in required if not str(row.get(key, "")).strip()]
        if missing:
            raise ValueError(f"Row {index}: missing {', '.join(missing)}")
        slot_start = parse_iso(row["slot_start"].strip(), "slot_start")
        hold_until = parse_iso(row["hold_until"].strip(), "hold_until")
        if hold_until <= slot_start:
            raise ValueError(f"Row {index}: hold_until must be after slot_start")
        holds.append(
            Hold(
                guest_name=row["guest_name"].strip(),
                phone=row["phone"].strip(),
                slot_start=slot_start,
                hold_until=hold_until,
                business_name=row["business_name"].strip(),
                context=row["context"].strip(),
                region=(row.get("region") or "").strip() or None,
                locale=(row.get("locale") or "").strip() or None,
            )
        )
    if not holds:
        raise ValueError("No hold rows found")
    return holds


def load_authorized_numbers(path: Optional[str]) -> set[str]:
    if not path:
        return set()
    numbers: set[str] = set()
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            numbers.add(line)
    return numbers


def load_dry_run_outcomes(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("dry-run outcomes file must be an object keyed by phone")
    return payload


def spoken_from_mapping(payload: dict[str, Any]) -> Spoken:
    status = str(payload.get("status") or "unclear")
    eta = payload.get("eta_minutes", None)
    if eta is not None:
        eta = int(eta)
        if eta < 0:
            raise ValueError("eta_minutes cannot be negative")
    still = payload.get("still_coming", None)
    if still is not None:
        still = bool(still)
    released = payload.get("released", None)
    if released is not None:
        released = bool(released)
    quote = payload.get("confirmation_quote")
    return Spoken(
        status=status,
        still_coming=still,
        eta_minutes=eta,
        released=released,
        confirmation_quote=str(quote) if quote else None,
    )


def remaining_minutes(hold: Hold, now: datetime) -> int:
    delta = hold.hold_until - now
    return int(delta.total_seconds() // 60)


def decide(hold: Hold, now: datetime, spoken: Optional[Spoken]) -> Decision:
    remaining = remaining_minutes(hold, now)
    if now >= hold.hold_until:
        return Decision(
            decision=HOLD_EXPIRED,
            remaining_minutes=remaining,
            spoken=spoken,
            reason="the hold window has already ended",
            next_step="do not call; the house has already released this slot",
        )
    if spoken is None:
        return Decision(
            decision=NEEDS_HUMAN,
            remaining_minutes=remaining,
            spoken=None,
            reason="no spoken result is available",
            next_step="a human must read this hold",
        )
    if spoken.status in {"no_answer", "voicemail", "unclear"}:
        return Decision(
            decision=NEEDS_HUMAN,
            remaining_minutes=remaining,
            spoken=spoken,
            reason=f"call status is {spoken.status}",
            next_step="a human must read this call; do not auto-release",
        )
    if spoken.status != "answered":
        return Decision(
            decision=NEEDS_HUMAN,
            remaining_minutes=remaining,
            spoken=spoken,
            reason=f"unrecognized status {spoken.status!r}",
            next_step="a human must read this call",
        )
    if spoken.released is True or spoken.still_coming is False:
        return Decision(
            decision=RELEASE_NOW,
            remaining_minutes=remaining,
            spoken=spoken,
            reason="the guest released the slot",
            next_step="start a cascade skill if you want the slot filled",
        )
    if spoken.still_coming is True:
        if spoken.eta_minutes is None:
            return Decision(
                decision=NEEDS_HUMAN,
                remaining_minutes=remaining,
                spoken=spoken,
                reason="guest said they are coming but gave no numeric ETA",
                next_step="a human must read this call",
            )
        if spoken.eta_minutes <= remaining:
            return Decision(
                decision=KEEP_HOLD,
                remaining_minutes=remaining,
                spoken=spoken,
                reason=(
                    f"guest ETA {spoken.eta_minutes}m is inside the "
                    f"{remaining}m hold"
                ),
                next_step="keep the slot; do not start a cascade",
            )
        return Decision(
            decision=RELEASE_NOW,
            remaining_minutes=remaining,
            spoken=spoken,
            reason=(
                f"guest ETA {spoken.eta_minutes}m exceeds the "
                f"{remaining}m hold"
            ),
            next_step="start a cascade skill if you want the slot filled",
        )
    return Decision(
        decision=NEEDS_HUMAN,
        remaining_minutes=remaining,
        spoken=spoken,
        reason="answered call did not yield a usable still_coming flag",
        next_step="a human must read this call",
    )


def format_when(value: datetime) -> str:
    return value.strftime("%A, %B %d at %I:%M %p %Z").replace("  ", " ").strip()


def build_task(hold: Hold) -> str:
    return (
        f"You are an automated assistant calling on behalf of {hold.business_name}. "
        f"The guest is {hold.guest_name}. Their booking ({hold.context}) started at "
        f"{format_when(hold.slot_start)}. The house can hold it until "
        f"{format_when(hold.hold_until)}. Disclose that you are an AI assistant. "
        f"Ask only: are they still coming, and if so how many minutes until they "
        f"arrive. If they are not coming, confirm they are releasing the slot. "
        f"Do not discuss medical, legal, or payment details. Do not offer another "
        f"time. Do not call anyone else. Fill status, still_coming, eta_minutes, "
        f"released, and confirmation_quote from words the guest actually spoke. "
        f"If they said \"soon\" without a number, leave eta_minutes empty and set "
        f"status to unclear."
    )


def validate_base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        raise SystemExit(
            f"Refusing to run: CALL-E base URL {base_url!r} is not HTTPS."
        )
    if parsed.hostname not in _ALLOWED_CALLE_HOSTS:
        raise SystemExit(
            f"Refusing to run: {parsed.hostname!r} is not an allowlisted "
            f"CALL-E origin ({sorted(_ALLOWED_CALLE_HOSTS)})."
        )
    return base_url.rstrip("/")


def require_requests():
    try:
        import requests
        return requests
    except ImportError as exc:
        print(
            "The `requests` package is required to place live calls.\n"
            "Install it first:\n\n    pip install -r requirements.txt\n",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc


def place_call(requests, base_url: str, api_key: str, hold: Hold) -> dict[str, Any]:
    region = hold.region or infer_region(hold.phone)
    if not region:
        return {"_local_error": f"could not infer region for {mask_phone(hold.phone)}"}
    e164_error = validate_e164_for_region(hold.phone, region)
    if e164_error:
        return {"_local_error": f"refusing to call: {e164_error}"}
    if is_reserved_fictional(hold.phone):
        return {
            "_local_error": (
                f"refusing to live-dial reserved fictional number "
                f"{mask_phone(hold.phone)}"
            )
        }

    recipient: dict[str, Any] = {"phones": [hold.phone], "region": region}
    if hold.locale:
        recipient["locale"] = hold.locale

    idem_seed = f"{hold.phone}|{hold.slot_start.isoformat()}|{hold.hold_until.isoformat()}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": str(uuid.uuid5(uuid.NAMESPACE_URL, idem_seed)),
    }
    payload = {
        "task": build_task(hold),
        "recipients": [recipient],
        "result_schema": RESULT_SCHEMA,
        "metadata": {
            "guest_name": hold.guest_name,
            "slot_start": hold.slot_start.isoformat(),
            "hold_until": hold.hold_until.isoformat(),
        },
    }
    try:
        resp = requests.post(
            f"{base_url}/v1/calls", headers=headers, json=payload, timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as exc:
        detail = ""
        try:
            body = exc.response.json()
            err = body.get("error", body)
            detail = err.get("message", "") if isinstance(err, dict) else str(err)
        except Exception:
            detail = exc.response.text[:200] if exc.response is not None else ""
        return {"_local_error": f"CALL-E rejected the create: {detail or exc}"}
    except requests.exceptions.RequestException as exc:
        return {"_local_error": f"transport error creating call: {exc}"}


def poll_call(requests, base_url: str, api_key: str, call_id: str,
              attempts: int = 40, delay_s: float = 3.0) -> dict[str, Any]:
    import time

    headers = {"Authorization": f"Bearer {api_key}"}
    last: dict[str, Any] = {}
    for _ in range(attempts):
        try:
            resp = requests.get(
                f"{base_url}/v1/calls/{call_id}", headers=headers, timeout=30,
            )
            resp.raise_for_status()
            last = resp.json()
        except requests.exceptions.RequestException as exc:
            return {"_local_error": f"transport error polling {call_id}: {exc}"}
        status = str(last.get("status") or last.get("call_status") or "").lower()
        if status in _TERMINAL_STATUSES:
            return last
        time.sleep(delay_s)
    last["_local_error"] = f"poll timed out before {call_id} reached a terminal status"
    return last


def spoken_from_call_payload(payload: dict[str, Any]) -> Spoken:
    structured = payload.get("structured_result") or payload.get("result") or {}
    if not isinstance(structured, dict):
        structured = {}
    return spoken_from_mapping(structured if structured else {"status": "unclear"})


def decision_record(hold: Hold, result: Decision) -> dict[str, Any]:
    spoken = result.spoken
    return {
        "guest_name": hold.guest_name,
        "phone_masked": mask_phone(hold.phone),
        "slot_start": hold.slot_start.isoformat(),
        "hold_until": hold.hold_until.isoformat(),
        "remaining_minutes": result.remaining_minutes,
        "decision": result.decision,
        "reason": result.reason,
        "next_step": result.next_step,
        "status": spoken.status if spoken else None,
        "still_coming": spoken.still_coming if spoken else None,
        "eta_minutes": spoken.eta_minutes if spoken else None,
        "released": spoken.released if spoken else None,
        "confirmation_quote": spoken.confirmation_quote if spoken else None,
        "call_id": result.call_id,
    }


def print_row(hold: Hold, result: Decision, mode: str) -> None:
    spoken = result.spoken
    extra = ""
    if spoken:
        extra = f"  {spoken.status}"
        if spoken.still_coming is True and spoken.eta_minutes is not None:
            extra += f" eta={spoken.eta_minutes}"
        elif spoken.released or spoken.still_coming is False:
            extra += " released"
    print(
        f"- {hold.guest_name:<16} {mask_phone(hold.phone):<12} "
        f"slot {hold.slot_start.strftime('%H:%M')}  "
        f"hold {hold.hold_until.strftime('%H:%M')}  "
        f"remaining={result.remaining_minutes}m  "
        f"{mode}{extra}  -> {result.decision}"
    )


def parse_now(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc).astimezone()
    return parse_iso(value, "--now")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    here = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Triage one late hold with at most one CALL-E call.",
    )
    parser.add_argument("--in", dest="infile", required=True, help="CSV or JSON hold file")
    parser.add_argument("--guest-phone", help="If set, keep only this E.164 row")
    parser.add_argument("--now", help="ISO 8601 clock used for the hold math")
    parser.add_argument(
        "--outcomes",
        default=str(here / "assets" / "dry_run_outcomes.json"),
        help="Dry-run spoken-result fixtures keyed by phone",
    )
    parser.add_argument("--authorized-numbers", help="Allowlist file required with --confirm")
    parser.add_argument("--out", help="Write the JSON decision row(s) here")
    parser.add_argument("--confirm", action="store_true", help="Place a real CALL-E call")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL),
        help="Must stay on an allowlisted HTTPS CALL-E origin",
    )
    return parser.parse_args(argv)


def run(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    holds = load_holds(Path(args.infile))
    if args.guest_phone:
        holds = [hold for hold in holds if hold.phone == args.guest_phone]
        if not holds:
            raise SystemExit(f"No row matches --guest-phone {mask_phone(args.guest_phone)}")
    now = parse_now(args.now)
    records: list[dict[str, Any]] = []

    if not args.confirm:
        outcomes = load_dry_run_outcomes(Path(args.outcomes))
        print(f"DRY RUN — {len(holds)} hold(s). No calls will be placed.")
        for hold in holds:
            raw = outcomes.get(hold.phone)
            spoken = spoken_from_mapping(raw) if raw else None
            result = decide(hold, now, spoken)
            print_row(hold, result, "fixture" if raw else "no-fixture")
            records.append(decision_record(hold, result))
        print("Re-run with --confirm and --authorized-numbers to place a real call.")
        if args.out:
            Path(args.out).write_text(
                json.dumps(records, indent=2) + "\n", encoding="utf-8",
            )
        return 0

    if len(holds) != 1:
        raise SystemExit(
            "Live mode places exactly one call. Pass --guest-phone to choose a row."
        )
    hold = holds[0]
    authorized = load_authorized_numbers(args.authorized_numbers)
    if not args.authorized_numbers:
        raise SystemExit("Live mode requires --authorized-numbers.")
    if hold.phone not in authorized:
        raise SystemExit(
            f"Refusing to call {mask_phone(hold.phone)}: not in the authorized-numbers file."
        )
    if is_reserved_fictional(hold.phone):
        raise SystemExit(
            f"Refusing to live-dial reserved fictional number {mask_phone(hold.phone)}."
        )

    expired = decide(hold, now, None)
    if expired.decision == HOLD_EXPIRED:
        print_row(hold, expired, "live-skipped")
        records.append(decision_record(hold, expired))
        if args.out:
            Path(args.out).write_text(
                json.dumps(records, indent=2) + "\n", encoding="utf-8",
            )
        return 0

    api_key = os.environ.get("CALLE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("CALLE_API_KEY is required for --confirm.")
    base_url = validate_base_url(args.base_url)
    requests = require_requests()
    created = place_call(requests, base_url, api_key, hold)
    if created.get("_local_error"):
        raise SystemExit(created["_local_error"])
    call_id = created.get("id") or created.get("call_id")
    if not call_id:
        raise SystemExit("CALL-E create returned no call id; halt and reconcile.")
    polled = poll_call(requests, base_url, api_key, str(call_id))
    if polled.get("_local_error"):
        raise SystemExit(polled["_local_error"])
    spoken = spoken_from_call_payload(polled)
    decided = decide(hold, now, spoken)
    result = Decision(
        decision=decided.decision,
        remaining_minutes=decided.remaining_minutes,
        spoken=decided.spoken,
        reason=decided.reason,
        next_step=decided.next_step,
        call_id=str(call_id),
    )
    print("LIVE — one call placed.")
    print_row(hold, result, "live")
    records.append(decision_record(hold, result))
    if args.out:
        Path(args.out).write_text(
            json.dumps(records, indent=2) + "\n", encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
