"""Deterministic reconciliation of a terminal CALL-E result into a verdict.

No model is consulted here. The inputs are the change request, the vendor
record, and the call object CALL-E returned. The output is one verdict plus
the reasons and the evidence quotes that support it.

The matrix is fail-closed: every path that is not a full match ends somewhere
other than CONFIRMED.
"""

from __future__ import annotations

import re
from typing import Any

from .models import ChangeRequest, Reconciliation, VendorRecord, Verdict

LOW_CONFIDENCE_LABELS = {"low", "very_low", "none"}
GENERIC_BANK_WORDS = {"bank", "ltd", "limited", "plc", "inc", "co", "the", "of", "n", "a", "na", "corp", "corporation"}


def reconcile(request: ChangeRequest, vendor: VendorRecord, call: dict[str, Any]) -> Reconciliation:
    reasons: list[str] = []
    evidence = _evidence(call)

    status = call.get("status")
    if status != "completed":
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            [f"call status is {status!r}, not 'completed'"],
            evidence,
            "Retry the callback later or verify by another out-of-band channel. Do not apply the change.",
        )

    result = _structured_result(call)
    if result is None:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["CALL-E returned no schema-valid structured result for this call"],
            evidence,
            "Read the transcript manually; do not apply the change on the basis of this call.",
        )

    disposition = str(result.get("call_disposition", "other"))
    if disposition != "spoke_with_contact" or not bool(result.get("reached_authorized_contact")):
        who = result.get("contact_name_given") or "nobody"
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            [f"authorized contact not reached (disposition={disposition}, spoke with {who})"],
            evidence,
            "Schedule another attempt at the known number. Do not apply the change.",
        )

    if bool(result.get("alternate_details_offered")):
        reasons.append("contact offered different or additional bank details during the call")
        return Reconciliation(
            Verdict.ESCALATE,
            reasons,
            evidence,
            "Hold the change and route to the fraud or treasury owner. A callback must never be used to collect new details.",
        )

    requested = str(result.get("requested_change", "unknown"))
    if requested == "no":
        return Reconciliation(
            Verdict.DENIED_BY_VENDOR,
            ["the authorized contact states that no change was requested"],
            evidence,
            "Reject the request, keep paying the account on file, notify the vendor's security contact, and preserve the original request as evidence.",
        )
    if requested != "yes":
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["the contact could not confirm whether a change was requested"],
            evidence,
            "Do not apply the change. Ask the vendor to confirm in writing through a second known channel.",
        )

    stated_last4 = re.sub(r"\D", "", str(result.get("stated_account_last4", "")))[-4:]
    stated_bank = str(result.get("stated_bank_name", ""))
    last4_ok = stated_last4 == request.new_account_last4 and len(stated_last4) == 4
    bank_ok = _bank_matches(stated_bank, request.new_bank_name)
    channel = str(result.get("request_channel_confirmed", "unknown"))

    if not stated_last4 and not stated_bank:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["the contact confirmed a request but did not state bank name or last four digits"],
            evidence,
            "Do not apply the change. Repeat the callback; the read-back is the whole control.",
        )

    if not last4_ok:
        reasons.append(
            f"last four digits stated by the contact ({stated_last4 or 'none'}) do not match the request ({request.new_account_last4})"
        )
    if not bank_ok:
        reasons.append(f"bank stated by the contact ({stated_bank or 'none'}) does not match the request ({request.new_bank_name})")
    if reasons:
        return Reconciliation(
            Verdict.MISMATCH,
            reasons,
            evidence,
            "Hold the change. Either the request was tampered with in transit or the vendor mis-stated; both require a human before any payment moves.",
        )

    if channel == "no":
        return Reconciliation(
            Verdict.ESCALATE,
            ["details match, but the contact says the request did not come through the normal channel or named sender"],
            evidence,
            "Hold the change and ask the vendor to resubmit through its normal channel; the matching digits may have been obtained from the vendor's own compromised mailbox.",
        )

    completed = bool(call.get("task_completed", True))
    confidence = _confidence_label(call)
    if not completed or confidence in LOW_CONFIDENCE_LABELS:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            [f"details match but CALL-E reports task_completed={completed} with confidence {confidence!r}"],
            evidence,
            "Read the transcript. If the read-back is clearly audible, a human may confirm; otherwise repeat the callback.",
        )
    if not evidence:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["details match but the call carries no evidence quotes to support the read-back"],
            evidence,
            "Read the transcript before confirming; a verdict without quotable evidence is not audit-ready.",
        )

    reasons.append("authorized contact reached, change acknowledged, bank and last four digits read back match, normal channel confirmed")
    return Reconciliation(
        Verdict.CONFIRMED,
        reasons,
        evidence,
        "Apply the change in the vendor master with this record attached. Keep the original request and this audit record together.",
    )


def _structured_result(call: dict[str, Any]) -> dict[str, Any] | None:
    top = call.get("structured_result")
    if isinstance(top, dict) and top:
        return top
    for recipient in call.get("recipients") or []:
        candidate = recipient.get("structured_result")
        if isinstance(candidate, dict) and candidate:
            return candidate
    return None


def _confidence_label(call: dict[str, Any]) -> str:
    value = call.get("completion_confidence")
    if isinstance(value, dict):
        return str(value.get("label", "unknown")).lower()
    if isinstance(value, str):
        return value.lower()
    return "unknown"


def _evidence(call: dict[str, Any]) -> list[str]:
    raw = call.get("evidence")
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item).strip()]
    return []


def _bank_tokens(name: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", name.lower()))
    return {t for t in tokens if t not in GENERIC_BANK_WORDS}


def _bank_matches(stated: str, expected: str) -> bool:
    stated_tokens = _bank_tokens(stated)
    expected_tokens = _bank_tokens(expected)
    if not stated_tokens or not expected_tokens:
        return False
    return bool(stated_tokens & expected_tokens)
