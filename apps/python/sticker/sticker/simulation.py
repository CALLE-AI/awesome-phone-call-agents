"""A local stand-in for the CALL-E API, wired in underneath the real transport.

Twenty free calls do not survive iterating on the wording of a pharmacy question, and
nobody should be dialling a real counter to exercise a report layout. So the default path
runs here.

This is an `httpx.MockTransport` rather than a fake `CalleTransport`, which matters: the
real client still builds the request, pins the origin, sends the idempotency header, polls
to a terminal state and maps errors. Only the wire is replaced, so there is no second code
path to drift out of sync with the one that dials.

Every scripted answer is invented for this file. The numbers are NANP 555-01xx, reserved
for fiction, and the pharmacy names are made up.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

import httpx

SIMULATED_POLL_SECONDS = 0.01
"""No network sits behind the simulated wire, so nothing is gained by waiting between
polls. The loop still runs twice; it just does not sleep through it."""

SIMULATED_BASE_URL = "https://simulator.sticker.invalid"

_CALL_PATH = re.compile(r"^/v1/calls/(?P<call_id>[^/]+)$")


@dataclass
class ScriptedAnswer:
    """What one invented pharmacy says when the agent asks for a price."""

    answered_by: str = "human"
    quote_status: str = "quoted"
    cash_price_usd: str = "unknown"
    quantity_quoted: str = "30"
    requires_prescription_on_file: str = "no"
    is_generic: str = "generic"
    discount_program_mentioned: str = "no"
    notes: str = "Quoted over the phone by the pharmacy counter."
    status: str = "completed"
    task_completed: bool = True
    confidence: float = 0.9

    def structured(self) -> dict:
        return {
            "answered_by": self.answered_by,
            "quote_status": self.quote_status,
            "cash_price_usd": self.cash_price_usd,
            "quantity_quoted": self.quantity_quoted,
            "requires_prescription_on_file": self.requires_prescription_on_file,
            "is_generic": self.is_generic,
            "discount_program_mentioned": self.discount_program_mentioned,
            "notes": self.notes,
        }


# A deliberately awkward default script. Two thirds of these pharmacies give a price and
# the rest do something a real survey has to survive, because a demo where every call
# succeeds teaches the reader nothing about what the report is for.
DEFAULT_SCRIPT: list[ScriptedAnswer] = [
    ScriptedAnswer(cash_price_usd="12.99", notes="Generic, priced for thirty tablets."),
    ScriptedAnswer(cash_price_usd="18.50", notes="Counter quoted it straight away."),
    ScriptedAnswer(
        cash_price_usd="64.00",
        discount_program_mentioned="yes",
        notes="Quoted sixty-four cash, less with their savings club.",
    ),
    ScriptedAnswer(
        quote_status="refused",
        cash_price_usd="unknown",
        requires_prescription_on_file="yes",
        notes="Would not price it without a prescription on file.",
    ),
    ScriptedAnswer(cash_price_usd="9.40", notes="Cheapest of the run."),
    ScriptedAnswer(
        answered_by="voicemail",
        quote_status="unknown",
        cash_price_usd="unknown",
        quantity_quoted="unknown",
        requires_prescription_on_file="unknown",
        is_generic="unknown",
        discount_program_mentioned="unknown",
        notes="Reached an after-hours voicemail box.",
        task_completed=False,
        confidence=0.3,
    ),
    ScriptedAnswer(
        cash_price_usd="147.25",
        quantity_quoted="30",
        notes="Priced well above the rest of the ZIP.",
    ),
    ScriptedAnswer(
        quote_status="not_stocked",
        cash_price_usd="unknown",
        notes="Does not carry this strength.",
    ),
    ScriptedAnswer(cash_price_usd="21.00", notes="Quoted after a transfer to the pharmacist."),
    ScriptedAnswer(
        cash_price_usd="35.75",
        quantity_quoted="90",
        notes="Only prices it in ninety-count bottles.",
    ),
]


class SimulatedCalle:
    """Serves the CALL-E routes Sticker uses, from a script."""

    def __init__(self, script: list[ScriptedAnswer] | None = None) -> None:
        self._script = list(script if script is not None else DEFAULT_SCRIPT)
        self._calls: dict[str, dict] = {}
        self._by_key: dict[str, str] = {}
        self._polls: dict[str, int] = {}
        self._placed = 0

    @property
    def placed(self) -> int:
        """How many distinct calls the script was asked for. Deduped keys do not count."""
        return self._placed

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if "Authorization" not in request.headers:
            return _error(401, "unauthorized", "Missing bearer credentials.")
        if request.method == "POST" and request.url.path == "/v1/calls":
            return self._create(request)
        match = _CALL_PATH.match(request.url.path)
        if request.method == "GET" and match:
            return self._read(match.group("call_id"))
        return _error(404, "not_found", f"No simulated route for {request.method} {request.url.path}.")

    def _create(self, request: httpx.Request) -> httpx.Response:
        key = request.headers.get("Idempotency-Key", "")
        if key and key in self._by_key:
            # The whole point of the header: the same request never dials twice.
            return httpx.Response(201, json=self._calls[self._by_key[key]])

        body = json.loads(request.content or b"{}")
        answer = self._script[self._placed % len(self._script)]
        self._placed += 1

        call_id = f"call_sim_{self._placed:04d}"
        recipient = (body.get("recipients") or [{}])[0]
        terminal = {
            "id": call_id,
            "object": "call_task",
            "status": answer.status,
            "task": body.get("task", ""),
            "task_completed": answer.task_completed,
            "completion_confidence": {"score": answer.confidence, "label": "simulated"},
            "structured_result": None,
            "summary": answer.notes,
            "evidence": [],
            "metadata": body.get("metadata", {}),
            "failure_code": None,
            "failure_message": None,
            "created_at": "2026-01-01T00:00:00Z",
            "completed_at": "2026-01-01T00:02:00Z",
            "recipients": [
                {
                    "id": f"rcp_sim_{self._placed:04d}",
                    "phones": recipient.get("phones", []),
                    "region": recipient.get("region"),
                    "locale": recipient.get("locale"),
                    "status": "completed" if answer.task_completed else "failed",
                    "structured_result": answer.structured(),
                    "summary": answer.notes,
                    "attempts": [
                        {
                            "id": f"att_sim_{self._placed:04d}",
                            "phone": (recipient.get("phones") or [""])[0],
                            "status": "completed",
                            "started_at": "2026-01-01T00:00:05Z",
                            "completed_at": "2026-01-01T00:02:00Z",
                            "summary": answer.notes,
                            "provider_call_id": None,
                            "transcript_turns": _turns(answer),
                        }
                    ],
                }
            ],
        }
        self._calls[call_id] = terminal
        if key:
            self._by_key[key] = call_id
        return httpx.Response(201, json={**terminal, "status": "queued", "completed_at": None})

    def _read(self, call_id: str) -> httpx.Response:
        call = self._calls.get(call_id)
        if call is None:
            return _error(404, "not_found", f"No simulated call {call_id}.")
        # First read is still in flight, so the polling loop is exercised exactly as it
        # would be against the real API rather than short-circuited.
        self._polls[call_id] = self._polls.get(call_id, 0) + 1
        if self._polls[call_id] < 2:
            return httpx.Response(200, json={**call, "status": "in_progress", "completed_at": None})
        return httpx.Response(200, json=call)


def _turns(answer: ScriptedAnswer) -> list[dict]:
    turns = [
        {
            "offset_seconds": 0,
            "speaker": "bot",
            "text": (
                "Hello, this is an automated AI assistant calling on behalf of a public price "
                "comparison, and this call is recorded."
            ),
        }
    ]
    if answer.answered_by == "voicemail":
        turns.append(
            {"offset_seconds": 4, "speaker": "user", "text": "Please leave a message after the tone."}
        )
        return turns
    turns.append(
        {
            "offset_seconds": 6,
            "speaker": "bot",
            "text": "What is your cash price, without insurance, for thirty tablets?",
        }
    )
    turns.append({"offset_seconds": 14, "speaker": "user", "text": answer.notes})
    return turns


def _error(status: int, code: str, message: str) -> httpx.Response:
    return httpx.Response(status, json={"error": {"code": code, "message": message}})
