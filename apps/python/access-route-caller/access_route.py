from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_BASE_URL = "https://api.heycall-e.com"
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$")
LOCALE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")

ROUTE_LABELS = {
    "email": "an email address or secure message route",
    "text": "a text-message route",
    "scheduled_callback": "a scheduled callback window instead of an unplanned call",
    "relay_support": "support for a telecommunications relay service",
    "support_person": "permission for a support person to join or handle a future call",
    "slower_pace": "a slower-paced future phone conversation with time to process",
}
ROUTE_MENTION_PATTERNS = {
    "email": re.compile(r"\be-?mail\b", re.IGNORECASE),
    "text": re.compile(r"\b(?:text|sms)\b", re.IGNORECASE),
    "scheduled_callback": re.compile(
        r"\b(?:scheduled[ -])?call[ -]?back\b", re.IGNORECASE
    ),
    "relay_support": re.compile(r"\brelay\b", re.IGNORECASE),
    "support_person": re.compile(r"\bsupport person\b", re.IGNORECASE),
    "slower_pace": re.compile(r"\bslower[ -]paced?\b", re.IGNORECASE),
}
RECIPIENT_MODES = {"public_contact", "consenting_demo"}

ALLOWED_TOP_LEVEL_KEYS = {
    "workflow_id",
    "owner_authorized",
    "recipient_mode",
    "recipient_consent_confirmed",
    "organization",
    "requested_routes",
    "locale",
    "allow_neutral_voicemail",
}
ALLOWED_ORGANIZATION_KEYS = {"display_name", "phone", "published_source"}


@dataclass(frozen=True)
class Organization:
    display_name: str
    phone: str
    published_source: str | None


@dataclass(frozen=True)
class AccessRouteRequest:
    workflow_id: str
    owner_authorized: bool
    recipient_mode: str
    recipient_consent_confirmed: bool
    organization: Organization
    requested_routes: tuple[str, ...]
    locale: str
    allow_neutral_voicemail: bool


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview or place one CALL-E call that asks an organization which "
            "accessible communication routes it supports."
        )
    )
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional new JSON output path; existing files are never overwritten.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Place exactly one CALL-E call. Without this flag, only a preview is created.",
    )
    parser.add_argument(
        "--confirm-owner-authorized",
        action="store_true",
        help="Required for live mode; confirms the person requesting the call approved it.",
    )
    parser.add_argument(
        "--receipt",
        help="Preview receipt for the unchanged request; required for live mode.",
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
    if not minimum <= len(cleaned) <= maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} characters")
    return cleaned


def _reject_unknown_keys(raw: dict[str, Any], allowed: set[str], field: str) -> None:
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ValueError(f"{field} contains unsupported fields: {', '.join(unknown)}")


def _validate_published_source(value: Any) -> str:
    source = clean_text(value, "organization.published_source", minimum=12, maximum=300)
    parsed = urlparse(source)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(
            "organization.published_source must be a public HTTPS URL without credentials"
        )
    return source


def parse_request(raw: Any) -> AccessRouteRequest:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")
    _reject_unknown_keys(raw, ALLOWED_TOP_LEVEL_KEYS, "request")

    workflow_id = clean_text(raw.get("workflow_id"), "workflow_id", minimum=3, maximum=64)
    if not SAFE_ID_PATTERN.fullmatch(workflow_id):
        raise ValueError(
            "workflow_id may contain only letters, numbers, dot, underscore, and hyphen"
        )

    if raw.get("owner_authorized") is not True:
        raise ValueError("owner_authorized must be true")

    recipient_mode = raw.get("recipient_mode", "public_contact")
    if recipient_mode not in RECIPIENT_MODES:
        raise ValueError("recipient_mode must be public_contact or consenting_demo")
    recipient_consent_confirmed = raw.get("recipient_consent_confirmed", False)
    if not isinstance(recipient_consent_confirmed, bool):
        raise ValueError("recipient_consent_confirmed must be true or false")

    organization_raw = raw.get("organization")
    if not isinstance(organization_raw, dict):
        raise ValueError("organization must be an object")
    _reject_unknown_keys(
        organization_raw, ALLOWED_ORGANIZATION_KEYS, "organization"
    )
    phone = clean_text(
        organization_raw.get("phone"), "organization.phone", minimum=8, maximum=16
    )
    if not E164_PATTERN.fullmatch(phone):
        raise ValueError("organization.phone must use E.164 format")
    published_source_raw = organization_raw.get("published_source")
    if recipient_mode == "public_contact":
        published_source = _validate_published_source(published_source_raw)
        if recipient_consent_confirmed:
            raise ValueError(
                "recipient_consent_confirmed must be false for public_contact mode"
            )
    else:
        if recipient_consent_confirmed is not True:
            raise ValueError(
                "consenting_demo mode requires recipient_consent_confirmed true"
            )
        if published_source_raw is not None:
            raise ValueError(
                "consenting_demo mode must not include organization.published_source"
            )
        published_source = None

    organization = Organization(
        display_name=clean_text(
            organization_raw.get("display_name"),
            "organization.display_name",
            minimum=2,
            maximum=100,
        ),
        phone=phone,
        published_source=published_source,
    )

    route_values = raw.get("requested_routes")
    if not isinstance(route_values, list) or not 1 <= len(route_values) <= 6:
        raise ValueError("requested_routes must contain 1-6 route names")
    if any(not isinstance(route, str) for route in route_values):
        raise ValueError("requested_routes must contain strings")
    if len(set(route_values)) != len(route_values):
        raise ValueError("requested_routes must not contain duplicates")
    unsupported = sorted(set(route_values) - set(ROUTE_LABELS))
    if unsupported:
        raise ValueError(f"unsupported requested route: {', '.join(unsupported)}")

    locale = clean_text(raw.get("locale", "en-US"), "locale", minimum=2, maximum=16)
    if not LOCALE_PATTERN.fullmatch(locale):
        raise ValueError("locale must look like en-US or ko-KR")

    voicemail = raw.get("allow_neutral_voicemail", False)
    if not isinstance(voicemail, bool):
        raise ValueError("allow_neutral_voicemail must be true or false")

    return AccessRouteRequest(
        workflow_id=workflow_id,
        owner_authorized=True,
        recipient_mode=recipient_mode,
        recipient_consent_confirmed=recipient_consent_confirmed,
        organization=organization,
        requested_routes=tuple(route_values),
        locale=locale,
        allow_neutral_voicemail=voicemail,
    )


def load_request(path: Path) -> AccessRouteRequest:
    with path.expanduser().open(encoding="utf-8") as handle:
        return parse_request(json.load(handle))


def request_document(request: AccessRouteRequest) -> dict[str, Any]:
    organization = {
        "display_name": request.organization.display_name,
        "phone": request.organization.phone,
    }
    if request.organization.published_source is not None:
        organization["published_source"] = request.organization.published_source
    return {
        "workflow_id": request.workflow_id,
        "owner_authorized": request.owner_authorized,
        "recipient_mode": request.recipient_mode,
        "recipient_consent_confirmed": request.recipient_consent_confirmed,
        "organization": organization,
        "requested_routes": list(request.requested_routes),
        "locale": request.locale,
        "allow_neutral_voicemail": request.allow_neutral_voicemail,
    }


def preview_receipt(request: AccessRouteRequest) -> str:
    canonical = json.dumps(
        request_document(request), sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(b"access-route-caller-v1\0" + canonical).hexdigest()


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def route_questions(request: AccessRouteRequest) -> str:
    return "; ".join(
        f"{route}: {ROUTE_LABELS[route]}" for route in request.requested_routes
    )


def build_task(request: AccessRouteRequest) -> str:
    voicemail_instruction = (
        "If a person does not answer, leave only a neutral message saying an automated assistant called to ask about communication options; include no other details."
        if request.allow_neutral_voicemail
        else "If a person does not answer, do not leave a voicemail."
    )
    opening = (
        f"Place one controlled accessibility-information demo call to {request.organization.display_name}. "
        "The recipient explicitly agreed to receive this demo call and may role-play an organization. In the first sentence, disclose that you are an AI calling assistant making a demonstration call and confirm that they still agree to continue. If they do not confirm, end immediately. Treat every answer as demonstration data, not verified public instructions. "
        if request.recipient_mode == "consenting_demo"
        else f"Place one accessibility-information call to {request.organization.display_name}. "
    )
    disclosure = (
        ""
        if request.recipient_mode == "consenting_demo"
        else "In the first sentence, disclose that you are an AI calling assistant. "
    )
    information_boundary = (
        "This call may gather demonstration communication-access instructions only. "
        if request.recipient_mode == "consenting_demo"
        else "This call may gather public access instructions only. "
    )
    stop_boundary = (
        "If the demo participant withdraws consent or stops role-playing, end politely. If asked for personal or service-specific information, explain that this is only a controlled demonstration and do not collect it. "
        if request.recipient_mode == "consenting_demo"
        else "If the organization will not speak with an automated caller, record that and end politely. If asked for personal or service-specific information, explain that you are only collecting public communication-access instructions, then end if the public instructions cannot be provided. "
    )
    return (
        opening
        + disclosure
        + "Say that a person asked you to find a communication route they can use instead of an unplanned live phone conversation. "
        "Do not state or ask why they need another route. Ask whether the organization supports each requested option and what a person must do to use it. "
        f"The requested options are: {route_questions(request)}. "
        f"{information_boundary}Do not access or change an account, verify identity, make or change an appointment, buy anything, accept terms or fees, transfer the call into a service interaction, or make any commitment. "
        "Do not request or disclose a name, date of birth, address, account or case number, diagnosis, insurance information, payment information, legal facts, financial facts, password, code, or other personal information. "
        f"{stop_boundary}"
        f"{voicemail_instruction} Summarize the available routes, conditions, and the safest next step, then end the call."
    )


def build_result_schema(request: AccessRouteRequest) -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "organization_reached",
            "automated_caller_accepted",
            "route_results",
            "next_step",
            "evidence_summary",
        ],
        "properties": {
            "organization_reached": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "automated_caller_accepted": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "route_results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["route", "availability", "instructions"],
                    "properties": {
                        "route": {
                            "type": "string",
                            "enum": list(request.requested_routes),
                        },
                        "availability": {
                            "type": "string",
                            "enum": ["yes", "no", "conditional", "unknown"],
                        },
                        "instructions": {
                            "type": "string",
                            "description": (
                                "Demonstration instructions only; omit personal information."
                                if request.recipient_mode == "consenting_demo"
                                else "Public instructions only; omit personal information."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
            },
            "next_step": {
                "type": "string",
                "enum": [
                    "use_available_route",
                    "human_follow_up_needed",
                    "no_route_found",
                    "outcome_unknown",
                ],
            },
            "evidence_summary": {
                "type": "string",
                "description": (
                    "Short paraphrase of the controlled demonstration, with no personal information."
                    if request.recipient_mode == "consenting_demo"
                    else "Short paraphrase of what the organization said, with no personal information."
                ),
            },
        },
        "additionalProperties": False,
    }


def idempotency_key(request: AccessRouteRequest) -> str:
    return f"accessroute-{request.workflow_id}"


def build_call_arguments(request: AccessRouteRequest) -> dict[str, Any]:
    return {
        "task": build_task(request),
        "recipients": [
            {"phones": [request.organization.phone], "locale": request.locale}
        ],
        "result_schema": build_result_schema(request),
        "metadata": {
            "workflow_id": request.workflow_id,
            "workflow_type": "accessible_communication_route_discovery",
            "recipient_mode": request.recipient_mode,
        },
        "idempotency_key": idempotency_key(request),
    }


def preview(request: AccessRouteRequest) -> dict[str, Any]:
    arguments = build_call_arguments(request)
    arguments["recipients"] = [
        {"phones": [mask_phone(request.organization.phone)], "locale": request.locale}
    ]
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "workflow_id": request.workflow_id,
        "organization": request.organization.display_name,
        "recipient_mode": request.recipient_mode,
        "recipient_consent_confirmed": request.recipient_consent_confirmed,
        "published_source": request.organization.published_source,
        "requested_routes": list(request.requested_routes),
        "call_arguments": arguments,
        "receipt": preview_receipt(request),
        "live_command_note": (
            "Live mode requires the unchanged request, --execute, "
            "--confirm-owner-authorized, this receipt, and CALLE_API_KEY."
        ),
    }


def redact_phone_like_text(value: Any) -> Any:
    if isinstance(value, str):
        return PHONE_LIKE_PATTERN.sub("[phone-redacted]", value)
    if isinstance(value, list):
        return [redact_phone_like_text(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_phone_like_text(item) for key, item in value.items()}
    return value


def result_consistency_warnings(
    request: AccessRouteRequest, structured_result: Any
) -> list[str]:
    if not isinstance(structured_result, dict):
        return ["Structured result is unavailable or malformed; review provider output."]
    route_results = structured_result.get("route_results")
    if not isinstance(route_results, list):
        return ["route_results is missing or malformed; review provider output."]

    counts: dict[str, int] = {}
    valid_results: list[dict[str, Any]] = []
    for item in route_results:
        if not isinstance(item, dict):
            continue
        route = item.get("route")
        if not isinstance(route, str):
            continue
        counts[route] = counts.get(route, 0) + 1
        valid_results.append(item)

    warnings = [
        f"Missing requested route result: {route}."
        for route in request.requested_routes
        if counts.get(route, 0) == 0
    ]
    warnings.extend(
        f"Duplicate route result: {route}."
        for route in request.requested_routes
        if counts.get(route, 0) > 1
    )

    unavailable = {
        item.get("route")
        for item in valid_results
        if item.get("availability") == "no"
    }
    for item in valid_results:
        source_route = item.get("route")
        instructions = item.get("instructions")
        if item.get("availability") not in {"yes", "conditional"}:
            continue
        if not isinstance(source_route, str) or not isinstance(instructions, str):
            continue
        for unavailable_route in request.requested_routes:
            if unavailable_route == source_route or unavailable_route not in unavailable:
                continue
            pattern = ROUTE_MENTION_PATTERNS[unavailable_route]
            if pattern.search(instructions):
                warnings.append(
                    "Possible contradiction: "
                    f"{source_route} instructions reference {unavailable_route}, "
                    f"but {unavailable_route} is marked unavailable."
                )
    return warnings


def execute(
    request: AccessRouteRequest,
    client: Any,
    *,
    receipt: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    expected_receipt = preview_receipt(request)
    if receipt != expected_receipt:
        raise ValueError(
            "receipt does not match the current request; preview it again before calling"
        )
    created = client.calls.create(**build_call_arguments(request))
    call_id = created.get("id")
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("CALL-E create response did not contain a call id")
    completed = client.calls.wait_for_result(
        call_id, timeout_seconds=timeout_seconds, interval_seconds=2
    )
    structured_result = redact_phone_like_text(completed.get("structured_result"))
    return {
        "mode": "execute",
        "creates_phone_call": True,
        "workflow_id": request.workflow_id,
        "organization": request.organization.display_name,
        "phone": mask_phone(request.organization.phone),
        "idempotency_key": idempotency_key(request),
        "call_id": call_id,
        "status": completed.get("status"),
        "task_completed": completed.get("task_completed"),
        "completion_confidence": completed.get("completion_confidence"),
        "structured_result": structured_result,
        "consistency_warnings": result_consistency_warnings(
            request, structured_result
        ),
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
        if not args.confirm_owner_authorized:
            raise ValueError("--execute requires --confirm-owner-authorized")
        if not args.receipt:
            raise ValueError("--execute requires the receipt from preview mode")
        if args.timeout_seconds <= 0:
            raise ValueError("--timeout-seconds must be positive")
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise ValueError("CALLE_API_KEY is required for --execute")

        from calle import CalleClient

        client = CalleClient(api_key=api_key, base_url=args.base_url)
        write_output(
            args.output,
            execute(
                request,
                client,
                receipt=args.receipt,
                timeout_seconds=args.timeout_seconds,
            ),
        )
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
