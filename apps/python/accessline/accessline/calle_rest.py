"""CALL-E REST adapter — authoritative contract, injectable transport."""

from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from accessline.exceptions import CallEUnavailable
from accessline.calle_contract import (
    ACCESSLINE_RECIPIENT_RESULT_SCHEMA,
    AUTH_ENV_VAR,
    BASE_URL_DEFAULT,
    BASE_URL_ENV_VAR,
    CALL_ID_FIELD,
    CREATE_CALL_METHOD,
    CREATE_CALL_PATH,
    GET_CALL_PATH_TEMPLATE,
    IDEMPOTENCY_HEADER,
    NON_TERMINAL_CALL_STATUSES,
    POLL_INTERVAL_SECONDS,
    POLL_MAX_ATTEMPTS,
    TERMINAL_CALL_STATUSES,
)
from accessline.origin import assert_approved_call_e_origin
from accessline.schema import (
    AccessLineInput,
    AccessLineResult,
    AccessibilityAnswer,
    CompletionStatus,
    derive_accessline_completion_status,
    validate_result,
)


class CallERestTransport(Protocol):
    def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, dict[str, Any]]: ...


@dataclass(frozen=True)
class CallERestRequestSpec:
    method: str
    url: str
    headers: dict[str, str]
    body: dict[str, Any]

    def redacted_headers(self) -> dict[str, str]:
        redacted = dict(self.headers)
        if "Authorization" in redacted:
            redacted["Authorization"] = "Bearer [REDACTED]"
        return redacted

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "url": self.url,
            "headers": self.redacted_headers(),
            "body": self.body,
        }


def build_verified_ssl_context() -> ssl.SSLContext:
    try:
        import certifi
    except ImportError as exc:
        raise CallEUnavailable(
            "certifi is required for verified CALL-E HTTPS transport"
        ) from exc
    try:
        return ssl.create_default_context(cafile=certifi.where())
    except OSError as exc:
        raise CallEUnavailable(
            "unable to create verified SSL context for CALL-E HTTPS transport"
        ) from exc


class UrllibCallERestTransport:
    """Real HTTP transport. Not used in deterministic tests."""

    def __init__(self, ssl_context: ssl.SSLContext | None = None) -> None:
        self._ssl_context = (
            ssl_context if ssl_context is not None else build_verified_ssl_context()
        )

    @property
    def ssl_context(self) -> ssl.SSLContext:
        return self._ssl_context

    def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(
                request, timeout=30, context=self._ssl_context
            ) as response:
                payload = response.read().decode("utf-8")
                return response.status, json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"error": raw}
            return exc.code, parsed


def _resolve_api_key(explicit: str | None) -> str | None:
    value = explicit if explicit is not None else os.environ.get(AUTH_ENV_VAR)
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _resolve_base_url(explicit: str | None) -> str:
    value = explicit if explicit is not None else os.environ.get(BASE_URL_ENV_VAR)
    candidate = (value or BASE_URL_DEFAULT).rstrip("/")
    # Validate BEFORE any credential is attached to requests.
    return assert_approved_call_e_origin(candidate)


def _as_accessibility_answer(value: Any) -> AccessibilityAnswer:
    if value in ("yes", "no", "unknown"):
        return value
    return "unknown"


def extract_safe_provider_diagnostics(call_task: dict[str, Any]) -> dict[str, Any]:
    recipients = call_task.get("recipients") or []
    recipient = recipients[0] if recipients else {}
    diagnostics = {
        "provider_status": call_task.get("status"),
        "task_completed": call_task.get("task_completed"),
        "failure_code": call_task.get("failure_code"),
        "failure_message": call_task.get("failure_message"),
        "recipient_status": recipient.get("status"),
        "attempt_count": len(recipient.get("attempts") or []),
        "completed_at": call_task.get("completed_at") or recipient.get("completed_at"),
        "created_at": call_task.get("created_at"),
    }
    return {key: value for key, value in diagnostics.items() if value is not None}


def _completion_status_from_call_task(
    call_task: dict[str, Any],
    structured: dict[str, Any] | None,
    *,
    uncertainty_notes: str = "",
) -> CompletionStatus:
    return derive_accessline_completion_status(
        provider_status=str(call_task.get("status") or ""),
        structured=structured,
        uncertainty_notes=uncertainty_notes,
        call_task=call_task,
    )


def _transcript_from_call_task(call_task: dict[str, Any]) -> str:
    lines: list[str] = []
    for recipient in call_task.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                speaker = turn.get("speaker") or "unknown"
                text = turn.get("text") or ""
                lines.append(f"{speaker}: {text}")
    return "\n".join(lines)


def _extract_call_id(call_task: dict[str, Any]) -> str | None:
    call_id = call_task.get(CALL_ID_FIELD)
    if call_id is None:
        return None
    stripped = str(call_id).strip()
    return stripped or None


def _call_status(call_task: dict[str, Any]) -> str:
    return str(call_task.get("status") or "")


class CallERestClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        transport: CallERestTransport | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        self._api_key = _resolve_api_key(api_key)
        self._base_url = _resolve_base_url(base_url)
        self._transport = transport if transport is not None else UrllibCallERestTransport()
        self._sleeper = sleeper if sleeper is not None else time.sleep

    @property
    def transport(self) -> CallERestTransport:
        return self._transport

    @property
    def api_key_present(self) -> bool:
        return bool(self._api_key)

    def require_api_key(self) -> str:
        if not self._api_key:
            raise CallEUnavailable(f"{AUTH_ENV_VAR} absent")
        return self._api_key

    def build_create_call_body(self, input_data: AccessLineInput, script: str) -> dict[str, Any]:
        return {
            "task": script,
            "recipients": [
                {
                    "phones": [input_data.phone_number],
                    "locale": "en-US",
                    "region": "US",
                }
            ],
            "recipient_result_schema": ACCESSLINE_RECIPIENT_RESULT_SCHEMA,
            "metadata": {
                "accessline_venue_name": input_data.venue_name,
                "accessline_visit_date": input_data.visit_date,
                "accessline_consent_confirmed": input_data.consent_confirmed,
            },
        }

    def build_create_call_request(
        self,
        input_data: AccessLineInput,
        script: str,
        *,
        idempotency_key: str | None = None,
    ) -> CallERestRequestSpec:
        # Origin must be approved before bearer is attached.
        approved_origin = assert_approved_call_e_origin(self._base_url)
        api_key = self.require_api_key()
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers[IDEMPOTENCY_HEADER] = idempotency_key
        body = self.build_create_call_body(input_data, script)
        return CallERestRequestSpec(
            method=CREATE_CALL_METHOD,
            url=f"{approved_origin}{CREATE_CALL_PATH}",
            headers=headers,
            body=body,
        )

    def create_call(
        self,
        input_data: AccessLineInput,
        script: str,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        spec = self.build_create_call_request(
            input_data, script, idempotency_key=idempotency_key
        )
        status, payload = self._transport.request(
            method=spec.method,
            url=spec.url,
            headers=spec.headers,
            body=json.dumps(spec.body).encode("utf-8"),
        )
        if status >= 400:
            raise CallEUnavailable(
                f"CALL-E create call failed with HTTP {status}: {payload}"
            )
        if not isinstance(payload, dict):
            raise CallEUnavailable("CALL-E create call returned non-object response")
        return payload

    def get_call(self, call_id: str) -> dict[str, Any]:
        approved_origin = assert_approved_call_e_origin(self._base_url)
        api_key = self.require_api_key()
        url = f"{approved_origin}{GET_CALL_PATH_TEMPLATE.format(call_id=call_id)}"
        status, payload = self._transport.request(
            method="GET",
            url=url,
            headers={"Authorization": f"Bearer {api_key}"},
            body=None,
        )
        if status >= 400:
            raise CallEUnavailable(f"CALL-E get call failed with HTTP {status}: {payload}")
        if not isinstance(payload, dict):
            raise CallEUnavailable("CALL-E get call returned non-object response")
        return payload

    def _handle_terminal_call_task(self, call_task: dict[str, Any]) -> dict[str, Any]:
        status = _call_status(call_task)
        if status == "completed":
            return call_task
        if status == "failed":
            failure_message = call_task.get("failure_message") or call_task.get("failure_code")
            raise CallEUnavailable(f"CALL-E call failed: {failure_message or call_task}")
        if status == "canceled":
            raise CallEUnavailable("CALL-E call canceled")
        raise CallEUnavailable(f"CALL-E call has unknown terminal status: {status or 'missing'}")

    def wait_for_terminal_call(
        self,
        call_task: dict[str, Any],
        *,
        sleeper: Callable[[float], None] | None = None,
        max_attempts: int | None = None,
    ) -> dict[str, Any]:
        sleep_fn = sleeper if sleeper is not None else self._sleeper
        attempts_limit = max_attempts if max_attempts is not None else POLL_MAX_ATTEMPTS
        current = call_task
        call_id = _extract_call_id(current)
        for attempt in range(attempts_limit):
            status = _call_status(current)
            if status in TERMINAL_CALL_STATUSES:
                return self._handle_terminal_call_task(current)
            if status not in NON_TERMINAL_CALL_STATUSES:
                raise CallEUnavailable(f"CALL-E call has unknown status: {status or 'missing'}")
            if call_id is None:
                raise CallEUnavailable("CALL-E response missing call id")
            if attempt < attempts_limit - 1:
                sleep_fn(POLL_INTERVAL_SECONDS)
                current = self.get_call(call_id)
                call_id = _extract_call_id(current) or call_id
        raise CallEUnavailable("CALL-E call polling timed out")

    def create_call_and_wait_for_terminal(
        self,
        input_data: AccessLineInput,
        script: str,
        *,
        idempotency_key: str | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> dict[str, Any]:
        call_task = self.create_call(
            input_data,
            script,
            idempotency_key=idempotency_key,
        )
        return self.wait_for_terminal_call(call_task, sleeper=sleeper)

    def normalize_call_task(
        self,
        call_task: dict[str, Any],
        *,
        input_data: AccessLineInput,
    ) -> AccessLineResult:
        recipients = call_task.get("recipients") or []
        recipient = recipients[0] if recipients else {}
        structured = recipient.get("structured_result")
        if not isinstance(structured, dict):
            structured = call_task.get("structured_result") if isinstance(call_task.get("structured_result"), dict) else None
        if not structured:
            raise CallEUnavailable("CALL-E response missing schema-valid structured_result")
        called_at = (
            call_task.get("completed_at")
            or call_task.get("created_at")
            or recipient.get("completed_at")
        )
        instructions = structured.get("access_instructions")
        uncertainty_notes = str(structured.get("uncertainty_notes") or "")
        payload = {
            "venue_name": input_data.venue_name,
            "called_at": str(called_at or ""),
            "step_free_entrance": _as_accessibility_answer(structured.get("step_free_entrance")),
            "accessible_restroom": _as_accessibility_answer(structured.get("accessible_restroom")),
            "access_instructions": None if instructions is None else str(instructions),
            "uncertainty_notes": uncertainty_notes,
            "source_type": "phone_call",
            "completion_status": _completion_status_from_call_task(
                call_task,
                structured,
                uncertainty_notes=uncertainty_notes,
            ),
        }
        return validate_result(payload)

    def normalize_call_task_with_transcript(
        self,
        call_task: dict[str, Any],
        *,
        input_data: AccessLineInput,
    ) -> tuple[AccessLineResult, str]:
        result = self.normalize_call_task(call_task, input_data=input_data)
        return result, _transcript_from_call_task(call_task)
