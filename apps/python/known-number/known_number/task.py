"""Build the CALL-E task text and result schema for one callback.

Design rule: the call collects nothing sensitive. Not a bank name, not an
account digit, not a code. It asks three yes/no questions of the person who
answers the number already on file, and it *hands over* a callback reference
that the vendor must quote back in writing through the address already on
file. Two independent channels the vendor had before the request arrived
must both close before anything changes.

This shape was forced by real constraints met while building: CALL-E's task
planner refuses any call that asks a recipient to provide or confirm bank or
payment details, and it also refuses any call that asks a recipient to read
out a verification code or OTP. Both refusals are the right default for a
phone platform (those are the two classic scam scripts), and the protocol is
stronger for obeying them: the phone leg can no longer leak or collect
anything, and proof of channel control moves to the written leg.
"""

from __future__ import annotations

from typing import Any

from .models import ChangeRequest, VendorRecord

RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "reached_authorized_contact",
        "contact_name_given",
        "requested_change",
        "notice_matches_request",
        "reference_delivered",
        "request_channel_confirmed",
        "alternate_details_offered",
        "call_disposition",
    ],
    "properties": {
        "reached_authorized_contact": {
            "type": "boolean",
            "description": "True only if the person on the line identified themselves by one of the authorized contact names, or was transferred to such a person.",
        },
        "contact_name_given": {
            "type": "string",
            "description": "The name the person on the line gave, or an empty string.",
        },
        "requested_change": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Whether the contact confirms their organization recently asked to change its supplier profile.",
        },
        "notice_matches_request": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Whether the contact confirms the written change notice describes the change their organization actually requested.",
        },
        "reference_delivered": {
            "type": "boolean",
            "description": "True if the callback reference was spoken to the authorized contact and they acknowledged it.",
        },
        "request_channel_confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Whether the contact confirms the request was sent by the named requester through their organization's normal channel.",
        },
        "alternate_details_offered": {
            "type": "boolean",
            "description": "True if the contact tried to give any new or different profile details during the call.",
        },
        "call_disposition": {
            "type": "string",
            "enum": [
                "spoke_with_contact",
                "wrong_person",
                "voicemail",
                "no_answer",
                "refused",
                "ivr_only",
                "other",
            ],
        },
    },
}


def build_task(request: ChangeRequest, vendor: VendorRecord, *, company_name: str, reference: str) -> str:
    contacts = " or ".join(vendor.authorized_contacts)
    spoken_ref = " ".join(reference)
    return (
        f"You are an automated assistant calling on behalf of the supplier administration team at {company_name}. "
        "Say that in your first sentence, say that you are not a person, and say that the call is being recorded "
        "and its content written down.\n\n"
        f"Ask to speak with {contacts} at {vendor.legal_name}. If the person who answers is not one of them, ask to be "
        "transferred; if that is not possible, thank them and end the call without discussing anything else.\n\n"
        f"Once you reach an authorized contact, explain that {company_name} received a request on or around "
        f"{request.received_on.strftime('%d %B %Y')} to change the supplier profile that {company_name} holds for "
        f"{vendor.legal_name}, that the request named {request.requested_by_name} as the sender, and that company policy "
        "requires a callback to the phone number already on file before any profile change is applied. Also mention that a "
        "written change notice describing the request was sent to the contact address already on file. Then ask, in order:\n"
        "1. Did your organization ask us to change its supplier profile recently? (yes / no)\n"
        "2. Does the written change notice we sent describe the change your organization actually requested? (yes / no)\n"
        "3. Was the request sent by the person named above, through your normal channel? (yes / no)\n\n"
        f"Then give them the callback reference, spoken letter by letter: {spoken_ref}. Ask them to reply to the written "
        "change notice from their usual address quoting that reference, and explain that the change is applied only once "
        "that written reply arrives. Do not ask them to repeat the reference back and do not ask them to read anything out.\n\n"
        "Rules you must follow:\n"
        "- Do not ask for, accept, repeat, or discuss any banking, account, payment, password, or code information of any "
        "kind. You do not have any and you must not collect any. If the contact starts to give any such details, interrupt "
        "politely, say that profile changes can only be made through the written process, note that details were "
        "offered, and move on.\n"
        "- If the contact says no change was requested, thank them, tell them the request will be treated as suspicious "
        "and that they may want to check whether their email has been compromised, and end the call.\n"
        "- If you reach voicemail, leave no details beyond your name, the company name, and a request to call back the "
        "supplier administration team on its published number.\n"
        "- Do not discuss invoices, amounts, payment dates, or anything unrelated to this verification.\n"
        "- Be brief and courteous. The whole call should take under three minutes."
    )


def build_metadata(request: ChangeRequest, vendor: VendorRecord) -> dict[str, str]:
    return {
        "workflow": "known-number",
        "ticket_id": request.ticket_id,
        "vendor_id": vendor.vendor_id,
    }


def idempotency_key(request: ChangeRequest, task: str = "") -> str:
    """One key per ticket *and* per exact task text.

    CALL-E binds an idempotency key to the first request body it sees, even
    when that request was rejected by the planner. Keying on the task text as
    well means a revised script after a rejection is a new request, while an
    accidental double-run of the same script is still de-duplicated.
    """
    import hashlib

    suffix = hashlib.sha256(task.encode("utf-8")).hexdigest()[:8] if task else "0"
    return f"known-number:{request.ticket_id}:{suffix}"
