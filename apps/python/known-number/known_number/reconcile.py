"""Deterministic reconciliation of a terminal CALL-E result into a verdict.

No model is consulted here. The inputs are the change request, the vendor
record, and the call object CALL-E returned. The output is one verdict plus
the reasons and the evidence quotes that support it.

The matrix is fail-closed: every path that is not a full match ends somewhere
other than CONFIRMED.
"""

from __future__ import annotations

from typing import Any

from .models import ChangeRequest, Reconciliation, VendorRecord, Verdict, callback_reference, normalize_reference

LOW_CONFIDENCE_LABELS = {"low", "very_low", "none"}


def reconcile(
    request: ChangeRequest,
    vendor: VendorRecord,
    call: dict[str, Any],
    *,
    code_secret: str = "",
    written_reply: str | None = None,
) -> Reconciliation:
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
            ["the contact confirmed a request but did not confirm that the written notice describes it"],
            evidence,
            "Do not apply the change. Ask the contact to review the notice and confirm in writing.",
        )

    channel = str(result.get("request_channel_confirmed", "unknown"))
    if channel == "no":
        return Reconciliation(
            Verdict.ESCALATE,
            ["the notice is confirmed, but the contact says the request did not come from the named sender through the normal channel"],
            evidence,
            "Hold the change and ask the vendor to resubmit through its normal channel; the original request may have come from the vendor's own compromised mailbox.",
        )

    if not bool(result.get("reference_delivered")):
        return Reconciliation(
            Verdict.INCONCLUSIVE,
            ["the callback reference was not delivered to the contact, so the written leg cannot close"],
            evidence,
            "Repeat the callback so the reference is delivered, or send it in a second written notice.",
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

    expected = callback_reference(request, code_secret)
    if written_reply is None:
        return Reconciliation(
            Verdict.PENDING_WRITTEN_REPLY,
            [
                "phone leg complete: authorized contact reached on the number on file, change acknowledged, written notice confirmed, "
                f"normal channel confirmed, callback reference {expected} delivered",
                "written leg open: no reply quoting the reference has been recorded yet",
            ],
            evidence,
            "Wait for the vendor's reply from the address on file quoting the reference, then run `close --written-reply <file>`. Do not apply the change before that.",
        )
    if expected not in normalize_reference(written_reply):
        return Reconciliation(
            Verdict.MISMATCH,
            [f"the written reply does not quote callback reference {expected}"],
            evidence,
            "Hold the change. A reply that does not carry the reference did not come from the person who took the call, or the reply was altered. A human must look.",
        )

    reasons.append(
        "phone leg: authorized contact reached on the number on file, change acknowledged, written notice confirmed, normal channel confirmed; "
        f"written leg: reply from the address on file quotes callback reference {expected}"
    )
    return Reconciliation(
        Verdict.CONFIRMED,
        reasons,
        evidence,
        "Apply the change in the vendor master with this record attached. Keep the original request, the notice, the reply, and this audit record together.",
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
