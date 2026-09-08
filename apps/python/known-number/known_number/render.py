"""Audit record and human-readable memo rendering."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from . import __version__
from .models import ChangeRequest, Reconciliation, VendorRecord, mask_phone, verification_code


def request_fingerprint(request: ChangeRequest) -> str:
    """Stable hash of the request as received, so the memo can be tied to it later."""
    payload = json.dumps(
        {
            "ticket_id": request.ticket_id,
            "vendor_id": request.vendor_id,
            "received_on": request.received_on.isoformat(),
            "channel": request.channel,
            "requested_by_name": request.requested_by_name,
            "new_bank_name": request.new_bank_name,
            "new_account_last4": request.new_account_last4,
            "callback_phone": request.callback_phone,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def audit_record(
    request: ChangeRequest,
    vendor: VendorRecord,
    reconciliation: Reconciliation,
    *,
    call: dict[str, Any] | None,
    approver: str | None,
    mode: str,
    code_secret: str = "",
) -> dict[str, Any]:
    return {
        "workflow": "known-number",
        "version": __version__,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "ticket_id": request.ticket_id,
        "request_fingerprint": request_fingerprint(request),
        "vendor": {
            "vendor_id": vendor.vendor_id,
            "legal_name": vendor.legal_name,
            "dialed_number_masked": mask_phone(vendor.known_phone),
            "known_phone_since": vendor.known_phone_since.isoformat(),
        },
        "approver": approver,
        "verification_code": verification_code(request, code_secret),
        "call_id": (call or {}).get("id"),
        "call_status": (call or {}).get("status"),
        "reconciliation": reconciliation.to_dict(),
    }


def memo(record: dict[str, Any], request: ChangeRequest, vendor: VendorRecord) -> str:
    rec = record["reconciliation"]
    lines = [
        f"# Payment-detail change callback: ticket {request.ticket_id}",
        "",
        f"**Verdict: {rec['verdict']}**  ",
        f"Releases change: {'yes' if rec['releases_change'] else 'no'}  ",
        f"Fraud signal: {'yes' if rec['is_fraud_signal'] else 'no'}",
        "",
        "## What was requested",
        "",
        f"- Vendor: {vendor.legal_name} ({vendor.vendor_id})",
        f"- Received: {request.received_on.isoformat()} via {request.channel}, signed {request.requested_by_name}",
        f"- Proposed: {request.new_bank_name}, account ending {request.new_account_last4}",
        f"- Currently on file: {vendor.current_bank_name}, account ending {vendor.current_account_last4}",
        f"- Request fingerprint: `{record['request_fingerprint']}`",
        f"- Verification code issued for the written notice: `{record.get('verification_code', 'n/a')}`",
        "",
        "## What was dialed",
        "",
        f"- Number on file since {vendor.known_phone_since.isoformat()}: {record['vendor']['dialed_number_masked']}",
        f"- Mode: {record['mode']}; approver: {record['approver'] or 'n/a'}",
        f"- CALL-E call id: {record['call_id'] or 'n/a'} (status: {record['call_status'] or 'n/a'})",
        "",
        "## Why",
        "",
    ]
    lines.extend(f"- {reason}" for reason in rec["reasons"])
    lines += ["", "## Evidence quotes", ""]
    if rec["evidence"]:
        lines.extend(f"> {quote}" for quote in rec["evidence"])
    else:
        lines.append("_None returned._")
    lines += ["", "## Recommended action", "", rec["recommended_action"], ""]
    return "\n".join(lines)
