"""AccessLine bounded workflow orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from accessline.adapter import CallEAdapter, CallERestProvider, CallRequest, CallResponse
from accessline.exceptions import CallEUnavailable
from accessline.calle_contract import IMPLEMENTATION_STATE_READY
from accessline.ledger import CallLedger
from accessline.live_auth import (
    LIVE_CALL_ACTION,
    LiveAuthorizationError,
    LiveCallIntent,
    assert_live_call_authorized,
)
from accessline.privacy import public_input_dict, sanitize_artifact_dict
from accessline.prompt import build_call_script, script_contains_disclosure
from accessline.schema import (
    AccessLineInput,
    AccessLineResult,
    is_valid_accessline_verification,
    utc_now_iso,
)


class ConsentRequired(Exception):
    """Consent gate blocks progression toward a real call."""


class WorkflowError(Exception):
    """Workflow validation failure."""


@dataclass(frozen=True)
class WorkflowArtifacts:
    input_data: AccessLineInput
    call_required: bool
    script: str
    request: CallRequest | None
    response: CallResponse | None
    result: AccessLineResult


def _intent_from_input(input_data: AccessLineInput) -> LiveCallIntent | None:
    if not input_data.live_run_id or not input_data.live_authorized_destination_e164:
        return None
    return LiveCallIntent(
        run_id=str(input_data.live_run_id),
        authorized_destination_e164=str(input_data.live_authorized_destination_e164),
        action=str(input_data.live_action or LIVE_CALL_ACTION),
    )


class AccessLineWorkflow:
    def __init__(self, adapter: CallEAdapter | None = None, ledger: CallLedger | None = None) -> None:
        self.adapter = adapter or CallEAdapter()
        self.ledger = ledger or CallLedger()

    def assert_consent_for_call(self, input_data: AccessLineInput) -> None:
        if not input_data.consent_confirmed:
            raise ConsentRequired("consent_confirmed must be true before any call path")

    def assert_live_authorization(self, input_data: AccessLineInput) -> LiveCallIntent:
        """Strict live gates: E.164 + exact destination + fresh per-run intent."""
        self.assert_consent_for_call(input_data)
        try:
            return assert_live_call_authorized(
                destination=input_data.phone_number,
                consent_confirmed=input_data.consent_confirmed,
                live_intent=_intent_from_input(input_data),
                expected_run_id=input_data.live_run_id,
            )
        except LiveAuthorizationError as exc:
            raise WorkflowError(str(exc)) from exc

    def assert_call_required(self, input_data: AccessLineInput) -> bool:
        return bool(input_data.venue_name and input_data.phone_number)

    def run_mock(self, input_data: AccessLineInput, mock_response: dict[str, Any], *, transcript: str | None = None) -> WorkflowArtifacts:
        self.assert_consent_for_call(input_data)
        if not self.assert_call_required(input_data):
            raise WorkflowError("venue_name and phone_number are required")
        script = build_call_script(input_data)
        if not script_contains_disclosure(script):
            raise WorkflowError("automation disclosure missing from script")
        request = self.adapter.build_request(input_data, mode="mock")
        self.ledger.record_mock_call(label=input_data.venue_name)
        response = self.adapter.place_call(request)
        if transcript is not None:
            response = CallResponse(transcript=transcript, structured=response.structured)
        result = self.adapter.normalize_response(
            input_data=input_data,
            response=response,
            called_at=mock_response.get("called_at") or utc_now_iso(),
        )
        return WorkflowArtifacts(
            input_data=input_data,
            call_required=True,
            script=script,
            request=request,
            response=response,
            result=result,
        )

    def preview_live_path(self, input_data: AccessLineInput) -> dict[str, Any]:
        # Preview still requires consent, but does not place a call.
        self.assert_consent_for_call(input_data)
        if not self.ledger.can_place_live_call():
            raise WorkflowError(self.ledger.stop_reason or "live-call path blocked")
        script = build_call_script(input_data)
        # Documented spec may require credential; surface blocked_reason without calling.
        spec = self.adapter.build_documented_create_call_spec(input_data)
        # Never echo full phone in preview.
        if isinstance(spec, dict):
            body = spec.get("body") or spec.get("body_preview_without_auth")
            if isinstance(body, dict):
                recipients = body.get("recipients")
                if isinstance(recipients, list):
                    for recipient in recipients:
                        if isinstance(recipient, dict) and "phones" in recipient:
                            from accessline.privacy import mask_phone

                            recipient["phones"] = [
                                mask_phone(str(p)) for p in (recipient.get("phones") or [])
                            ]
        return {
            "call_required": True,
            "script": script,
            "provider_state": self.adapter.implementation_state,
            "documented_create_call": spec,
            "live_call_count": self.ledger.live_call_count,
            "credential_required_env": "CALLE_API_KEY",
            "destination_preview": public_input_dict(
                venue_name=input_data.venue_name,
                phone_number=input_data.phone_number,
                visit_date=input_data.visit_date,
                consent_confirmed=input_data.consent_confirmed,
            )["phone_number"],
            "live_authorization_required": True,
        }

    def preview_blocked_live_path(self, input_data: AccessLineInput) -> dict[str, Any]:
        return self.preview_live_path(input_data)

    def run_live(self, input_data: AccessLineInput) -> WorkflowArtifacts:
        # Fresh intent + E.164 + exact destination BEFORE any provider call.
        self.assert_live_authorization(input_data)
        if not self.ledger.can_place_live_call():
            raise WorkflowError(self.ledger.stop_reason or "live-call path blocked")
        script = build_call_script(input_data)
        request = self.adapter.build_request(input_data, mode="live")
        self.ledger.assert_can_record_live_call()
        if isinstance(self.adapter._provider, CallERestProvider):
            response = self.adapter._provider.place_call(
                request,
                on_call_accepted=lambda: self.ledger.record_live_call(
                    label=input_data.venue_name
                ),
            )
        else:
            self.ledger.record_live_call(label=input_data.venue_name)
            response = self.adapter.place_call(request)
        result = self.adapter.normalize_response(input_data=input_data, response=response)
        if is_valid_accessline_verification(result):
            try:
                self.ledger.mark_first_valid_result()
            except Exception:
                pass
        return WorkflowArtifacts(
            input_data=input_data,
            call_required=True,
            script=script,
            request=request,
            response=response,
            result=result,
        )

    def artifacts_to_dict(
        self,
        artifacts: WorkflowArtifacts,
        *,
        include_transcript: bool = False,
    ) -> dict[str, Any]:
        payload = {
            "input": public_input_dict(
                venue_name=artifacts.input_data.venue_name,
                phone_number=artifacts.input_data.phone_number,
                visit_date=artifacts.input_data.visit_date,
                consent_confirmed=artifacts.input_data.consent_confirmed,
            ),
            "call_required": artifacts.call_required,
            "script": artifacts.script,
            "mock_transcript": artifacts.response.transcript if artifacts.response else None,
            "structured_output": artifacts.result.to_dict(),
            "provider_diagnostics": (
                artifacts.response.provider_diagnostics
                if artifacts.response and artifacts.response.provider_diagnostics
                else None
            ),
            "ledger": {
                "live_call_count": self.ledger.live_call_count,
                "mock_call_count": self.ledger.mock_call_count,
            },
        }
        return sanitize_artifact_dict(payload, include_transcript=include_transcript)
