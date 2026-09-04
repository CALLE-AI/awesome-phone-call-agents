"""A local stand-in for the CALL-E API, wired in underneath the real SDK.

Twenty free calls do not survive iterating on a collections policy, so the whole
run is developed against scripted answers. This is an httpx transport rather
than a fake `CallPort`, which means `CalleClient` still builds the request,
sends the idempotency header, polls to a terminal state and maps errors — the
only thing replaced is the wire.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx

SIMULATED_BASE_URL = "https://simulator.kept.invalid"

_RELATIVE_DAYS = re.compile(r"^\+(\d+)d$")

_NO_ANSWER = {
    "outcome": "no_answer",
    "right_party_reached": "unknown",
    "promise_made": "unknown",
    "promised_amount": "unknown",
    "promised_date": "unknown",
    "payment_method": "unknown",
    "dispute_raised": "unknown",
    "dispute_reason": "unknown",
    "evidence_quote": "unknown",
}


class ScenarioError(ValueError):
    """Raised when a scenario file cannot be read as scripted call answers."""


@dataclass(slots=True)
class Scenario:
    """Scripted answers keyed by invoice id, resolved against the run's date."""

    answers: dict[str, dict[str, Any]]
    unscripted: set[str] = field(default_factory=set)

    @classmethod
    def from_file(cls, path: Path) -> "Scenario":
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ScenarioError(f"Cannot read scenario file {path}.") from exc
        if not isinstance(raw, dict):
            raise ScenarioError(f"Scenario file {path} must be an object keyed by invoice id.")
        return cls(answers=raw)

    def answer_for(self, invoice_id: str) -> dict[str, Any]:
        scripted = self.answers.get(invoice_id)
        if scripted is None:
            self.unscripted.add(invoice_id)
            return dict(_NO_ANSWER)
        return dict(scripted)


class CalleSimulator:
    """Serves the subset of the CALL-E Developer API that this app calls."""

    def __init__(self, *, scenario: Scenario, today: date) -> None:
        self._scenario = scenario
        self._today = today
        self._calls: dict[str, dict[str, Any]] = {}
        self._by_idempotency_key: dict[str, str] = {}
        self._polls: dict[str, int] = {}
        self._transport = httpx.MockTransport(self._handle)

    @property
    def transport(self) -> httpx.MockTransport:
        return self._transport

    @property
    def placed_call_count(self) -> int:
        return len(self._calls)

    @property
    def unscripted(self) -> set[str]:
        return set(self._scenario.unscripted)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/calls":
            return self._create(request)
        if request.method == "GET" and request.url.path.startswith("/v1/calls/"):
            return self._read(request.url.path.rsplit("/", 1)[-1])
        return _error(404, "not_found", f"No simulated route for {request.method} {request.url.path}.")

    def _create(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        key = request.headers.get("Idempotency-Key", "")
        if key and key in self._by_idempotency_key:
            return httpx.Response(201, json=self._calls[self._by_idempotency_key[key]])
        if "Authorization" not in request.headers:
            return _error(401, "unauthorized", "Missing bearer credentials.")
        call = self._build_call(body, index=len(self._calls) + 1)
        self._calls[call["id"]] = call
        if key:
            self._by_idempotency_key[key] = call["id"]
        return httpx.Response(201, json={**call, "status": "queued"})

    def _read(self, call_id: str) -> httpx.Response:
        call = self._calls.get(call_id)
        if call is None:
            return _error(404, "not_found", f"No simulated call {call_id}.")
        self._polls[call_id] = self._polls.get(call_id, 0) + 1
        if self._polls[call_id] < 2:
            return httpx.Response(200, json={**call, "status": "in_progress", "completed_at": None})
        return httpx.Response(200, json=call)

    def _build_call(self, body: dict[str, Any], *, index: int) -> dict[str, Any]:
        metadata = body.get("metadata") or {}
        answer = self._scenario.answer_for(str(metadata.get("invoice_id", "")))
        recipient = (body.get("recipients") or [{}])[0]
        return _terminal_call(
            call_id=f"call_sim_{index:04d}",
            task=str(body.get("task", "")),
            metadata=metadata,
            recipient=recipient,
            result=self._resolve(answer),
        )

    def _resolve(self, answer: dict[str, Any]) -> dict[str, Any]:
        raw_date = answer.get("promised_date")
        if isinstance(raw_date, str):
            answer["promised_date"] = _resolve_date(raw_date, self._today)
        return answer


def _resolve_date(value: str, today: date) -> str:
    relative = _RELATIVE_DAYS.match(value)
    if relative is None:
        return value
    return (today + timedelta(days=int(relative.group(1)))).isoformat()


def _terminal_call(
    *,
    call_id: str,
    task: str,
    metadata: dict[str, Any],
    recipient: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    status = str(result.pop("status", "completed"))
    confidence = float(result.pop("confidence", 0.9))
    task_completed = bool(result.pop("task_completed", status == "completed"))
    turns = result.pop("transcript", [])
    structured = None if status != "completed" else result
    return {
        "id": call_id,
        "object": "call_task",
        "status": status,
        "task": task,
        "recipients": [_recipient_block(recipient, structured, turns, status)],
        "structured_result": structured,
        "summary": _summarise(structured),
        "task_completed": task_completed,
        "completion_confidence": {"score": confidence, "label": _label(confidence)},
        "evidence": [structured["evidence_quote"]] if structured and structured.get("evidence_quote") else [],
        "metadata": metadata,
        "failure_code": None if status == "completed" else "provider_unavailable",
        "failure_message": None if status == "completed" else "Simulated provider failure.",
        "created_at": "2026-01-01T00:00:00Z",
        "completed_at": "2026-01-01T00:03:00Z",
    }


def _recipient_block(
    recipient: dict[str, Any], structured: dict[str, Any] | None, turns: list[Any], status: str
) -> dict[str, Any]:
    phones = recipient.get("phones") or ["+10000000000"]
    return {
        "id": "rcp_sim_0001",
        "phones": phones,
        "locale": recipient.get("locale"),
        "region": recipient.get("region"),
        "status": "completed" if status == "completed" else "failed",
        "structured_result": structured,
        "summary": _summarise(structured),
        "attempts": [
            {
                "id": "att_sim_0001",
                "phone": phones[0],
                "status": "completed" if status == "completed" else "failed",
                "started_at": "2026-01-01T00:00:05Z",
                "completed_at": "2026-01-01T00:03:00Z",
                "summary": _summarise(structured),
                "transcript_turns": [
                    {"offset_seconds": index * 6, "speaker": str(turn[0]), "text": str(turn[1])}
                    for index, turn in enumerate(turns)
                ],
                "provider_call_id": "provider_sim_0001",
                "failure_code": None if status == "completed" else "provider_unavailable",
                "failure_message": None if status == "completed" else "Simulated provider failure.",
            }
        ],
    }


def _summarise(structured: dict[str, Any] | None) -> str | None:
    if structured is None:
        return None
    return f"Simulated call outcome: {structured.get('outcome', 'unclear')}."


def _label(score: float) -> str:
    if score >= 0.8:
        return "high"
    return "medium" if score >= 0.5 else "low"


def _error(status_code: int, code: str, message: str) -> httpx.Response:
    return httpx.Response(status_code, json={"error": {"code": code, "message": message, "details": {}}})
