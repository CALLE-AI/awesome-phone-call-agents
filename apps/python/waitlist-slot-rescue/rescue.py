import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol


DEFAULT_BASE_URL = "https://api.heycall-e.com"
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$")
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)[+(\d][\d(). \-]{6,30}\d(?!\w)")
SERVICE_CATEGORIES = {
    "salon",
    "vehicle-service",
    "home-service",
    "tutoring",
    "fitness",
    "other-non-regulated",
}
TERMINAL_OUTCOMES = {
    "accepted",
    "declined",
    "no-answer",
    "wrong-person",
    "opted-out",
    "unknown",
}


def audit_event(
    sequence: int,
    event: str,
    *,
    decision: str,
    candidate_id: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    """Return one deterministic, privacy-safe workflow event."""
    payload: dict[str, Any] = {
        "sequence": sequence,
        "event": event,
        "decision": decision,
    }
    if candidate_id is not None:
        payload["candidate_id"] = candidate_id
    if reason is not None:
        payload["reason"] = reason
    return payload


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    phone: str
    position: int
    locale: str


@dataclass(frozen=True)
class RescueRequest:
    workflow_id: str
    slot_id: str
    business_display_name: str
    service_category: str
    service_label: str
    slot_start: datetime
    offer_expires_at: datetime
    candidates: tuple[Candidate, ...]


class CallTransport(Protocol):
    def place(self, request: RescueRequest, candidate: Candidate) -> dict[str, Any]: ...


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview, simulate, or run a consent-first waitlist slot rescue."
    )
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preview", action="store_true")
    mode.add_argument(
        "--simulate-results",
        type=Path,
        help="Run end to end with fixture outcomes; never contacts CALL-E.",
    )
    mode.add_argument(
        "--execute", action="store_true", help="Place sequential CALL-E calls."
    )
    parser.add_argument(
        "--confirm-authorized-waitlist",
        action="store_true",
        help="Required for live execution.",
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


def parse_timestamp(value: Any, field: str) -> datetime:
    text = clean_text(value, field, minimum=20, maximum=40)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO 8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a UTC offset")
    return parsed


def parse_request(raw: Any, *, now: datetime | None = None) -> RescueRequest:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        raise ValueError("now must be timezone-aware")

    workflow_id = clean_text(raw.get("workflow_id"), "workflow_id", minimum=3, maximum=64)
    slot_id = clean_text(raw.get("slot_id"), "slot_id", minimum=3, maximum=64)
    for field, value in (("workflow_id", workflow_id), ("slot_id", slot_id)):
        if not SAFE_ID_PATTERN.fullmatch(value):
            raise ValueError(f"{field} may contain only letters, numbers, dot, underscore, and hyphen")

    category = clean_text(
        raw.get("service_category"), "service_category", minimum=3, maximum=32
    )
    if category not in SERVICE_CATEGORIES:
        raise ValueError(
            "service_category must be a supported non-regulated category: "
            + ", ".join(sorted(SERVICE_CATEGORIES))
        )

    slot_start = parse_timestamp(raw.get("slot_start"), "slot_start")
    offer_expires_at = parse_timestamp(raw.get("offer_expires_at"), "offer_expires_at")
    if offer_expires_at <= clock:
        raise ValueError("offer_expires_at must be in the future")
    if slot_start <= offer_expires_at:
        raise ValueError("slot_start must be after offer_expires_at")

    raw_candidates = raw.get("candidates")
    if not isinstance(raw_candidates, list) or not 1 <= len(raw_candidates) <= 20:
        raise ValueError("candidates must contain 1-20 entries")

    candidates: list[Candidate] = []
    seen_ids: set[str] = set()
    seen_positions: set[int] = set()
    seen_phones: set[str] = set()
    for index, item in enumerate(raw_candidates):
        if not isinstance(item, dict):
            raise ValueError(f"candidates[{index}] must be an object")
        if item.get("consented_to_waitlist_calls") is not True:
            raise ValueError(f"candidates[{index}].consented_to_waitlist_calls must be true")
        candidate_id = clean_text(
            item.get("candidate_id"), f"candidates[{index}].candidate_id", minimum=3, maximum=64
        )
        if not SAFE_ID_PATTERN.fullmatch(candidate_id) or candidate_id in seen_ids:
            raise ValueError(f"candidates[{index}].candidate_id must be unique and safe")
        seen_ids.add(candidate_id)
        phone = clean_text(item.get("phone"), f"candidates[{index}].phone", minimum=8, maximum=16)
        if not E164_PATTERN.fullmatch(phone):
            raise ValueError(f"candidates[{index}].phone must use E.164 format")
        if phone in seen_phones:
            raise ValueError(f"candidates[{index}].phone must be unique")
        seen_phones.add(phone)
        position = item.get("position")
        if not isinstance(position, int) or position < 1 or position in seen_positions:
            raise ValueError(f"candidates[{index}].position must be a unique positive integer")
        seen_positions.add(position)
        locale = clean_text(item.get("locale", "en-US"), f"candidates[{index}].locale", minimum=2, maximum=16)
        if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", locale):
            raise ValueError(f"candidates[{index}].locale must look like en-US")
        candidates.append(Candidate(candidate_id, phone, position, locale))

    candidates.sort(key=lambda candidate: candidate.position)
    return RescueRequest(
        workflow_id=workflow_id,
        slot_id=slot_id,
        business_display_name=clean_text(
            raw.get("business_display_name"), "business_display_name", minimum=2, maximum=80
        ),
        service_category=category,
        service_label=clean_text(raw.get("service_label"), "service_label", minimum=3, maximum=120),
        slot_start=slot_start,
        offer_expires_at=offer_expires_at,
        candidates=tuple(candidates),
    )


def load_request(path: Path) -> RescueRequest:
    with path.expanduser().open(encoding="utf-8") as handle:
        return parse_request(json.load(handle))


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def redact_phone_like_text(value: Any) -> Any:
    if isinstance(value, str):
        def replace_if_phone(match: re.Match[str]) -> str:
            digit_count = sum(character.isdigit() for character in match.group(0))
            return "[phone-redacted]" if 8 <= digit_count <= 15 else match.group(0)

        return PHONE_LIKE_PATTERN.sub(replace_if_phone, value)
    if isinstance(value, list):
        return [redact_phone_like_text(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_phone_like_text(item) for key, item in value.items()}
    return value


def idempotency_key(request: RescueRequest, candidate: Candidate) -> str:
    canonical = f"{request.workflow_id}|{request.slot_id}|{candidate.candidate_id}"
    digest = hashlib.sha256(canonical.encode()).hexdigest()[:20]
    return f"waitlist-rescue-{digest}"


def build_task(request: RescueRequest, candidate: Candidate) -> str:
    start = request.slot_start.isoformat()
    expiry = request.offer_expires_at.isoformat()
    return (
        f"Call on behalf of {request.business_display_name} about one newly available "
        f"{request.service_label} slot at {start}. Conduct the conversation in the language implied by "
        f"the BCP 47 locale {candidate.locale}. Use short sentences, ask only one question at a time, "
        "and wait for the participant's answer after every question. Sound warm and conversational, "
        "with a natural cadence and brief pauses; do not read field names or ISO timestamps aloud. "
        "Acknowledge each answer before moving on. If there is silence, ask once whether the participant "
        "can hear you; if there is still no reliable answer, end with an unknown outcome. First identify "
        "yourself as an AI "
        "calling assistant and say the number was supplied through an opt-in waitlist. Then confirm this "
        "is the intended waitlist participant. Only after that confirmation, ask whether they agree to "
        "continue the AI-assisted call. If they do not, record the appropriate wrong-person or opted-out "
        "outcome and end immediately. Explain that the slot is not reserved yet, their response is valid "
        f"only until {expiry}, and a human must confirm any booking. Finally, ask only whether they want "
        "the slot. Never treat silence, an interruption, a hang-up, or an unclear answer as agreement. "
        "Do not book, cancel, take payment, negotiate, collect sensitive information, or promise "
        "availability. End after one clear answer."
    )


def build_result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "right_person",
            "continued_after_ai_disclosure",
            "waitlist_call_opt_out",
            "wants_slot",
            "evidence_summary",
        ],
        "properties": {
            "right_person": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person confirmed they are the intended waitlist participant.",
            },
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person agreed to continue after the AI disclosure.",
            },
            "waitlist_call_opt_out": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person explicitly asked not to receive further waitlist calls.",
            },
            "wants_slot": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the intended participant explicitly wants the offered slot.",
            },
            "evidence_summary": {
                "type": "string",
                "description": "A short paraphrase supporting the outcome, with no phone number or sensitive data.",
            },
        },
        "additionalProperties": False,
    }


def _transcript_text(result: dict[str, Any]) -> str:
    chunks: list[str] = []

    def collect(value: Any, *, in_transcript: bool = False) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                transcript_container = key in {"transcript", "turns", "transcript_turns"}
                if key == "transcript_text" and isinstance(item, str):
                    chunks.append(item)
                elif transcript_container and isinstance(item, str):
                    chunks.append(item)
                elif in_transcript and key in {"text", "content"} and isinstance(item, str):
                    chunks.append(item)
                else:
                    collect(item, in_transcript=in_transcript or transcript_container)
        elif isinstance(value, list):
            for item in value:
                collect(item, in_transcript=in_transcript)

    collect(result)
    return "\n".join(chunk for chunk in chunks if chunk.strip())


def _has_provider_evidence(result: dict[str, Any]) -> bool:
    evidence = result.get("evidence")
    if isinstance(evidence, list):
        return bool(evidence)
    if isinstance(evidence, dict):
        return bool(evidence)
    return False


def _has_high_confidence_evidence(result: dict[str, Any]) -> bool:
    return _completion_gate_failure(result) is None


def _completion_gate_failure(result: dict[str, Any]) -> str | None:
    if str(result.get("status", "")).lower() != "completed":
        return "provider-status-not-completed"
    if result.get("task_completed") is not True:
        return "task-not-completed"
    confidence = result.get("completion_confidence")
    if not isinstance(confidence, dict):
        return "missing-completion-confidence"
    try:
        score = float(confidence.get("score", 0))
    except (TypeError, ValueError):
        return "invalid-completion-confidence"
    if score < 0.8 or str(confidence.get("label", "")).lower() != "high":
        return "insufficient-completion-confidence"
    if not _has_provider_evidence(result):
        return "missing-provider-evidence"
    if not _transcript_text(result).strip():
        return "missing-transcript"
    return None


def _verified_no_answer(result: dict[str, Any]) -> bool:
    if str(result.get("status", "")).lower() != "failed":
        return False
    if result.get("structured_result") not in (None, {}):
        return False
    if result.get("evidence") or _transcript_text(result).strip():
        return False

    error = result.get("error")
    if isinstance(error, dict) and str(error.get("code", "")).lower() in {
        "no_answer",
        "not_connected",
        "unreachable",
    }:
        return True

    recipients = result.get("recipients")
    if not isinstance(recipients, list) or not recipients:
        return False
    attempts_seen = False
    for recipient in recipients:
        if not isinstance(recipient, dict):
            return False
        attempts = recipient.get("attempts")
        if not isinstance(attempts, list) or not attempts:
            return False
        for attempt in attempts:
            if not isinstance(attempt, dict):
                return False
            attempts_seen = True
            if str(attempt.get("status", "")).lower() not in {"failed", "canceled"}:
                return False
            if str(attempt.get("failure_code", "")).lower() not in {
                "no_answer",
                "not_connected",
                "unreachable",
            }:
                return False
            if attempt.get("transcript_turns"):
                return False
    return attempts_seen


def _classify_completed_result_with_reason(result: dict[str, Any]) -> tuple[str, str]:
    gate_failure = _completion_gate_failure(result)
    if gate_failure:
        return "unknown", gate_failure

    structured = result.get("structured_result")
    if not isinstance(structured, dict):
        return "unknown", "missing-structured-result"

    allowed = {"yes", "no", "unknown"}
    fields = {
        name: str(structured.get(name, "unknown")).lower()
        for name in (
            "right_person",
            "continued_after_ai_disclosure",
            "waitlist_call_opt_out",
            "wants_slot",
        )
    }
    if any(value not in allowed for value in fields.values()):
        return "unknown", "invalid-structured-fields"
    if fields["waitlist_call_opt_out"] == "yes":
        return "opted-out", "explicit-opt-out"
    if fields["right_person"] == "no":
        return "wrong-person", "wrong-person-confirmed"
    if (
        fields["right_person"] == "yes"
        and fields["continued_after_ai_disclosure"] == "yes"
        and fields["waitlist_call_opt_out"] == "no"
        and fields["wants_slot"] == "yes"
    ):
        return "accepted", "evidence-backed-acceptance"
    if (
        fields["right_person"] == "yes"
        and fields["continued_after_ai_disclosure"] == "yes"
        and fields["waitlist_call_opt_out"] == "no"
        and fields["wants_slot"] == "no"
    ):
        return "declined", "evidence-backed-decline"
    return "unknown", "ambiguous-structured-result"


def _classify_completed_result(result: dict[str, Any]) -> str:
    return _classify_completed_result_with_reason(result)[0]


def _privacy_safe_provider_diagnostics(
    result: dict[str, Any], classification_reason: str
) -> dict[str, Any]:
    confidence = result.get("completion_confidence")
    confidence_score: float | None = None
    confidence_label: str | None = None
    if isinstance(confidence, dict):
        try:
            confidence_score = float(confidence.get("score"))
        except (TypeError, ValueError):
            confidence_score = None
        raw_label = confidence.get("label")
        if isinstance(raw_label, str):
            normalized_label = raw_label.lower()
            confidence_label = (
                normalized_label
                if normalized_label in {"high", "medium", "low"}
                else "unknown"
            )

    structured = result.get("structured_result")
    decision_fields: dict[str, str] = {}
    if isinstance(structured, dict):
        for name in (
            "right_person",
            "continued_after_ai_disclosure",
            "waitlist_call_opt_out",
            "wants_slot",
        ):
            value = str(structured.get(name, "unknown")).lower()
            decision_fields[name] = value if value in {"yes", "no", "unknown"} else "invalid"

    provider_status = str(result.get("status", "unknown")).lower()
    if provider_status not in {
        "created",
        "queued",
        "ringing",
        "in_progress",
        "completed",
        "failed",
        "canceled",
    }:
        provider_status = "unknown"

    return {
        "provider_status": provider_status,
        "task_completed": result.get("task_completed") is True,
        "confidence_score": confidence_score,
        "confidence_label": confidence_label,
        "has_provider_evidence": _has_provider_evidence(result),
        "has_transcript": bool(_transcript_text(result).strip()),
        "decision_fields": decision_fields,
        "classification_reason": classification_reason,
    }


def build_call_arguments(request: RescueRequest, candidate: Candidate) -> dict[str, Any]:
    return {
        "task": build_task(request, candidate),
        "recipients": [{"phones": [candidate.phone], "locale": candidate.locale}],
        "result_schema": build_result_schema(),
        "metadata": {
            "workflow_id": request.workflow_id,
            "slot_id": request.slot_id,
            "candidate_id": candidate.candidate_id,
            "workflow_type": "waitlist_slot_rescue",
        },
        "idempotency_key": idempotency_key(request, candidate),
    }


class CalleTransport:
    def __init__(self, client: Any, timeout_seconds: int):
        self.client = client
        self.timeout_seconds = timeout_seconds

    def place(self, request: RescueRequest, candidate: Candidate) -> dict[str, Any]:
        created = self.client.calls.create(**build_call_arguments(request, candidate))
        call_id = created.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise RuntimeError("CALL-E create response did not contain a call id")
        completed = self.client.calls.wait_for_result(
            call_id, timeout_seconds=self.timeout_seconds, interval_seconds=2
        )
        structured = completed.get("structured_result")
        if _verified_no_answer(completed):
            outcome = "no-answer"
            classification_reason = "provider-verified-no-answer"
        else:
            outcome, classification_reason = _classify_completed_result_with_reason(completed)
        return {
            "outcome": outcome,
            "evidence_summary": redact_phone_like_text(
                structured.get("evidence_summary", "") if isinstance(structured, dict) else ""
            ),
            "classification_reason": classification_reason,
            "provider_diagnostics": _privacy_safe_provider_diagnostics(
                completed, classification_reason
            ),
            "call_id": call_id,
        }


class FixtureTransport:
    def __init__(self, fixtures: dict[str, Any]):
        self.fixtures = fixtures

    def place(self, request: RescueRequest, candidate: Candidate) -> dict[str, Any]:
        raw = self.fixtures.get(candidate.candidate_id)
        if not isinstance(raw, dict) or raw.get("outcome") not in TERMINAL_OUTCOMES:
            return {
                "outcome": "unknown",
                "evidence_summary": "No valid fixture outcome.",
                "classification_reason": "invalid-fixture-outcome",
            }
        return {
            "outcome": raw["outcome"],
            "evidence_summary": redact_phone_like_text(raw.get("evidence_summary", "")),
            "classification_reason": raw.get(
                "classification_reason", "fixture-declared-outcome"
            ),
        }


def run_rescue(
    request: RescueRequest,
    transport: CallTransport,
    *,
    simulated: bool,
    now: Callable[[], datetime] | None = None,
) -> dict[str, Any]:
    clock = now or (lambda: datetime.now(timezone.utc))
    attempts: list[dict[str, Any]] = []
    audit_events = [
        audit_event(1, "request.validated", decision="continue", reason="all-safety-gates-passed")
    ]
    selected_candidate_id: str | None = None
    final_status = "exhausted"
    for candidate in request.candidates:
        if clock() >= request.offer_expires_at:
            final_status = "offer-expired"
            audit_events.append(
                audit_event(
                    len(audit_events) + 1,
                    "offer.expired",
                    decision="stop",
                    reason="expiry-reached-before-dispatch",
                )
            )
            break
        audit_events.append(
            audit_event(
                len(audit_events) + 1,
                "candidate.dispatch-authorized",
                decision="call-one",
                candidate_id=candidate.candidate_id,
                reason="next-consented-candidate-in-queue",
            )
        )
        result = transport.place(request, candidate)
        outcome = result.get("outcome", "unknown")
        if outcome not in TERMINAL_OUTCOMES:
            outcome = "unknown"
        attempt = {
            "candidate_id": candidate.candidate_id,
            "position": candidate.position,
            "phone": mask_phone(candidate.phone),
            "outcome": outcome,
            "evidence_summary": result.get("evidence_summary", ""),
            "classification_reason": result.get(
                "classification_reason", "transport-outcome-without-reason"
            ),
            "idempotency_key": idempotency_key(request, candidate),
        }
        if isinstance(result.get("provider_diagnostics"), dict):
            attempt["provider_diagnostics"] = redact_phone_like_text(
                result["provider_diagnostics"]
            )
        if result.get("call_id"):
            attempt["call_id"] = result["call_id"]
        attempts.append(attempt)
        audit_events.append(
            audit_event(
                len(audit_events) + 1,
                f"outcome.{outcome}",
                decision="evaluate-stop-rule",
                candidate_id=candidate.candidate_id,
                reason=attempt["classification_reason"],
            )
        )
        if clock() >= request.offer_expires_at:
            final_status = "offer-expired-after-call-human-review"
            audit_events.append(
                audit_event(
                    len(audit_events) + 1,
                    "workflow.halted",
                    decision="human-review",
                    candidate_id=candidate.candidate_id,
                    reason="expiry-reached-after-call",
                )
            )
            break
        if outcome == "accepted":
            selected_candidate_id = candidate.candidate_id
            final_status = "candidate-found-human-confirmation-required"
            audit_events.append(
                audit_event(
                    len(audit_events) + 1,
                    "workflow.handoff",
                    decision="human-confirmation",
                    candidate_id=candidate.candidate_id,
                    reason="first-evidence-backed-acceptance",
                )
            )
            break
        if outcome == "unknown":
            final_status = "halted-ambiguous-outcome"
            audit_events.append(
                audit_event(
                    len(audit_events) + 1,
                    "workflow.halted",
                    decision="human-review",
                    candidate_id=candidate.candidate_id,
                    reason="ambiguous-outcome-fails-closed",
                )
            )
            break

    attempted_ids = {attempt["candidate_id"] for attempt in attempts}
    untouched = [
        candidate.candidate_id for candidate in request.candidates if candidate.candidate_id not in attempted_ids
    ]
    human_confirmation_required = selected_candidate_id is not None
    human_review_required = human_confirmation_required or final_status in {
        "halted-ambiguous-outcome",
        "offer-expired-after-call-human-review",
    }
    if not audit_events[-1]["event"].startswith("workflow.") and final_status == "exhausted":
        audit_events.append(
            audit_event(
                len(audit_events) + 1,
                "workflow.exhausted",
                decision="stop",
                reason="end-of-waitlist",
            )
        )
    return {
        "schema_version": 1,
        "mode": "simulate" if simulated else "execute",
        "creates_phone_calls": not simulated,
        "workflow_id": request.workflow_id,
        "slot_id": request.slot_id,
        "status": final_status,
        "selected_candidate_id": selected_candidate_id,
        "booking_created": False,
        "human_confirmation_required": human_confirmation_required,
        "human_review_required": human_review_required,
        "attempts": attempts,
        "untouched_candidate_ids": untouched,
        "safety_invariants": {
            "calls_are_sequential": True,
            "automatic_redial_is_disabled": True,
            "booking_is_never_created": True,
            "ambiguous_outcome_halts_queue": True,
        },
        "audit_events": audit_events,
    }


def preview(request: RescueRequest) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "mode": "preview",
        "creates_phone_calls": False,
        "workflow_id": request.workflow_id,
        "slot_id": request.slot_id,
        "service_category": request.service_category,
        "slot_start": request.slot_start.isoformat(),
        "offer_expires_at": request.offer_expires_at.isoformat(),
        "candidate_count": len(request.candidates),
        "candidates": [
            {
                "candidate_id": candidate.candidate_id,
                "position": candidate.position,
                "phone": mask_phone(candidate.phone),
                "idempotency_key": idempotency_key(request, candidate),
            }
            for candidate in request.candidates
        ],
        "stop_rules": ["first-acceptance", "ambiguous-outcome", "end-of-waitlist"],
        "booking_created": False,
        "human_review_required": False,
        "safety_invariants": {
            "calls_are_sequential": True,
            "automatic_redial_is_disabled": True,
            "booking_is_never_created": True,
            "ambiguous_outcome_halts_queue": True,
        },
        "audit_events": [
            audit_event(
                1,
                "request.validated",
                decision="preview-only",
                reason="all-safety-gates-passed-no-call-created",
            )
        ],
    }


def load_fixtures(path: Path) -> dict[str, Any]:
    with path.expanduser().open(encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ValueError("simulate-results must be a JSON object keyed by candidate_id")
    return raw


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
        if args.simulate_results:
            transport = FixtureTransport(load_fixtures(args.simulate_results))
            write_output(args.output, run_rescue(request, transport, simulated=True))
            return 0
        if not args.execute:
            write_output(args.output, preview(request))
            return 0
        if not args.confirm_authorized_waitlist:
            raise ValueError("--execute requires --confirm-authorized-waitlist")
        if args.timeout_seconds <= 0:
            raise ValueError("--timeout-seconds must be positive")
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise ValueError("CALLE_API_KEY is required for --execute")
        from calle import CalleClient

        client = CalleClient(api_key=api_key, base_url=args.base_url)
        transport = CalleTransport(client, args.timeout_seconds)
        write_output(args.output, run_rescue(request, transport, simulated=False))
        return 0
    except (FileExistsError, OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
