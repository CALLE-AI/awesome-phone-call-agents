import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://api.heycall-e.com"
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$")
REFERENCE_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9 ._/#-]{2,47}$")
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

SUPPORTED_REGIONS = {
    "US", "SG", "MY", "IN", "AE", "AU", "CA", "GB", "VN",
    "DE", "JP", "FR", "MX", "BR", "ID", "PH", "KE",
}
ALLOWED_QUESTIONS = {
    "current_status": "What is the current permit status?",
    "blocking_items": "Is review blocked by any missing or incorrect item?",
    "next_action": "What exact next action should the applicant take?",
    "response_deadline": "Is there a response or expiry deadline?",
    "resubmission_channel": "Where should corrections or documents be submitted?",
    "fee_information": "Is a fee recorded as due? Ask for information only; do not authorize or pay it.",
    "followup_contact": "Which team, extension, or public contact should handle follow-up?",
}


@dataclass(frozen=True)
class PermitStatusRequest:
    workflow_id: str
    phone: str
    caller_has_authority: bool
    recipient_is_public_department_number: bool
    organization_display_name: str
    jurisdiction: str
    department: str
    permit_reference: str
    project_type: str
    region: str
    locale: str
    questions: tuple[str, ...]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview or run one information-only permit status call with CALL-E."
    )
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional new JSON result path; existing files are never overwritten.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preview", action="store_true", help="No-call preview (default).")
    mode.add_argument("--execute", action="store_true", help="Place exactly one call.")
    parser.add_argument(
        "--confirm-authority",
        action="store_true",
        help="Required for live mode; confirms authority to make this inquiry.",
    )
    parser.add_argument(
        "--confirm-public-number",
        action="store_true",
        help="Required for live mode; confirms the recipient is a public department number.",
    )
    parser.add_argument(
        "--base-url", default=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument("--timeout-seconds", type=int, default=600)
    return parser.parse_args(argv)


def clean_text(value: Any, field: str, *, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = " ".join(value.split())
    if len(cleaned) < minimum or len(cleaned) > maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} characters")
    return cleaned


def parse_request(raw: Any) -> PermitStatusRequest:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")

    workflow_id = clean_text(raw.get("workflow_id"), "workflow_id", minimum=3, maximum=64)
    if not SAFE_ID_PATTERN.fullmatch(workflow_id):
        raise ValueError("workflow_id may contain only letters, numbers, dot, underscore, and hyphen")

    phone = clean_text(raw.get("phone"), "phone", minimum=8, maximum=16)
    if not E164_PATTERN.fullmatch(phone):
        raise ValueError("phone must use E.164 format, for example +12025550123")

    if raw.get("caller_has_authority") is not True:
        raise ValueError("caller_has_authority must be true")
    if raw.get("recipient_is_public_department_number") is not True:
        raise ValueError("recipient_is_public_department_number must be true")

    permit_reference = clean_text(
        raw.get("permit_reference"), "permit_reference", minimum=3, maximum=48
    )
    if not REFERENCE_PATTERN.fullmatch(permit_reference):
        raise ValueError("permit_reference contains unsupported characters")
    if PHONE_LIKE_PATTERN.search(permit_reference) or EMAIL_PATTERN.search(permit_reference):
        raise ValueError("permit_reference must not contain a phone number or email address")

    region = clean_text(raw.get("region"), "region", minimum=2, maximum=2).upper()
    if region not in SUPPORTED_REGIONS:
        raise ValueError(f"region must be one of: {', '.join(sorted(SUPPORTED_REGIONS))}")

    locale = clean_text(raw.get("locale", "en-US"), "locale", minimum=2, maximum=16)
    if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", locale):
        raise ValueError("locale must look like en-US or fr-FR")

    raw_questions = raw.get("questions")
    if not isinstance(raw_questions, list) or not 2 <= len(raw_questions) <= len(ALLOWED_QUESTIONS):
        raise ValueError("questions must contain 2-7 supported question ids")
    if any(not isinstance(item, str) or item not in ALLOWED_QUESTIONS for item in raw_questions):
        raise ValueError("questions contains an unsupported question id")
    if len(set(raw_questions)) != len(raw_questions):
        raise ValueError("questions must not contain duplicates")

    return PermitStatusRequest(
        workflow_id=workflow_id,
        phone=phone,
        caller_has_authority=True,
        recipient_is_public_department_number=True,
        organization_display_name=clean_text(
            raw.get("organization_display_name"),
            "organization_display_name",
            minimum=2,
            maximum=80,
        ),
        jurisdiction=clean_text(raw.get("jurisdiction"), "jurisdiction", minimum=2, maximum=100),
        department=clean_text(raw.get("department"), "department", minimum=2, maximum=100),
        permit_reference=permit_reference,
        project_type=clean_text(raw.get("project_type"), "project_type", minimum=3, maximum=140),
        region=region,
        locale=locale,
        questions=tuple(raw_questions),
    )


def load_request(path: Path) -> PermitStatusRequest:
    with path.expanduser().open(encoding="utf-8") as handle:
        return parse_request(json.load(handle))


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def mask_reference(reference: str) -> str:
    visible = reference[-4:] if len(reference) > 4 else reference[-1:]
    return f"{'*' * max(3, len(reference) - len(visible))}{visible}"


def build_task(request: PermitStatusRequest) -> str:
    questions = " ".join(
        f"{index}. {ALLOWED_QUESTIONS[question]}"
        for index, question in enumerate(request.questions, start=1)
    )
    return (
        f"Place one information-only permit status call to {request.department} in {request.jurisdiction} "
        f"on behalf of {request.organization_display_name}. At the start, identify yourself as an AI calling assistant "
        "making an authorized factual status inquiry. If the recipient does not accept an AI caller, apologize and end. "
        f"The public permit reference is {request.permit_reference}; the project type is {request.project_type}. "
        f"Ask only these questions: {questions} "
        "Do not ask for names, addresses, dates of birth, account credentials, payment-card details, or other personal data. "
        "Do not request legal interpretation, dispute a decision, schedule an inspection, submit a document, authorize or "
        "pay a fee, accept terms, promise work, or represent that any correction has already been made. If a fee is mentioned, "
        "record the amount and official payment channel as information only. Read back the blocker and next action once for "
        "confirmation, ask for a public follow-up reference or department extension, and end politely."
    )


def build_result_schema() -> dict[str, Any]:
    text_field = {"type": "string", "maxLength": 500}
    return {
        "type": "object",
        "required": [
            "reached_correct_department",
            "current_status",
            "blocker_summary",
            "next_action",
            "response_deadline",
            "resubmission_channel",
            "fee_information_only",
            "followup_contact",
            "followup_reference",
            "evidence_summary",
        ],
        "properties": {
            "reached_correct_department": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "current_status": {
                "type": "string",
                "enum": [
                    "approved",
                    "under_review",
                    "corrections_required",
                    "awaiting_payment",
                    "on_hold",
                    "closed",
                    "unknown",
                ],
            },
            "blocker_summary": text_field,
            "next_action": text_field,
            "response_deadline": text_field,
            "resubmission_channel": text_field,
            "fee_information_only": text_field,
            "followup_contact": text_field,
            "followup_reference": text_field,
            "evidence_summary": text_field,
        },
        "additionalProperties": False,
    }


def idempotency_key(request: PermitStatusRequest) -> str:
    return f"permitstatus-{request.workflow_id}"


def build_call_arguments(request: PermitStatusRequest) -> dict[str, Any]:
    return {
        "task": build_task(request),
        "recipients": [
            {"phones": [request.phone], "region": request.region, "locale": request.locale}
        ],
        "result_schema": build_result_schema(),
        "metadata": {
            "workflow_id": request.workflow_id,
            "workflow_type": "permit_status_clarification",
            "jurisdiction": request.jurisdiction,
        },
        "idempotency_key": idempotency_key(request),
    }


def preview(request: PermitStatusRequest) -> dict[str, Any]:
    arguments = build_call_arguments(request)
    arguments["recipients"] = [
        {
            "phones": [mask_phone(request.phone)],
            "region": request.region,
            "locale": request.locale,
        }
    ]
    arguments["task"] = arguments["task"].replace(
        request.permit_reference, mask_reference(request.permit_reference)
    )
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "workflow_id": request.workflow_id,
        "authority_recorded": request.caller_has_authority,
        "public_department_number_recorded": request.recipient_is_public_department_number,
        "call_arguments": arguments,
    }


def redact_sensitive_text(value: Any) -> Any:
    if isinstance(value, str):
        return EMAIL_PATTERN.sub("[email-redacted]", PHONE_LIKE_PATTERN.sub("[phone-redacted]", value))
    if isinstance(value, list):
        return [redact_sensitive_text(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_sensitive_text(item) for key, item in value.items()}
    return value


def execute(
    request: PermitStatusRequest, client: Any, *, timeout_seconds: int
) -> dict[str, Any]:
    created = client.calls.create(**build_call_arguments(request))
    call_id = created.get("id")
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("CALL-E create response did not contain a call id")
    completed = client.calls.wait_for_result(
        call_id, timeout_seconds=timeout_seconds, interval_seconds=2
    )
    return {
        "mode": "execute",
        "creates_phone_call": True,
        "workflow_id": request.workflow_id,
        "idempotency_key": idempotency_key(request),
        "call_id": call_id,
        "status": completed.get("status"),
        "task_completed": completed.get("task_completed"),
        "completion_confidence": completed.get("completion_confidence"),
        "structured_result": redact_sensitive_text(completed.get("structured_result")),
    }


def write_output(path: Path | None, payload: dict[str, Any]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path is None:
        sys.stdout.write(rendered)
        return
    destination = path.expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as handle:
        handle.write(rendered)
    destination.chmod(0o600)
    sys.stdout.write(f"Wrote {destination}\n")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        request = load_request(args.request)
        if not args.execute:
            write_output(args.output, preview(request))
            return 0
        if not args.confirm_authority or not args.confirm_public_number:
            raise ValueError("--execute requires --confirm-authority and --confirm-public-number")
        if args.timeout_seconds <= 0:
            raise ValueError("--timeout-seconds must be positive")
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise ValueError("CALLE_API_KEY is required for --execute")
        from calle import CalleClient

        client = CalleClient(api_key=api_key, base_url=args.base_url)
        write_output(args.output, execute(request, client, timeout_seconds=args.timeout_seconds))
        return 0
    except (
        FileExistsError,
        OSError,
        ValueError,
        RuntimeError,
        json.JSONDecodeError,
    ) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
