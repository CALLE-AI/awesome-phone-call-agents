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


def build_task(request: RescueRequest) -> str:
    start = request.slot_start.isoformat()
    expiry = request.offer_expires_at.isoformat()
    return (
        f"Call on behalf of {request.business_display_name} about one newly available "
        f"{request.service_label} slot at {start}. At the start, identify yourself as an AI calling "
        "assistant, say the number was supplied through an opt-in waitlist, confirm this is the intended "
        "waitlist participant, and ask whether they want to continue. If not, record the appropriate "
        "wrong-person or opted-out outcome and end immediately. Explain that the slot is not reserved "
        f"yet, their response is valid only until {expiry}, and a human must confirm any booking. Ask "
        "only whether they want the slot. Do not book, cancel, take payment, negotiate, collect sensitive "
        "information, or promise availability. End after one clear answer."
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
    confidence = result.get("completion_confidence")
    if not isinstance(confidence, dict):
        return False
    try:
        score = float(confidence.get("score", 0))
    except (TypeError, ValueError):
        return False
    return (
        result.get("status") == "completed"
        and result.get("task_completed") is True
        and score >= 0.8
        and str(confidence.get("label", "")).lower() == "high"
        and _has_provider_evidence(result)
        and bool(_transcript_text(result).strip())
    )


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


def _classify_completed_result(result: dict[str, Any]) -> str:
    structured = result.get("structured_result")
    if not isinstance(structured, dict) or not _has_high_confidence_evidence(result):
        return "unknown"

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
        return "unknown"
    if fields["waitlist_call_opt_out"] == "yes":
        return "opted-out"
    if fields["right_person"] == "no":
        return "wrong-person"
    if (
        fields["right_person"] == "yes"
        and fields["continued_after_ai_disclosure"] == "yes"
        and fields["waitlist_call_opt_out"] == "no"
        and fields["wants_slot"] == "yes"
    ):
        return "accepted"
    if (
        fields["right_person"] == "yes"
        and fields["continued_after_ai_disclosure"] == "yes"
        and fields["waitlist_call_opt_out"] == "no"
        and fields["wants_slot"] == "no"
    ):
        return "declined"
    return "unknown"


def build_call_arguments(request: RescueRequest, candidate: Candidate) -> dict[str, Any]:
    return {
        "task": build_task(request),
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
        outcome = "no-answer" if _verified_no_answer(completed) else _classify_completed_result(completed)
        return {
            "outcome": outcome,
            "evidence_summary": redact_phone_like_text(
                structured.get("evidence_summary", "") if isinstance(structured, dict) else ""
            ),
            "call_id": call_id,
        }


class FixtureTransport:
    def __init__(self, fixtures: dict[str, Any]):
        self.fixtures = fixtures

    def place(self, request: RescueRequest, candidate: Candidate) -> dict[str, Any]:
        raw = self.fixtures.get(candidate.candidate_id)
        if not isinstance(raw, dict) or raw.get("outcome") not in TERMINAL_OUTCOMES:
            return {"outcome": "unknown", "evidence_summary": "No valid fixture outcome."}
        return {
            "outcome": raw["outcome"],
            "evidence_summary": redact_phone_like_text(raw.get("evidence_summary", "")),
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
    selected_candidate_id: str | None = None
    final_status = "exhausted"
    for candidate in request.candidates:
        if clock() >= request.offer_expires_at:
            final_status = "offer-expired"
            break
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
            "idempotency_key": idempotency_key(request, candidate),
        }
        if result.get("call_id"):
            attempt["call_id"] = result["call_id"]
        attempts.append(attempt)
        if clock() >= request.offer_expires_at:
            final_status = "offer-expired-after-call-human-review"
            break
        if outcome == "accepted":
            selected_candidate_id = candidate.candidate_id
            final_status = "candidate-found-human-confirmation-required"
            break
        if outcome == "unknown":
            final_status = "halted-ambiguous-outcome"
            break

    attempted_ids = {attempt["candidate_id"] for attempt in attempts}
    untouched = [
        candidate.candidate_id for candidate in request.candidates if candidate.candidate_id not in attempted_ids
    ]
    return {
        "mode": "simulate" if simulated else "execute",
        "creates_phone_calls": not simulated,
        "workflow_id": request.workflow_id,
        "slot_id": request.slot_id,
        "status": final_status,
        "selected_candidate_id": selected_candidate_id,
        "booking_created": False,
        "human_confirmation_required": selected_candidate_id is not None,
        "attempts": attempts,
        "untouched_candidate_ids": untouched,
    }


def preview(request: RescueRequest) -> dict[str, Any]:
    return {
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
