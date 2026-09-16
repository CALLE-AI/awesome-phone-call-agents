"""CALL-E provider boundary — mock and authoritative REST integration."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from accessline.calle_contract import IMPLEMENTATION_STATE_READY
from accessline.calle_rest import CallERestClient, extract_safe_provider_diagnostics
from accessline.exceptions import CallEUnavailable
from accessline.prompt import build_call_script
from accessline.schema import AccessLineInput, AccessLineResult, utc_now_iso, validate_result


@dataclass(frozen=True)
class CallRequest:
    input_data: AccessLineInput
    script: str
    mode: str


@dataclass(frozen=True)
class CallResponse:
    transcript: str
    structured: dict[str, Any]
    provider_diagnostics: dict[str, Any] | None = None


class CallEProvider(Protocol):
    def place_call(self, request: CallRequest) -> CallResponse: ...


class MockCallEProvider:
    """Deterministic in-memory provider for tests and local demo."""

    def __init__(self, response: dict[str, Any], transcript: str | None = None) -> None:
        self._response = response
        self._transcript = transcript or "MOCK TRANSCRIPT"

    def place_call(self, request: CallRequest) -> CallResponse:
        return CallResponse(transcript=self._transcript, structured=dict(self._response))


class CallERestProvider:
    """Authoritative CALL-E REST provider using POST /v1/calls."""

    def __init__(self, client: CallERestClient | None = None) -> None:
        self._client = client or CallERestClient()

    @property
    def client(self) -> CallERestClient:
        return self._client

    def place_call(
        self,
        request: CallRequest,
        *,
        on_call_accepted: Callable[[], None] | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> CallResponse:
        idempotency_key = str(uuid.uuid4())
        call_task = self._client.create_call(
            request.input_data,
            request.script,
            idempotency_key=idempotency_key,
        )
        if on_call_accepted is not None:
            on_call_accepted()
        terminal_task = self._client.wait_for_terminal_call(call_task, sleeper=sleeper)
        result, transcript = self._client.normalize_call_task_with_transcript(
            terminal_task,
            input_data=request.input_data,
        )
        return CallResponse(
            transcript=transcript,
            structured=result.to_dict(),
            provider_diagnostics=extract_safe_provider_diagnostics(terminal_task),
        )


class CallEAdapter:
    def __init__(self, provider: CallEProvider | None = None) -> None:
        self._provider = provider
        self._rest_client = CallERestClient()

    @property
    def rest_client(self) -> CallERestClient:
        if isinstance(self._provider, CallERestProvider):
            return self._provider.client
        return self._rest_client

    @property
    def implementation_state(self) -> str:
        if isinstance(self._provider, MockCallEProvider):
            return "MOCK_PROVIDER"
        if isinstance(self._provider, CallERestProvider):
            if self._provider.client.api_key_present:
                return "CALL_E_REST_READY"
            return IMPLEMENTATION_STATE_READY
        if self._rest_client.api_key_present:
            return IMPLEMENTATION_STATE_READY
        return IMPLEMENTATION_STATE_READY

    def build_request(self, input_data: AccessLineInput, *, mode: str) -> CallRequest:
        return CallRequest(
            input_data=input_data,
            script=build_call_script(input_data),
            mode=mode,
        )

    def build_documented_create_call_spec(self, input_data: AccessLineInput) -> dict[str, Any]:
        script = build_call_script(input_data)
        try:
            spec = self.rest_client.build_create_call_request(input_data, script)
            return spec.to_dict()
        except CallEUnavailable as exc:
            return {
                "blocked_reason": str(exc),
                "implementation_state": IMPLEMENTATION_STATE_READY,
                "body_preview_without_auth": self.rest_client.build_create_call_body(
                    input_data, script
                ),
            }

    def place_call(self, request: CallRequest) -> CallResponse:
        if self._provider is None:
            raise CallEUnavailable(IMPLEMENTATION_STATE_READY)
        return self._provider.place_call(request)

    def normalize_response(
        self,
        *,
        input_data: AccessLineInput,
        response: CallResponse,
        called_at: str | None = None,
    ) -> AccessLineResult:
        payload = dict(response.structured)
        payload.setdefault("venue_name", input_data.venue_name)
        payload.setdefault("called_at", called_at or utc_now_iso())
        payload.setdefault("source_type", "phone_call")
        return validate_result(payload)
