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
from mobilize.transports.base import (
    MOBILIZE_RESULT_SCHEMA,
    build_task_prompt,
    validate_e164,
    validate_trusted_base_url,
)

CALLE_BASE_URL = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
TERMINAL_STATUSES = {"completed", "failed", "canceled"}


class CalleTransport:
    def __init__(self, *, api_key: str | None = None, base_url: str = CALLE_BASE_URL, region: str = "US", locale: str = "en-US"):
        validate_trusted_base_url(base_url)
        self._api_key = api_key or os.environ["CALLE_API_KEY"]
        self._region = region
        self._locale = locale
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            timeout=30.0,
        )
        # Full candidate, keyed by call_id, so poll() can bind a returned
        # result back to the specific candidate it was dispatched for and
        # refuse to count a confirmation that doesn't match.
        self._candidate_by_call_id: dict[str, Candidate] = {}

    async def dispatch(self, candidate: Candidate, need_label: str, location: str, *, idempotency_key: str) -> str:
        validate_e164(candidate.phone)
        # Per-candidate region/locale override the transport's own default
        # -- a registry with recipients in more than one country cannot be
        # correctly represented by a single fixed region on the transport
        # instance. CALL-E uses this field for routing and compliance
        # checks, so getting it wrong is a real correctness issue, not
        # cosmetic.
        region = candidate.region or self._region
        locale = candidate.locale or self._locale
        body = {
            "task": build_task_prompt(need_label, location),
            "recipients": [{"phones": [candidate.phone], "region": region, "locale": locale}],
            "result_schema": MOBILIZE_RESULT_SCHEMA,
            "metadata": {"candidate_id": candidate.id},
        }
        # Use the ledger's own precomputed key as CALL-E's Idempotency-Key,
        # not an ad hoc one built here. If the process crashes after CALL-E
        # accepts the call but before the ledger write completes, a retry on
        # restart sends this exact same key -- CALL-E returns the original
        # call instead of placing a second one.
        headers = {"Idempotency-Key": idempotency_key[:255]}
        response = await self._client.post("/v1/calls", json=body, headers=headers)
        response.raise_for_status()
        payload = response.json()
        call_id = payload["id"]
        self._candidate_by_call_id[call_id] = candidate
        return call_id

    async def poll(self, call_id: str, *, expected_candidate: Candidate | None = None) -> CallResult | None:
        response = await self._client.get(f"/v1/calls/{call_id}")
        response.raise_for_status()
        call = response.json()

        if call.get("status") not in TERMINAL_STATUSES:
            return None

        # Prefer the caller-supplied candidate (the dispatcher knows who
        # every in-flight call_id belongs to, from the ledger, even after a
        # restart) over this instance's own in-memory cache, which is empty
        # on a fresh CalleTransport following a crash. Falling back to the
        # cache keeps binding validation working for direct callers of this
        # transport that don't pass expected_candidate explicitly.
        candidate = expected_candidate or self._candidate_by_call_id.get(call_id)
        return _to_call_result(call_id, call, candidate)

    async def aclose(self) -> None:
        await self._client.aclose()


def _to_call_result(call_id: str, call: dict, expected_candidate: Candidate | None) -> CallResult:
    recipients = call.get("recipients") or []
    recipient = recipients[0] if recipients else {}
    structured = recipient.get("structured_result") or call.get("structured_result") or {}
    returned_candidate_id = (call.get("metadata") or {}).get("candidate_id", "unknown")

    # Bind the result to the candidate we actually dispatched to before
    # trusting anything it says. Two independent checks: the metadata we
    # attached at dispatch time round-trips, and the phone CALL-E dialed
    # matches the candidate's phone. A mismatch on either means something is
    # wrong upstream (a reused call_id, a metadata bug, a provider mixup) and
    # this result must never silently count as a confirmation.
    mismatch = False
    if expected_candidate is not None:
        if returned_candidate_id != expected_candidate.id:
            mismatch = True
        recipient_phones = recipient.get("phones") or []
        if recipient_phones and expected_candidate.phone not in recipient_phones:
            mismatch = True

    candidate_id = expected_candidate.id if expected_candidate is not None else returned_candidate_id

    if mismatch:
        return CallResult(
            call_id=call_id,
            candidate_id=candidate_id,
            outcome=CallOutcome.FAILED,
            commitment_score=0.0,
            stated_yes=False,
            evidence=(
                f"Result binding mismatch: expected candidate {candidate_id!r}, "
                f"call metadata/phone did not match. Discarded rather than counted."
            ),
            transcript=[],
            completed_at=utcnow(),
            raw=call,
        )

    attempts = recipient.get("attempts") or []
    transcript: list[dict] = []
    for attempt in attempts:
        transcript.extend(attempt.get("transcript_turns") or [])

    can_come = structured.get("can_come", "unknown")
    evidence = structured.get("evidence_summary", "") or (call.get("summary") or "")
    prior_showup_rate = expected_candidate.historical_showup_rate if expected_candidate is not None else 0.5
    # Only "yes" counts as an opt-out request -- "unknown" (e.g. the call
    # didn't connect clearly) must never be treated as a do-not-call signal.
    stop_requested = structured.get("wants_no_further_contact") == "yes"

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
        stop_requested=stop_requested,
        evidence=evidence,
        transcript=transcript,
        completed_at=utcnow(),
        raw=call,
    )
