"""Build the CALL-E task text and result schema for one callback.

Design rule: the call carries no secret. The task text never contains the new
bank name or the new account digits. The vendor contact states them, CALL-E
extracts what was said, and reconciliation compares locally. If the wrong
person answers, the only thing they learn is that a payment-detail request
exists for their company, which is exactly what a real vendor should hear.
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
        "stated_bank_name",
        "stated_account_last4",
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
            "description": "Whether the contact confirms their organization asked to change its payment details recently.",
        },
        "stated_bank_name": {
            "type": "string",
            "description": "The bank name the contact stated for the new account, verbatim, or an empty string if not stated.",
        },
        "stated_account_last4": {
            "type": "string",
            "description": "The last four digits of the new account number as the contact stated them, digits only, or an empty string if not stated.",
        },
        "request_channel_confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Whether the contact confirms the request was sent through their organization's normal channel and by the named requester.",
        },
        "alternate_details_offered": {
            "type": "boolean",
            "description": "True if the contact tried to give different or additional bank details during the call.",
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


def build_task(request: ChangeRequest, vendor: VendorRecord, *, company_name: str) -> str:
    contacts = " or ".join(vendor.authorized_contacts)
    return (
        f"You are an automated assistant calling on behalf of the accounts payable team at {company_name}. "
        "Say that in your first sentence, say that you are not a person, and say that the call is being recorded "
        "and its content written down.\n\n"
        f"Ask to speak with {contacts} at {vendor.legal_name}. If the person who answers is not one of them, ask to be "
        "transferred; if that is not possible, thank them and end the call without discussing anything else.\n\n"
        f"Once you reach an authorized contact, explain that {company_name} received a request on or around "
        f"{request.received_on.strftime('%d %B %Y')} to change the bank details {company_name} uses to pay "
        f"{vendor.legal_name}, that the request named {request.requested_by_name} as the sender, and that company policy "
        "requires a callback to the phone number already on file before any change is applied. Then ask, in order:\n"
        "1. Did your organization ask us to change its payment details recently? (yes / no)\n"
        "2. If yes: please tell me the name of the bank for the new account, and only the last four digits of the new "
        "account number. Do not say any digits yourself and do not confirm or deny whether what they say matches.\n"
        "3. Was that request sent by the person named above, through your normal channel? (yes / no)\n\n"
        "Rules you must follow:\n"
        "- Never read out, hint at, or confirm any bank name or any account digits. You do not have them.\n"
        "- Never accept new, different, or additional bank details on this call. If the contact offers any, say that "
        "changes can only be made through the written process, note that details were offered, and move on.\n"
        "- Ask for at most the last four digits. If the contact starts reading a full account number, interrupt politely "
        "and ask for only the last four digits.\n"
        "- If the contact says no change was requested, thank them, tell them the request will be treated as suspicious "
        "and that they may want to check whether their email has been compromised, and end the call.\n"
        "- If you reach voicemail, leave no details beyond your name, the company name, and a request to call back the "
        "accounts payable team on its published number. Do not mention bank details in a voicemail.\n"
        "- Do not discuss invoice amounts, payment dates, or anything unrelated to this verification.\n"
        "- Be brief and courteous. The whole call should take under three minutes."
    )


def build_metadata(request: ChangeRequest, vendor: VendorRecord) -> dict[str, str]:
    return {
        "workflow": "known-number",
        "ticket_id": request.ticket_id,
        "vendor_id": vendor.vendor_id,
    }


def idempotency_key(request: ChangeRequest) -> str:
    return f"known-number:{request.ticket_id}"
