"""Deterministic reconciliation of a terminal CALL-E result into a verdict.

No model is consulted here. The inputs are the change request, the vendor
record, and the call object CALL-E returned. The output is one verdict plus
the reasons and the evidence quotes that support it.

The matrix is fail-closed: every path that is not a full match ends somewhere
other than CONFIRMED.
"""

from __future__ import annotations

from typing import Any

from .models import ChangeRequest, Reconciliation, VendorRecord, Verdict, normalize_code, verification_code

LOW_CONFIDENCE_LABELS = {"low", "very_low", "none"}


def reconcile(request: ChangeRequest, vendor: VendorRecord, call: dict[str, Any], *, code_secret: str = "") -> Reconciliation:
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
        return Reconciliation(
            Verdict.ESCALATE,
            ["contact tried to give new or different profile details during the call"],
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

    expected_code = verification_code(request, code_secret)
    stated_code = normalize_code(str(result.get("stated_verification_code", "")))
    if not stated_code:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["the contact confirmed a request but did not read back the verification code"],
            evidence,
            "Do not apply the change. Confirm the written notice reached the address on file, then repeat the callback.",
        )
    if stated_code != expected_code:
        return Reconciliation(
            Verdict.MISMATCH,
            [f"verification code read back ({stated_code}) does not match the code issued for this ticket"],
            evidence,
            "Hold the change. Either the contact is reading a notice for a different request, or the notice never reached the address on file and somebody else supplied a code. A human must look before any payment moves.",
        )

    notice = str(result.get("notice_matches_request", "unknown"))
    if notice == "no":
        return Reconciliation(
            Verdict.MISMATCH,
            ["the contact says the written change notice does not describe the change they requested"],
            evidence,
            "Hold the change. The request was altered somewhere between the vendor and this desk. Preserve both versions and escalate.",
        )
    if notice != "yes":
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["the contact read the correct code but did not confirm that the notice describes their request"],
            evidence,
            "Do not apply the change. Ask the contact to review the notice and confirm in writing.",
        )

    channel = str(result.get("request_channel_confirmed", "unknown"))
    if channel == "no":
        return Reconciliation(
            Verdict.ESCALATE,
            ["code and notice match, but the contact says the request did not come from the named sender through the normal channel"],
            evidence,
            "Hold the change and ask the vendor to resubmit through its normal channel; the original request may have come from the vendor's own compromised mailbox.",
        )

    completed = bool(call.get("task_completed", True))
    confidence = _confidence_label(call)
    if not completed or confidence in LOW_CONFIDENCE_LABELS:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            [f"everything matches but CALL-E reports task_completed={completed} with confidence {confidence!r}"],
            evidence,
            "Read the transcript. If the read-back is clearly audible, a human may confirm; otherwise repeat the callback.",
        )
    if not evidence:
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["everything matches but the call carries no evidence quotes to support the read-back"],
            evidence,
            "Read the transcript before confirming; a verdict without quotable evidence is not audit-ready.",
        )

    reasons.append(
        "authorized contact reached on the number on file, change acknowledged, verification code from the address on file read back correctly, "
        "written notice confirmed, normal channel confirmed"
    )
    return Reconciliation(
        Verdict.CONFIRMED,
        reasons,
        evidence,
        "Apply the change in the vendor master with this record attached. Keep the original request, the notice, and this audit record together.",
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
