#!/usr/bin/env python3
"""Dry-run preview for ledger-collections-call. Stdlib only. Never POSTs."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Lockstep with CALL-E GitHub supported-regions snapshot Sep 2026 plus EG.
# YE is intentionally absent. Do not import a host ledger package from this skill.
SUPPORTED_REGIONS: frozenset[str] = frozenset(
    {
        "AE",
        "AU",
        "BD",
        "BR",
        "BW",
        "CA",
        "CM",
        "DE",
        "EG",
        "ES",
        "FI",
        "FR",
        "GB",
        "GH",
        "HN",
        "ID",
        "IE",
        "IL",
        "IN",
        "JP",
        "KE",
        "LK",
        "MX",
        "MY",
        "MZ",
        "NA",
        "NG",
        "NL",
        "OM",
        "PH",
        "PK",
        "PL",
        "SA",
        "SG",
        "TH",
        "TN",
        "TR",
        "TW",
        "UA",
        "US",
        "VN",
        "ZA",
    }
)

_NANP_REGIONS: frozenset[str] = frozenset({"US", "CA"})
_E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

TASK_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["completed_count"],
    "properties": {"completed_count": {"type": "integer"}},
}

RECIPIENT_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["outcome"],
    "properties": {
        "outcome": {
            "type": "string",
            "enum": [
                "promised",
                "refused",
                "voicemail",
                "no_answer",
                "wrong_number",
                "callback_requested",
            ],
        },
        "promised_amount_minor": {"type": "integer"},
        "promised_currency": {"type": "string"},
        "promised_date": {"type": "string"},
        "language": {"type": "string", "enum": ["ar", "en"]},
        "acknowledged_hold": {"type": "boolean"},
        "evidence_quote": {"type": "string"},
    },
}

GOAL_TEMPLATE = (
    "Call {displayName} on behalf of {storeName}. Identify yourself as the "
    "store's assistant, not a government collector. Their outstanding balance "
    "is {amountLine}. Ask whether they can promise a payment date and amount. "
    "Be brief, polite, and stop if they refuse. Return structured fields only: "
    "promised / refused / voicemail / no_answer / wrong_number / "
    "callback_requested, integer minor-unit amount if they state one, ISO date "
    "if they state one."
)


def is_valid_e164(phone: str) -> bool:
    return bool(_E164_RE.fullmatch(phone))


def mask_e164(phone: str) -> str:
    digits = phone[1:] if phone.startswith("+") else phone
    tail = digits[-4:] if len(digits) >= 4 else digits
    return f"+{'*' * max(len(digits) - 4, 0)}{tail}"


def calling_is_ye(phone: str) -> bool:
    return phone.startswith("+967")


def calling_is_nanp(phone: str) -> bool:
    return phone.startswith("+1") and len(phone) >= 2


def format_amount_line(amount_minor: int, currency: str) -> str:
    major, cents = divmod(amount_minor, 100)
    return f"{currency} {major}.{cents:02d}"


def parse_amount_minor(raw: Any) -> int | None:
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    if raw < 0:
        return None
    return raw


def idempotency_key(
    *,
    contact_id: str,
    amount_minor: int,
    currency: str,
    promised_date: str,
    utc_day: str,
) -> str:
    material = f"{contact_id}|{amount_minor}|{currency}|{promised_date}|{utc_day}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def validate_intake(data: dict[str, Any]) -> str | None:
    """Return a blocker code, or None if the row is eligible for a live plan."""
    contact_id = str(data.get("contactId") or "").strip()
    if not _UUID_RE.match(contact_id):
        return "invalidContactId"

    display = str(data.get("displayName") or "").strip()
    if not display:
        return "invalidDisplayName"

    phone = str(data.get("phoneE164") or "").strip()
    if not is_valid_e164(phone):
        return "invalidPhone"

    if data.get("doNotCall") is True:
        return "dnc"

    amount = parse_amount_minor(data.get("amountMinor"))
    if amount is None:
        return "invalidAmount"

    currency = str(data.get("currency") or "").strip().upper()
    if len(currency) < 3:
        return "invalidCurrency"

    locale = str(data.get("locale") or "").strip().lower()
    if locale not in {"en", "ar"}:
        return "invalidLocale"

    region = str(data.get("region") or "").strip().upper()
    if region == "YE" or calling_is_ye(phone):
        return "unsupportedRegion"
    if region not in SUPPORTED_REGIONS:
        return "unsupportedRegion"
    if calling_is_nanp(phone) and region not in _NANP_REGIONS:
        return "unsupportedRegion"

    promised = str(data.get("promisedDate") or "").strip()
    if promised and not _DATE_RE.match(promised):
        return "invalidPromisedDate"

    return None


def build_report(
    data: dict[str, Any],
    *,
    utc_day: str,
    live: bool,
) -> tuple[int, str]:
    if live:
        return (
            2,
            "status: error\nblocker: liveNotImplemented\n"
            "Live execute is not implemented in this skill. Dry-run only.\n",
        )

    phone = str(data.get("phoneE164") or "").strip()
    blocker = validate_intake(data)
    amount = parse_amount_minor(data.get("amountMinor"))
    currency = str(data.get("currency") or "").strip().upper()
    contact_id = str(data.get("contactId") or "").strip()
    promised = str(data.get("promisedDate") or "").strip()
    display = str(data.get("displayName") or "").strip()
    store = str(data.get("storeName") or "Store").strip() or "Store"
    region = str(data.get("region") or "").strip().upper()
    locale = str(data.get("locale") or "").strip().lower()

    lines = [
        "status: not_called",
        f"blocker: {blocker or 'dryRunDefault'}",
        f"phoneMasked: {mask_e164(phone) if is_valid_e164(phone) else 'invalid'}",
        f"region: {region or 'missing'}",
        f"locale: {locale or 'missing'}",
    ]

    if amount is not None and currency:
        amount_line = format_amount_line(amount, currency)
        key = idempotency_key(
            contact_id=contact_id or "missing",
            amount_minor=amount,
            currency=currency,
            promised_date=promised,
            utc_day=utc_day,
        )
        lines.append(f"amountLine: {amount_line}")
        lines.append(f"idempotencyKey: {key}")
        if blocker is None:
            task = GOAL_TEMPLATE.format(
                displayName=display,
                storeName=store,
                amountLine=amount_line,
            )
            lines.append("task:")
            lines.append(task)
            lines.append("recipientResultSchema:")
            lines.append(json.dumps(RECIPIENT_RESULT_SCHEMA, indent=2))
            lines.append("taskResultSchema:")
            lines.append(json.dumps(TASK_RESULT_SCHEMA, indent=2))

    lines.append("note: promise is not a payment; this skill does not write a ledger.")
    return 0, "\n".join(lines) + "\n"


def preview_file(path: Path, *, live: bool, utc_day: str) -> tuple[int, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return 1, f"status: error\nblocker: invalidJson\n{error}\n"
    if not isinstance(data, dict):
        return 1, "status: error\nblocker: invalidJson\nIntake must be a JSON object.\n"
    return build_report(data, utc_day=utc_day, live=live)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Dry-run preview for ledger-collections-call (no network).",
    )
    parser.add_argument("--request", required=True, help="Path to overdue JSON")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Rejected. This skill does not POST /v1/calls.",
    )
    parser.add_argument(
        "--utc-day",
        default="",
        help="Override UTC calendar day YYYY-MM-DD for the idempotency key",
    )
    args = parser.parse_args(argv)
    utc_day = args.utc_day.strip() or datetime.now(timezone.utc).date().isoformat()
    code, text = preview_file(Path(args.request), live=args.live, utc_day=utc_day)
    sys.stdout.write(text)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
