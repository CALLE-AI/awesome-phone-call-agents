from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.core.datetimes import to_naive_utc, utc_now_naive
from app.integrations.calle import fetch_call
from app.models.orm import Call, Symptom
from app.repositories.call_repository import CallRepository
from app.repositories.patient_repository import PatientRepository
from app.repositories.symptom_repository import SymptomRepository
from app.repositories.webhook_event_repository import WebhookEventRepository
from app.services.ai_service import analyze_transcript
from app.services.notification_service import NotificationService
from app.services.protocol_service import ProtocolService

logger = logging.getLogger(__name__)

RISK_RANK = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}

TERMINAL_TYPES = {
    "call.completed",
    "call.failed",
    "call.result_validation_failed",
}


class WebhookServiceError(Exception):
    """Domain/service error while processing webhooks."""

    def __init__(self, message: str, status_code: int = 404):
        super().__init__(message)
        self.status_code = status_code


def _is_dry_run_provider_id(provider_call_id: str) -> bool:
    return str(provider_call_id).startswith("dryrun_")


def _flatten_transcript(data: dict[str, Any]) -> str:
    lines: list[str] = []
    recipients = data.get("recipients", [])
    if not isinstance(recipients, list):
        return ""

    for recipient in recipients:
        if not isinstance(recipient, dict):
            continue

        attempts = recipient.get("attempts", [])
        if not isinstance(attempts, list):
            continue

        for attempt in attempts:
            if not isinstance(attempt, dict):
                continue

            turns = attempt.get("transcript_turns", [])
            if not isinstance(turns, list):
                continue

            for turn in turns:
                if not isinstance(turn, dict):
                    continue
                text = turn.get("text", "").strip()
                if not text:
                    continue

                speaker = turn.get("speaker") or "unknown"
                lines.append(f"{speaker}: {text}")

    return "\n".join(lines)


def _is_worse(new_level: str, current_level: str | None) -> bool:
    return RISK_RANK.get((new_level or "").lower(), 0) > RISK_RANK.get(
        (current_level or "").lower(), 0
    )


def _first_recipient_structured_result(data: dict[str, Any]) -> dict[str, Any] | None:
    recipients = data.get("recipients", [])
    if not isinstance(recipients, list):
        return None

    for recipient in recipients:
        if isinstance(recipient, dict) and isinstance(
            recipient.get("structured_result"), dict
        ):
            return recipient["structured_result"]
    return None


class WebhookService:
    def __init__(
        self,
        calls: CallRepository,
        patients: PatientRepository,
        symptoms: SymptomRepository,
        protocols: ProtocolService,
        webhook_events: WebhookEventRepository,
        notifications: NotificationService,
    ):
        self.calls = calls
        self.patients = patients
        self.symptoms = symptoms
        self.protocols = protocols
        self.webhook_events = webhook_events
        self.notifications = notifications

    def _fetch_snapshot(self, provider_call_id: str) -> dict[str, Any]:
        try:
            return fetch_call(provider_call_id)
        except Exception as exc:
            raise WebhookServiceError(
                "failed to fetch call from CALL-E",
                status_code=502,
            ) from exc

    def process_calle_event(
        self,
        event_id: str,
        event_type: str,
        provider_call_id: str,
    ) -> dict[str, Any]:
        if event_type not in TERMINAL_TYPES:
            return {"ok": True, "ignored": True, "event_type": event_type}

        provider_id = str(provider_call_id or "").strip()
        if not provider_id:
            raise WebhookServiceError("provider call id is required", status_code=400)

        if _is_dry_run_provider_id(provider_id):
            return {"ok": True, "dry_run": True, "event_id": event_id}

        if self.notifications.is_warning_call(provider_id):
            return self._process_doctor_warning_event(
                event_id=event_id,
                event_type=event_type,
                provider_call_id=provider_id,
            )

        call = self.calls.get_by_provider_id(provider_id)
        if not call:
            raise WebhookServiceError("unknown provider call id", status_code=404)

        claimed = self.webhook_events.try_claim(
            event_id=event_id,
            event_type=event_type,
            call_id=call.id,
        )
        if claimed is None:
            return {"ok": True, "duplicate": True, "event_id": event_id}

        try:
            snapshot = self._fetch_snapshot(provider_id)
            result = self._process_claimed_event(
                event_id=event_id,
                event_type=event_type,
                data=snapshot,
                call=call,
            )
            self.webhook_events.mark_processed(claimed, call_id=call.id)
            return result
        except Exception as exc:
            self.webhook_events.mark_failed(
                claimed,
                error=str(exc),
                call_id=call.id,
            )
            raise

    def _process_doctor_warning_event(
        self,
        *,
        event_id: str,
        event_type: str,
        provider_call_id: str,
    ) -> dict[str, Any]:
        warning = self.notifications.get_warning_by_provider_id(provider_call_id)
        internal_call_id = warning.call_id if warning is not None else None
        claimed = self.webhook_events.try_claim(
            event_id=event_id,
            event_type=event_type,
            call_id=internal_call_id,
        )
        if claimed is None:
            return {"ok": True, "duplicate": True, "event_id": event_id}

        try:
            snapshot = self._fetch_snapshot(provider_call_id)
            row = self.notifications.mark_warning_call_terminal(
                provider_call_id=provider_call_id,
                internal_call_id=None,
                status=str(snapshot.get("status") or ""),
                event_type=event_type,
            )
            self.webhook_events.mark_processed(claimed, call_id=internal_call_id)
            return {
                "ok": True,
                "event_id": event_id,
                "type": event_type,
                "purpose": "doctor_warning",
                "notification_id": row.id if row else None,
                "status": row.status if row else "unknown",
            }
        except Exception as exc:
            self.webhook_events.mark_failed(
                claimed,
                error=str(exc),
                call_id=internal_call_id,
            )
            raise

    def _process_claimed_event(
        self,
        *,
        event_id: str,
        event_type: str,
        data: dict[str, Any],
        call: Call,
    ) -> dict[str, Any]:
        call.calle_call_id = str(data.get("id") or call.calle_call_id)
        call.status = str(data.get("status") or call.status)
        if data.get("completed_at"):
            try:
                parsed = datetime.fromisoformat(
                    str(data["completed_at"]).replace("Z", "+00:00")
                )
                call.call_end = to_naive_utc(parsed)
            except ValueError:
                call.call_end = utc_now_naive()
        else:
            call.call_end = utc_now_naive()

        if data.get("summary"):
            call.summary = data["summary"]

        transcript = _flatten_transcript(data)
        call.transcript = transcript or call.transcript

        if event_type == "call.failed" or call.status in {"failed", "canceled"}:
            self._reopen_followup_for_retry(call)
            self.calls.save(call)
            return {
                "ok": True,
                "event_id": event_id,
                "call_id": call.id,
                "status": call.status,
                "event_type": event_type,
            }

        structured_result = data.get("structured_result")
        if structured_result is None:
            structured_result = _first_recipient_structured_result(data)

        patient = self.patients.get_by_id(call.patient_id)
        extra_keywords = (
            self.protocols.get_emergency_keywords_for_patient(patient)
            if patient
            else None
        )

        analysis = analyze_transcript(
            transcript=transcript,
            structured_result=structured_result
            if isinstance(structured_result, dict)
            else None,
            extra_emergency_keywords=extra_keywords,
        )

        call.summary = analysis.summary or call.summary
        call.risk_score = analysis.risk_score
        call.risk_level = analysis.risk_level
        call.is_emergency = analysis.is_emergency

        symptom_rows = [
            Symptom(
                call_id=call.id,
                name=item.name,
                severity=item.severity,
                note=item.note,
            )
            for item in analysis.symptoms
        ]
        self.symptoms.replace_for_call(call.id, symptom_rows)

        if patient and _is_worse(analysis.risk_level, patient.current_risk_level):
            patient.current_risk_level = analysis.risk_level
            self.patients.save(patient)

        self.calls.save(call)

        if call.is_emergency and patient is not None:
            self.notifications.notify_emergency(patient=patient, call=call)

        return {
            "ok": True,
            "event_id": event_id,
            "call_id": call.id,
            "type": event_type,
            "risk_level": call.risk_level,
            "is_emergency": call.is_emergency,
        }

    def _reopen_followup_for_retry(self, call: Call) -> None:
        followup = call.followup
        if followup is None:
            return
        if followup.status not in {"completed", "in_progress"}:
            return
        if followup.attempt_count >= followup.max_attempts:
            followup.status = "failed"
            logger.info(
                "Follow-up %s marked failed after call %s (attempts %s/%s)",
                followup.id,
                call.id,
                followup.attempt_count,
                followup.max_attempts,
            )
            return
        followup.status = "pending"
        logger.info(
            "Follow-up %s reopened for retry after call %s failed (attempts %s/%s)",
            followup.id,
            call.id,
            followup.attempt_count,
            followup.max_attempts,
        )
