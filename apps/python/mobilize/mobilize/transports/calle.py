"""Real CALL-E transport, implemented directly against the REST API rather
than the synchronous `calle-ai` SDK.

Why REST instead of the SDK's `create_and_wait`: `create_and_wait` blocks the
calling thread until the call reaches a terminal state, which makes true
concurrent wave dispatch impossible without one thread per call. The REST
API's `create` (non-blocking dispatch) + `get` (poll) pair, called through
`httpx.AsyncClient`, lets many calls run concurrently on one event loop --
which is the entire point of this project. This is the "REST API" surface
named in the integration plan, used because the architecture requires it,
not for coverage's sake.
"""

from __future__ import annotations

import os

import httpx

from mobilize.core.commitment import calibrated_commitment
from mobilize.core.types import Candidate, CallOutcome, CallResult, utcnow
from mobilize.transports.base import MOBILIZE_RESULT_SCHEMA, build_task_prompt

CALLE_BASE_URL = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
TERMINAL_STATUSES = {"completed", "failed", "canceled"}


class CalleTransport:
    def __init__(self, *, api_key: str | None = None, base_url: str = CALLE_BASE_URL, region: str = "US", locale: str = "en-US"):
        self._api_key = api_key or os.environ["CALLE_API_KEY"]
        self._region = region
        self._locale = locale
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            timeout=30.0,
        )
        # candidate_id keyed cache so poll() can attach it back onto the result,
        # since the CALL-E call object itself has no notion of our candidate ids.
        self._candidate_prior: dict[str, float] = {}

    async def dispatch(self, candidate: Candidate, need_label: str, location: str) -> str:
        body = {
            "task": build_task_prompt(need_label, location),
            "recipients": [{"phones": [candidate.phone], "region": self._region, "locale": self._locale}],
            "result_schema": MOBILIZE_RESULT_SCHEMA,
            "metadata": {"candidate_id": candidate.id},
        }
        headers = {"Idempotency-Key": f"mobilize:{candidate.id}:{need_label}"[:255]}
        response = await self._client.post("/v1/calls", json=body, headers=headers)
        response.raise_for_status()
        payload = response.json()
        self._candidate_prior[payload["id"]] = candidate.historical_showup_rate
        return payload["id"]

    async def poll(self, call_id: str) -> CallResult | None:
        response = await self._client.get(f"/v1/calls/{call_id}")
        response.raise_for_status()
        call = response.json()

        if call.get("status") not in TERMINAL_STATUSES:
            return None

        return _to_call_result(call_id, call, self._candidate_prior.get(call_id, 0.5))

    async def aclose(self) -> None:
        await self._client.aclose()


def _to_call_result(call_id: str, call: dict, prior_showup_rate: float) -> CallResult:
    recipients = call.get("recipients") or []
    recipient = recipients[0] if recipients else {}
    structured = recipient.get("structured_result") or call.get("structured_result") or {}
    candidate_id = (call.get("metadata") or {}).get("candidate_id", "unknown")

    attempts = recipient.get("attempts") or []
    transcript: list[dict] = []
    for attempt in attempts:
        transcript.extend(attempt.get("transcript_turns") or [])

    can_come = structured.get("can_come", "unknown")
    evidence = structured.get("evidence_summary", "") or (call.get("summary") or "")

    if call.get("status") == "failed" or recipient.get("status") == "failed":
        outcome, commitment = CallOutcome.NO_ANSWER, 0.0
    elif can_come == "no":
        outcome, commitment = CallOutcome.NO, 0.0
    elif can_come == "yes":
        commitment = calibrated_commitment(evidence=evidence, candidate_prior_showup_rate=prior_showup_rate)
        outcome = CallOutcome.FIRM_YES if commitment >= 0.6 else CallOutcome.SOFT_YES
    else:
        outcome, commitment = CallOutcome.NO_ANSWER, 0.0

    return CallResult(
        call_id=call_id,
        candidate_id=candidate_id,
        outcome=outcome,
        commitment_score=commitment,
        stated_yes=(can_come == "yes"),
        evidence=evidence,
        transcript=transcript,
        completed_at=utcnow(),
        raw=call,
    )
