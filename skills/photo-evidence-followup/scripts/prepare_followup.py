#!/usr/bin/env python3
"""Create a deterministic, masked preview for one photo-evidence follow-up call."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


E164 = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")
SAFE_TEXT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,'&()/+-]{1,95}$")
PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
REQUESTS = {
    "REQUEST_RETAKE": "a sharp overhead photo in even lighting with the entire parcel in frame",
    "REQUEST_WIDER_VIEW": "one wider photo showing the entire parcel and its edges",
    "REQUEST_LABEL_PHOTO": "one close photo of the shipping label with account and address details covered",
    "REQUEST_SIDE_VIEW": "one side-angle photo showing the suspected damage",
}
NO_CALL_ACTIONS = {"STAGE_CLAIM_PACKET", "MARK_VISUALLY_CLEAR"}


def _load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    value = " ".join(value.split())
    if not SAFE_TEXT.fullmatch(value):
        raise ValueError(f"{field} contains unsupported characters or length")
    return value


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def build_preview(trace: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    case_id = trace.get("case_id")
    if not isinstance(case_id, str) or not SAFE_ID.fullmatch(case_id):
        raise ValueError("trace case_id must be a safe identifier")
    decision = trace.get("decision")
    if not isinstance(decision, dict) or not isinstance(decision.get("action"), str):
        raise ValueError("trace decision.action is required")
    action = decision["action"]
    if action in NO_CALL_ACTIONS:
        return {
            "case_id": case_id,
            "call_needed": False,
            "reason": "The vision trace already supports a human-review decision.",
            "action": action,
        }
    if action not in REQUESTS:
        return {
            "case_id": case_id,
            "call_needed": False,
            "reason": "The vision action is not supported by this follow-up skill.",
            "action": action,
        }

    request_id = request.get("request_id")
    if not isinstance(request_id, str) or not SAFE_ID.fullmatch(request_id):
        raise ValueError("request_id must be a safe identifier")
    phone = request.get("phone")
    if not isinstance(phone, str) or not E164.fullmatch(phone):
        raise ValueError("phone must use strict E.164 format")
    if request.get("authorized_contact") is not True:
        raise ValueError("authorized_contact must be true")
    if request.get("recipient_consented") is not True:
        raise ValueError("recipient_consented must be true")

    contact = _text(request.get("contact_label"), "contact_label")
    caller = _text(request.get("caller_name"), "caller_name")
    upload_route = _text(request.get("secure_upload_route"), "secure_upload_route")
    evidence = REQUESTS[action]
    task = (
        f"Call the authorized {contact} on behalf of {caller}. Identify yourself as an AI "
        "calling assistant, confirm you reached the intended parcel contact, and ask permission "
        "to continue. If either check fails, do not disclose parcel details and end the call. "
        f"Refer only to non-secret case {case_id}. Explain that automated photo inspection needs "
        f"{evidence}. Ask whether they can provide it through {upload_route}, and if yes ask when. "
        "Read back the request once. Do not ask for an address, account detail, password, code, "
        "payment, claim decision, or any new upload destination. Do not promise claim approval or "
        "say that a file was received. Make no second call regardless of the outcome."
    )
    digest_input = json.dumps(
        {"request_id": request_id, "case_id": case_id, "phone": phone, "action": action, "task": task},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    preview = {
        "case_id": case_id,
        "request_id": request_id,
        "call_needed": True,
        "masked_recipient": mask_phone(phone),
        "vision_action": action,
        "requested_evidence": evidence,
        "secure_upload_route": upload_route,
        "task": task,
        "idempotency_key": f"photo-followup-{hashlib.sha256(digest_input).hexdigest()}",
        "live_call_placed": False,
    }
    rendered = json.dumps(preview, sort_keys=True)
    if phone in rendered or PHONE_LIKE.search(rendered):
        raise RuntimeError("preview redaction failed")
    return preview


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trace", required=True, type=Path)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    preview = build_preview(_load(args.trace), _load(args.request))
    rendered = json.dumps(preview, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
