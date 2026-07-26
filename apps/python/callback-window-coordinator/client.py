import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from zoneinfo import available_timezones


DEFAULT_BASE_URL = "https://api.heycall-e.com"
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$")
WINDOW_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")


@dataclass(frozen=True)
class CallbackWindow:
    id: str
    label: str


@dataclass(frozen=True)
class CallbackRequest:
    workflow_id: str
    phone: str
    recipient_has_requested_callback: bool
    business_display_name: str
    callback_purpose: str
    callback_date: str
    timezone: str
    locale: str
    windows: tuple[CallbackWindow, ...]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview or run one consent-first callback-window call with CALL-E."
    )
    parser.add_argument(
        "--request", required=True, type=Path, help="Path to the request JSON file."
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional new JSON result path; existing files are never overwritten.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--preview",
        action="store_true",
        help="Validate and print a masked no-call plan. This is the default.",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Create exactly one CALL-E call task and wait for its result.",
    )
    parser.add_argument(
        "--confirm-recipient-opt-in",
        action="store_true",
        help="Required with --execute; confirms the recipient requested this callback.",
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


def parse_request(raw: Any) -> CallbackRequest:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")

    workflow_id = clean_text(
        raw.get("workflow_id"), "workflow_id", minimum=3, maximum=64
    )
    if not SAFE_ID_PATTERN.fullmatch(workflow_id):
        raise ValueError(
            "workflow_id may contain only letters, numbers, dot, underscore, and hyphen"
        )

    phone = clean_text(raw.get("phone"), "phone", minimum=8, maximum=16)
    if not E164_PATTERN.fullmatch(phone):
        raise ValueError("phone must use E.164 format, for example +12025550123")

    opt_in = raw.get("recipient_has_requested_callback")
    if opt_in is not True:
        raise ValueError("recipient_has_requested_callback must be true")

    callback_date = clean_text(
        raw.get("callback_date"), "callback_date", minimum=10, maximum=10
    )
    try:
        parsed_date = date.fromisoformat(callback_date)
    except ValueError as exc:
        raise ValueError("callback_date must use YYYY-MM-DD") from exc
    if parsed_date < date.today():
        raise ValueError("callback_date must not be in the past")

    timezone_name = clean_text(raw.get("timezone"), "timezone", minimum=3, maximum=64)
    if timezone_name not in available_timezones() or (
        "/" not in timezone_name and timezone_name != "UTC"
    ):
        raise ValueError("timezone must be a valid IANA timezone name")

    locale = clean_text(raw.get("locale", "en-US"), "locale", minimum=2, maximum=16)
    if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", locale):
        raise ValueError("locale must look like en-US or ko-KR")

    raw_windows = raw.get("available_windows")
    if not isinstance(raw_windows, list) or not 2 <= len(raw_windows) <= 6:
        raise ValueError("available_windows must contain 2-6 window objects")

    windows: list[CallbackWindow] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_windows):
        if not isinstance(item, dict):
            raise ValueError(f"available_windows[{index}] must be an object")
        window_id = clean_text(
            item.get("id"), f"available_windows[{index}].id", minimum=2, maximum=32
        )
        if not WINDOW_ID_PATTERN.fullmatch(window_id):
            raise ValueError(
                f"available_windows[{index}].id must be lower-case kebab-case"
            )
        if window_id in seen_ids or window_id in {"decline", "unknown"}:
            raise ValueError(
                f"available_windows[{index}].id must be unique and not reserved"
            )
        seen_ids.add(window_id)
        label = clean_text(
            item.get("label"),
            f"available_windows[{index}].label",
            minimum=3,
            maximum=80,
        )
        windows.append(CallbackWindow(id=window_id, label=label))

    return CallbackRequest(
        workflow_id=workflow_id,
        phone=phone,
        recipient_has_requested_callback=True,
        business_display_name=clean_text(
            raw.get("business_display_name"),
            "business_display_name",
            minimum=2,
            maximum=80,
        ),
        callback_purpose=clean_text(
            raw.get("callback_purpose"), "callback_purpose", minimum=10, maximum=180
        ),
        callback_date=callback_date,
        timezone=timezone_name,
        locale=locale,
        windows=tuple(windows),
    )


def load_request(path: Path) -> CallbackRequest:
    with path.expanduser().open(encoding="utf-8") as handle:
        return parse_request(json.load(handle))


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def build_task(request: CallbackRequest) -> str:
    choices = "; ".join(f"{window.id}: {window.label}" for window in request.windows)
    return (
        f"Place one callback-window coordination call on behalf of {request.business_display_name}. "
        "At the start, identify yourself as an AI calling assistant and say the recipient previously requested this callback. "
        "Ask whether this is the intended recipient and whether they want to continue. If either answer is no, apologize, "
        "do not ask anything else, record the opt-out, and end the call. Do not request sensitive personal, medical, legal, "
        "or financial information. Do not book, cancel, purchase, promise, or modify any service. "
        f"The callback purpose is: {request.callback_purpose}. The date is {request.callback_date} in {request.timezone}. "
        f"Offer only these callback windows: {choices}. Ask which window they prefer and whether a voicemail is acceptable "
        "if the future human callback is missed. Repeat the selected window once for confirmation, then end politely."
    )


def build_result_schema(request: CallbackRequest) -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "right_person",
            "continued_after_ai_disclosure",
            "preferred_window_id",
            "voicemail_allowed",
            "evidence_summary",
        ],
        "properties": {
            "right_person": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the recipient confirmed they are the intended callback recipient.",
            },
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the recipient agreed to continue after the AI identity and callback context were disclosed.",
            },
            "preferred_window_id": {
                "type": "string",
                "enum": [
                    *[window.id for window in request.windows],
                    "decline",
                    "unknown",
                ],
                "description": "The confirmed offered window id, decline if no callback is wanted, or unknown when unclear.",
            },
            "voicemail_allowed": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the recipient permits a voicemail if the future human callback is missed.",
            },
            "evidence_summary": {
                "type": "string",
                "description": "One short paraphrase supporting the extracted choices; omit phone numbers and sensitive information.",
            },
        },
        "additionalProperties": False,
    }


def idempotency_key(request: CallbackRequest) -> str:
    return f"callwindow-{request.workflow_id}"


def build_call_arguments(request: CallbackRequest) -> dict[str, Any]:
    return {
        "task": build_task(request),
        "recipients": [{"phones": [request.phone], "locale": request.locale}],
        "result_schema": build_result_schema(request),
        "metadata": {
            "workflow_id": request.workflow_id,
            "workflow_type": "callback_window_coordination",
        },
        "idempotency_key": idempotency_key(request),
    }


def preview(request: CallbackRequest) -> dict[str, Any]:
    arguments = build_call_arguments(request)
    arguments["recipients"] = [
        {"phones": [mask_phone(request.phone)], "locale": request.locale}
    ]
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "workflow_id": request.workflow_id,
        "recipient_opt_in_recorded": request.recipient_has_requested_callback,
        "call_arguments": arguments,
    }


def redact_phone_like_text(value: Any) -> Any:
    if isinstance(value, str):
        return PHONE_LIKE_PATTERN.sub("[phone-redacted]", value)
    if isinstance(value, list):
        return [redact_phone_like_text(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_phone_like_text(item) for key, item in value.items()}
    return value


def execute(
    request: CallbackRequest, client: Any, *, timeout_seconds: int
) -> dict[str, Any]:
    arguments = build_call_arguments(request)
    created = client.calls.create(**arguments)
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
        "structured_result": redact_phone_like_text(completed.get("structured_result")),
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
        if not args.confirm_recipient_opt_in:
            raise ValueError("--execute requires --confirm-recipient-opt-in")
        if args.timeout_seconds <= 0:
            raise ValueError("--timeout-seconds must be positive")
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise ValueError("CALLE_API_KEY is required for --execute")
        from calle import CalleClient

        client = CalleClient(api_key=api_key, base_url=args.base_url)
        write_output(
            args.output, execute(request, client, timeout_seconds=args.timeout_seconds)
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
