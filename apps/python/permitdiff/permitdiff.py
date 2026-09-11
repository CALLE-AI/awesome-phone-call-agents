"""PermitDiff: reconcile stale or conflicting permit records with one bounded CALL-E call."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.heycall-e.com"
LOOPBACK_TEST_API_KEY = "loopback-test-key"
TERMINAL_SUCCESS = {"completed", "succeeded"}
MIN_CONFIDENCE = 0.80
RECIPIENT_SPEAKERS = {"recipient", "user", "callee"}
PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")
STATUS_VALUES = {
    "submitted",
    "reviewing",
    "corrections_required",
    "ready_for_inspection",
    "issued",
    "closed",
    "unknown",
}


@dataclass(frozen=True)
class PermitSnapshot:
    jurisdiction: str
    permit_id: str
    public_project_reference: str
    portal_status: str
    portal_updated_at_utc: str
    portal_missing_items_summary: str
    portal_next_step: str


@dataclass(frozen=True)
class OfficeContact:
    phone: str
    region: str
    locale: str


@dataclass(frozen=True)
class ReconciliationRequest:
    snapshot: PermitSnapshot
    office: OfficeContact
    caller_authorized_for_permit: bool
    stale_after_hours: int
    explicit_discrepancy: str


class CallsAPI(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def wait_for_result(
        self, call_id: str, *, timeout_seconds: int, interval_seconds: int
    ) -> dict[str, Any]: ...


def _text(value: Any, field: str, limit: int, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    text = value.strip()
    if not allow_empty and not text:
        raise ValueError(f"{field} must be non-empty")
    if len(text) > limit:
        raise ValueError(f"{field} exceeds {limit} characters")
    return text


def _parse_utc(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("portal_updated_at_utc must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise ValueError("portal_updated_at_utc must include a timezone")
    return parsed.astimezone(timezone.utc)


def parse_request(data: dict[str, Any]) -> ReconciliationRequest:
    if not isinstance(data, dict):
        raise ValueError("request must be an object")
    raw_snapshot = data.get("snapshot")
    raw_office = data.get("office")
    if not isinstance(raw_snapshot, dict) or not isinstance(raw_office, dict):
        raise ValueError("snapshot and office must be objects")

    status = _text(raw_snapshot.get("portal_status"), "portal_status", 40).lower()
    if status not in STATUS_VALUES:
        raise ValueError("portal_status is not supported")
    updated = _text(raw_snapshot.get("portal_updated_at_utc"), "portal_updated_at_utc", 40)
    _parse_utc(updated)
    snapshot = PermitSnapshot(
        jurisdiction=_text(raw_snapshot.get("jurisdiction"), "jurisdiction", 120),
        permit_id=_text(raw_snapshot.get("permit_id"), "permit_id", 100),
        public_project_reference=_text(
            raw_snapshot.get("public_project_reference"), "public_project_reference", 180
        ),
        portal_status=status,
        portal_updated_at_utc=updated,
        portal_missing_items_summary=_text(
            raw_snapshot.get("portal_missing_items_summary", ""),
            "portal_missing_items_summary",
            500,
            allow_empty=True,
        ),
        portal_next_step=_text(
            raw_snapshot.get("portal_next_step", ""), "portal_next_step", 500, allow_empty=True
        ),
    )

    phone = _text(raw_office.get("phone"), "office.phone", 20)
    if not PHONE_RE.fullmatch(phone):
        raise ValueError("office.phone must be E.164")
    office = OfficeContact(
        phone=phone,
        region=_text(raw_office.get("region"), "office.region", 8).upper(),
        locale=_text(raw_office.get("locale"), "office.locale", 20),
    )

    authorized = data.get("caller_authorized_for_permit")
    if authorized is not True:
        raise ValueError("caller_authorized_for_permit must be explicitly true")
    stale_after = data.get("stale_after_hours", 72)
    if isinstance(stale_after, bool) or not isinstance(stale_after, int) or not 1 <= stale_after <= 720:
        raise ValueError("stale_after_hours must be an integer from 1 to 720")
    discrepancy = _text(
        data.get("explicit_discrepancy", ""), "explicit_discrepancy", 500, allow_empty=True
    )
    return ReconciliationRequest(
        snapshot=snapshot,
        office=office,
        caller_authorized_for_permit=True,
        stale_after_hours=stale_after,
        explicit_discrepancy=discrepancy,
    )


def canonical_snapshot(snapshot: PermitSnapshot) -> dict[str, Any]:
    return {
        "jurisdiction": snapshot.jurisdiction,
        "permit_id": snapshot.permit_id,
        "public_project_reference": snapshot.public_project_reference,
        "portal_status": snapshot.portal_status,
        "portal_updated_at_utc": snapshot.portal_updated_at_utc,
        "portal_missing_items_summary": snapshot.portal_missing_items_summary,
        "portal_next_step": snapshot.portal_next_step,
    }


def snapshot_hash(snapshot: PermitSnapshot) -> str:
    encoded = json.dumps(
        canonical_snapshot(snapshot), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def call_reason(request: ReconciliationRequest, now: datetime | None = None) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    current = current.astimezone(timezone.utc)
    updated = _parse_utc(request.snapshot.portal_updated_at_utc)
    age_hours = (current - updated).total_seconds() / 3600
    if age_hours < -0.01:
        return {"call_recommended": False, "reason": "portal_timestamp_in_future", "age_hours": age_hours}
    if request.explicit_discrepancy:
        return {"call_recommended": True, "reason": "explicit_discrepancy", "age_hours": age_hours}
    if age_hours >= request.stale_after_hours:
        return {"call_recommended": True, "reason": "stale_portal_snapshot", "age_hours": age_hours}
    return {"call_recommended": False, "reason": "fresh_record_without_discrepancy", "age_hours": age_hours}


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "continued_after_ai_disclosure",
            "disposition",
            "permit_id_confirmed",
            "office_status",
            "missing_items_known",
            "missing_items_summary",
            "next_procedural_step",
            "inspection_ready",
            "status_quote",
            "next_step_quote",
            "notes",
        ],
        "properties": {
            "continued_after_ai_disclosure": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "disposition": {
                "type": "string",
                "enum": ["answered", "refused", "voicemail", "unreachable", "unclear"],
            },
            "permit_id_confirmed": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "office_status": {"type": "string", "enum": sorted(STATUS_VALUES)},
            "missing_items_known": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "missing_items_summary": {"type": "string", "maxLength": 500},
            "next_procedural_step": {"type": "string", "maxLength": 500},
            "inspection_ready": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "status_quote": {"type": "string", "maxLength": 300},
            "next_step_quote": {"type": "string", "maxLength": 300},
            "notes": {"type": "string", "maxLength": 500},
        },
        "additionalProperties": False,
    }


def build_task(request: ReconciliationRequest) -> str:
    s = request.snapshot
    trigger = request.explicit_discrepancy or (
        f"the portal snapshot is at least {request.stale_after_hours} hours old"
    )
    return (
        f"Call the public permit office for {s.jurisdiction} in locale {request.office.locale} on behalf "
        "of an applicant-side operator authorized to ask about this permit. Identify yourself as an AI "
        "assistant and ask whether the staff member is willing to continue. If they decline or are unsure, "
        "thank them and end the call. The bounded purpose is to reconcile an online permit record, not to "
        "seek legal advice or pressure staff. Permit ID: "
        f"{s.permit_id}. Public project reference: {s.public_project_reference}. The portal currently shows "
        f"status={s.portal_status}; last update={s.portal_updated_at_utc}; missing-items summary="
        f"{s.portal_missing_items_summary or 'none shown'}; next step={s.portal_next_step or 'none shown'}. "
        f"Reason for reconciliation: {trigger}. Ask staff to confirm they found the same permit ID, then ask "
        "only for the office's current factual status, whether known missing items remain, the next procedural "
        "step, and whether the office considers the record ready for inspection. Do not ask the staff member "
        "to approve the permit, accelerate it, waive a requirement, interpret law, accept money, take a payment, "
        "change an inspection, or make a commitment. Do not state that a permit is legally issued merely because "
        "the phone answer says issued. Read back the factual status and next step once. status_quote must be a "
        "short verbatim quote from the staff member supporting office_status. next_step_quote must be a short "
        "verbatim quote supporting next_procedural_step; if the next step is unknown, leave it empty. Prefer "
        "unknown/unclear over guessing."
    )


def call_arguments(request: ReconciliationRequest) -> dict[str, Any]:
    s = request.snapshot
    return {
        "task": build_task(request),
        "recipients": [
            {
                "phones": [request.office.phone],
                "region": request.office.region,
                "locale": request.office.locale,
            }
        ],
        "result_schema": result_schema(),
        "metadata": {
            "workflow_type": "permit_record_reconciliation",
            "jurisdiction": s.jurisdiction,
            "permit_id": s.permit_id,
            "snapshot_hash": snapshot_hash(s),
        },
    }


def idempotency_key(request: ReconciliationRequest) -> str:
    canonical = json.dumps(
        call_arguments(request), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return f"permitdiff-{hashlib.sha256(canonical).hexdigest()}"


def confidence_score(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        score = value.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            return float(score)
    return 0.0


def valid_structured_result(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    schema = result_schema()
    required = schema["required"]
    if set(value) != set(required):
        return False
    for field in required:
        item = value[field]
        rule = schema["properties"][field]
        if not isinstance(item, str):
            return False
        if len(item) > rule.get("maxLength", 10_000):
            return False
        if "enum" in rule and item not in rule["enum"]:
            return False
    return True


def recipient_transcript(provider_result: dict[str, Any], destination: str) -> str:
    recipients = provider_result.get("recipients")
    if not isinstance(recipients, list) or len(recipients) != 1:
        return ""
    recipient = recipients[0]
    if not isinstance(recipient, dict) or recipient.get("phone") != destination:
        return ""
    attempts = recipient.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        return ""
    turns: list[str] = []
    for attempt in attempts:
        if not isinstance(attempt, dict):
            continue
        transcript = attempt.get("transcript_turns")
        if not isinstance(transcript, list):
            continue
        for turn in transcript:
            if (
                isinstance(turn, dict)
                and str(turn.get("speaker", "")).lower() in RECIPIENT_SPEAKERS
                and isinstance(turn.get("text"), str)
            ):
                turns.append(turn["text"])
    return "\n".join(turns)


def _tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.casefold())


def quote_grounded(quote: Any, transcript: str) -> bool:
    if not isinstance(quote, str) or not quote.strip():
        return False
    expected = _tokens(quote)
    observed = _tokens(transcript)
    if len(expected) < 2:
        return False
    width = len(expected)
    return any(observed[i : i + width] == expected for i in range(len(observed) - width + 1))


def _binding_valid(
    request: ReconciliationRequest,
    provider_result: dict[str, Any],
    expected_call_id: str | None,
) -> bool:
    s = request.snapshot
    if expected_call_id is not None and provider_result.get("id") != expected_call_id:
        return False
    if provider_result.get("metadata") != {
        "workflow_type": "permit_record_reconciliation",
        "jurisdiction": s.jurisdiction,
        "permit_id": s.permit_id,
        "snapshot_hash": snapshot_hash(s),
    }:
        return False
    transcript = recipient_transcript(provider_result, request.office.phone)
    structured = provider_result.get("structured_result")
    if not isinstance(structured, dict):
        return False
    if not quote_grounded(structured.get("status_quote"), transcript):
        return False
    next_step = structured.get("next_procedural_step")
    if isinstance(next_step, str) and next_step.strip() and next_step.strip().casefold() != "unknown":
        if not quote_grounded(structured.get("next_step_quote"), transcript):
            return False
    return True


def reconcile_result(
    request: ReconciliationRequest,
    provider_result: dict[str, Any],
    *,
    expected_call_id: str | None = None,
) -> dict[str, Any]:
    boundary = (
        "A phone answer can surface a discrepancy; only the municipality's official record or an "
        "authorized human process establishes permit state."
    )
    structured = provider_result.get("structured_result")
    if (
        provider_result.get("status") not in TERMINAL_SUCCESS
        or provider_result.get("task_completed") is not True
        or confidence_score(provider_result.get("completion_confidence")) < MIN_CONFIDENCE
        or not valid_structured_result(structured)
    ):
        return {"route": "needs_human", "reason": "No reliable complete terminal result.", "claim_boundary": boundary}
    assert isinstance(structured, dict)
    if structured["disposition"] != "answered" or structured["continued_after_ai_disclosure"] != "yes":
        return {
            "route": "no_phone_evidence",
            "reason": f"Disposition is {structured['disposition']}.",
            "claim_boundary": boundary,
        }
    if structured["permit_id_confirmed"] != "yes":
        return {"route": "needs_human", "reason": "Office did not confirm the exact permit identifier.", "claim_boundary": boundary}
    if structured["office_status"] == "unknown":
        return {"route": "needs_human", "reason": "Office status remained unknown.", "claim_boundary": boundary}
    if not _binding_valid(request, provider_result, expected_call_id):
        return {"route": "needs_human", "reason": "Phone evidence was not bound to the exact snapshot and recipient transcript.", "claim_boundary": boundary}

    portal_status = request.snapshot.portal_status
    office_status = structured["office_status"]
    if office_status == portal_status:
        route = "verified_match"
        reason = "Grounded phone evidence agrees with the captured portal status."
    else:
        route = "discrepancy_detected"
        reason = "Grounded phone evidence differs from the captured portal status; record confirmation is required."
    return {
        "route": route,
        "reason": reason,
        "portal_status": portal_status,
        "phone_reported_status": office_status,
        "missing_items_summary": structured["missing_items_summary"],
        "next_procedural_step": structured["next_procedural_step"],
        "inspection_ready_reported": structured["inspection_ready"],
        "requires_official_record_confirmation": True,
        "claim_boundary": boundary,
    }


class ReservationLedger:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS calls (key TEXT PRIMARY KEY, state TEXT NOT NULL, call_id TEXT, detail TEXT)"
            )

    def claim(self, key: str) -> bool:
        try:
            with sqlite3.connect(self.path) as db:
                db.execute("INSERT INTO calls(key, state) VALUES (?, 'reserved')", (key,))
            return True
        except sqlite3.IntegrityError:
            return False

    def mark(self, key: str, state: str, call_id: str | None = None, detail: str | None = None) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "UPDATE calls SET state=?, call_id=COALESCE(?, call_id), detail=? WHERE key=?",
                (state, call_id, detail, key),
            )

    def get(self, key: str) -> tuple[str, str | None, str | None] | None:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT state, call_id, detail FROM calls WHERE key=?", (key,)).fetchone()
        return row if row else None


def _is_loopback_base_url(value: str) -> bool:
    parsed = urlparse(value)
    return (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.port is not None
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    )


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "api.heycall-e.com"
        and parsed.port in {None, 443}
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return DEFAULT_BASE_URL
    if _is_loopback_base_url(value):
        return value.rstrip("/")
    raise ValueError("base URL must be CALL-E production or an explicit loopback test server")


def api_key_for_base_url(base_url: str) -> str:
    """Use a non-secret credential for local fakes; require a real key in production."""
    if _is_loopback_base_url(base_url):
        return LOOPBACK_TEST_API_KEY
    key = os.environ.get("CALLE_API_KEY", "").strip()
    if not key:
        raise ValueError("CALLE_API_KEY is required for production --execute")
    return key


def execute(
    request: ReconciliationRequest,
    calls: CallsAPI,
    ledger: ReservationLedger,
    *,
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    key = idempotency_key(request)
    if not ledger.claim(key):
        state = ledger.get(key)
        raise RuntimeError(f"call already reserved; reconcile existing state {state[0] if state else 'unknown'}")
    accepted_call_id: str | None = None
    try:
        created = calls.create(**call_arguments(request), idempotency_key=key)
        call_id = created.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise RuntimeError("CALL-E create response did not contain a call id")
        accepted_call_id = call_id
        ledger.mark(key, "accepted", call_id)
        completed = calls.wait_for_result(call_id, timeout_seconds=timeout_seconds, interval_seconds=2)
        decision = reconcile_result(request, completed, expected_call_id=call_id)
        ledger.mark(key, "completed", call_id)
        return {"call_id": call_id, "decision": decision, "provider_result": completed}
    except Exception as exc:
        ledger.mark(key, "outcome_unknown", accepted_call_id, type(exc).__name__)
        raise RuntimeError(
            "CALL-E outcome is unknown; reconcile the existing reservation before any retry"
        ) from exc


def mask_phone(phone: str) -> str:
    if len(phone) <= 6:
        return "*" * len(phone)
    return f"{phone[:2]}{'*' * (len(phone) - 6)}{phone[-4:]}"


def preview(request: ReconciliationRequest, now: datetime | None = None) -> dict[str, Any]:
    reason = call_reason(request, now)
    payload: dict[str, Any] = {
        "mode": "preview",
        "creates_phone_call": False,
        "call_recommended": reason["call_recommended"],
        "trigger": reason,
        "snapshot_hash": snapshot_hash(request.snapshot),
        "claim_boundary": (
            "A phone answer can surface a discrepancy; only the municipality's official record or an "
            "authorized human process establishes permit state."
        ),
    }
    if reason["call_recommended"]:
        args = call_arguments(request)
        args["recipients"] = [
            {
                "phones": [mask_phone(request.office.phone)],
                "region": request.office.region,
                "locale": request.office.locale,
            }
        ]
        payload["idempotency_key"] = idempotency_key(request)
        payload["call_arguments"] = args
    return payload


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized-office-call", action="store_true")
    parser.add_argument("--allow", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--database", type=Path, default=Path("data/permitdiff.sqlite3"))
    args = parser.parse_args(argv)
    try:
        request = parse_request(_load(args.request))
        reason = call_reason(request)
        if not args.execute:
            print(json.dumps(preview(request), ensure_ascii=False, indent=2))
            return 0
        if reason["call_recommended"] is not True:
            raise ValueError(f"live call refused: {reason['reason']}")
        if not args.confirm_authorized_office_call:
            raise ValueError("--execute requires --confirm-authorized-office-call")
        if request.office.phone not in set(args.allow):
            raise ValueError("--execute requires the exact office phone in --allow")
        if os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").lower() != "true":
            raise ValueError("--execute requires CALLE_LIVE_CALLS_ENABLED=true")
        base_url = validate_base_url(os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL))
        api_key = api_key_for_base_url(base_url)
        from calle import CalleClient

        with CalleClient(
            api_key=api_key,
            base_url=base_url,
        ) as client:
            result = execute(
                request,
                client.calls,
                ReservationLedger(args.database),
                timeout_seconds=args.timeout_seconds,
            )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
