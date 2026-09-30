"""The CALL-E transport.

Written against the REST API rather than the SDK's `create_and_wait`, for the same
reason `mobilize` gives: `create_and_wait` blocks a thread until the call reaches a
terminal state, and a price survey is many calls whose whole point is that they overlap.
`create` (non-blocking) plus `get` (poll) on one event loop is what makes a survey take
minutes instead of an afternoon.

One call task carries one pharmacy. Batching several recipients into a single task would
be fewer HTTP requests, but it merges their fates: one bad number, and the shape of the
partial result changes for every pharmacy in the batch. A survey needs each pharmacy to
succeed or fail on its own.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from .safety import assert_approved_origin, mask, mask_deep, validate_e164

DEFAULT_BASE_URL = "https://api.heycall-e.com"

TERMINAL = frozenset({"completed", "failed", "canceled", "cancelled"})
IN_FLIGHT = frozenset({"queued", "in_progress"})

POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 900.0


class CalleError(RuntimeError):
    """A refused request. The provider said no, and that is a fact we can act on."""


class CalleBusy(RuntimeError):
    """The account's concurrent-call limit was hit, so this call was NOT placed.

    Distinct from both a refusal and an ambiguity. CALL-E answers `HTTP 429
    account_concurrency_exceeded` when more calls are in flight than the account's shared
    line allows, and that answer is definite: nothing was dialled. It is therefore the one
    error in this module that is safe to retry, and the survey backs off and tries again
    rather than dropping the pharmacy.

    The cap itself is not documented and not exposed on the API, so an app cannot size its
    own waves in advance. Discovering it costs a rejected request rather than a call.
    """


class CalleAmbiguous(RuntimeError):
    """We do not know whether a call was placed.

    A rejected request is a fact. A timeout or a dropped connection is not: the call may
    be ringing a real pharmacy right now. Nothing retries on this. The run halts and asks
    a human to reconcile, because the alternative is dialling a shop twice.
    """


@dataclass
class CallOutcome:
    """One pharmacy's answer, already masked and safe to print."""

    call_id: str
    status: str
    task_completed: bool | None
    confidence: float | None
    structured: dict[str, Any] = field(default_factory=dict)
    transcript: list[tuple[str, str]] = field(default_factory=list)
    failure_code: str | None = None
    provider_summary: str | None = None

    @property
    def is_terminal_success(self) -> bool:
        """A finished call is not an answered question. CALL-E reports these separately.

        A call to a voicemail box comes back `completed` with `task_completed: true`, so
        neither field alone means a human said a price. The survey checks the structured
        answer too, and this property is only the first of those gates.
        """
        return self.status == "completed" and self.task_completed is True


def derive_run_id(
    *, drug: str, postal_code: str, phones: list[str], caller_org: str, day: str
) -> str:
    """A run identifier derived from what the run *is*, not from when it started.

    This is what makes restart deduplication real. A random per-process id would change
    the idempotency key on every restart, so a crash followed by a rerun would dial every
    pharmacy a second time, which is the exact outcome the key exists to prevent.

    The calendar day is part of the identity, so re-surveying the same list tomorrow is a
    genuinely new set of calls while a restart within the day is the same one. To repeat a
    survey deliberately on the same day, pass an explicit `run_id` and choose a new value.
    """
    payload = json.dumps(
        {
            "drug": drug,
            "zip": postal_code,
            "phones": sorted(phones),
            "org": caller_org,
            "day": day,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def idempotency_key(*, run_id: str, phone: str, task: str, schema: dict) -> str:
    """A key bound to the content of the request, never to the attempt.

    Given a stable `run_id` from `derive_run_id`, a crash and a restart produce the same
    key, and CALL-E returns the existing call instead of dialling a second time.
    """
    payload = json.dumps(
        {"run": run_id, "phone": phone, "task": task, "schema": schema},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
    return f"sticker:{run_id}:{digest}"[:255]


class CalleTransport:
    """Speaks to CALL-E. The only module in Sticker that holds the API key."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
        poll_interval: float = POLL_INTERVAL_SECONDS,
    ) -> None:
        # Kept on the transport so a simulated wire can poll fast while still walking the
        # real polling loop, rather than the loop being short-circuited in tests.
        self._poll_interval = poll_interval
        # Approve the origin BEFORE the key is put in a header, so a hostile override
        # never gets to see it. Redirects are off: urllib and httpx both re-send the
        # Authorization header across a cross-host 302.
        origin = assert_approved_origin(base_url) if transport is None else base_url
        self._client = httpx.AsyncClient(
            base_url=origin,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=timeout,
            follow_redirects=False,
            transport=transport,
        )

    async def __aenter__(self) -> "CalleTransport":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def create(
        self,
        *,
        phone: str,
        task: str,
        recipient_schema: dict,
        metadata: dict,
        idem_key: str,
        region: str = "US",
        locale: str = "en-US",
    ) -> str:
        """Place one call. Returns the call id, or halts ambiguously."""
        validate_e164(phone)
        body = {
            "task": task,
            "recipients": [{"phones": [phone], "region": region, "locale": locale}],
            "recipient_result_schema": recipient_schema,
            "metadata": metadata,
        }
        try:
            response = await self._client.post(
                "/v1/calls", json=body, headers={"Idempotency-Key": idem_key}
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise CalleAmbiguous(
                f"No answer from CALL-E creating the call to {mask(phone)}. The call may "
                f"already be ringing. Reconcile before running again: {type(exc).__name__}."
            ) from exc

        # A 5xx is not a refusal. The request reached CALL-E and failed somewhere inside
        # it, which means the call may already have been created and may already be
        # ringing. Only a 4xx is the provider definitely saying no.
        if response.status_code >= 500:
            raise CalleAmbiguous(
                f"CALL-E returned HTTP {response.status_code} creating the call to "
                f"{mask(phone)}. The request was accepted by the server and failed inside "
                "it, so the call may already be ringing. Reconcile before running again."
            )
        # Backpressure, not refusal. The account's concurrent-call limit was reached and
        # nothing was dialled, so the caller may wait and try this same number again.
        if response.status_code == 429:
            raise CalleBusy(
                f"CALL-E is at the account's concurrent-call limit, so the call to "
                f"{mask(phone)} was not placed: {mask_deep(_body_excerpt(response))}"
            )
        if response.status_code >= 400:
            raise CalleError(
                f"CALL-E refused the call to {mask(phone)}: HTTP {response.status_code} "
                f"{mask_deep(_body_excerpt(response))}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise CalleAmbiguous(
                f"CALL-E accepted the call to {mask(phone)} but returned a body we could "
                "not read, so we cannot tell whether a call id was issued."
            ) from exc
        if not isinstance(payload, dict):
            raise CalleAmbiguous(
                f"CALL-E accepted the call to {mask(phone)} and returned "
                f"{type(payload).__name__} instead of an object."
            )
        call_id = str(payload.get("id") or "")
        if not call_id:
            raise CalleAmbiguous("CALL-E accepted the request but returned no call id.")
        return call_id

    async def get(self, call_id: str) -> dict[str, Any]:
        try:
            response = await self._client.get(f"/v1/calls/{call_id}")
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise CalleAmbiguous(f"Could not read call {call_id}: {type(exc).__name__}.") from exc
        if response.status_code >= 500:
            raise CalleAmbiguous(
                f"CALL-E returned HTTP {response.status_code} reading call {call_id}, so "
                "its state is unknown."
            )
        if response.status_code >= 400:
            raise CalleError(
                f"CALL-E rejected the read of {call_id}: HTTP {response.status_code}."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise CalleAmbiguous(f"Call {call_id} returned a body we could not read.") from exc
        if not isinstance(payload, dict):
            raise CalleAmbiguous(
                f"Call {call_id} returned {type(payload).__name__} instead of an object."
            )
        return payload

    async def wait(
        self,
        call_id: str,
        *,
        interval: float | None = None,
        timeout: float = POLL_TIMEOUT_SECONDS,
    ) -> CallOutcome:
        """Poll until the call reaches a terminal state.

        Every failure in here is ambiguous rather than refused, because by this point the
        call has been created: losing sight of it does not mean it did not happen.
        """
        interval = self._poll_interval if interval is None else interval
        waited = 0.0
        while True:
            try:
                payload = await self.get(call_id)
            except CalleError as exc:
                raise CalleAmbiguous(
                    f"Lost sight of call {call_id} while it was in flight: {exc}"
                ) from exc
            status = str(payload.get("status") or "")
            if status in TERMINAL:
                return _to_outcome(call_id, payload)
            if status not in IN_FLIGHT:
                raise CalleAmbiguous(
                    f"Call {call_id} reported a status we do not recognise, {status!r}. "
                    "We cannot tell whether it is still on a line."
                )
            if waited >= timeout:
                raise CalleAmbiguous(
                    f"Call {call_id} was still {status} after {int(timeout)}s. It is not "
                    "safe to assume it did not happen."
                )
            await asyncio.sleep(interval)
            waited += interval


def _body_excerpt(response: httpx.Response, limit: int = 300) -> str:
    try:
        return json.dumps(response.json())[:limit]
    except Exception:
        return response.text[:limit]


def _to_outcome(call_id: str, payload: dict[str, Any]) -> CallOutcome:
    recipients = payload.get("recipients") or []
    recipient = recipients[0] if recipients else {}

    structured = recipient.get("structured_result") or payload.get("structured_result") or {}

    transcript: list[tuple[str, str]] = []
    for attempt in recipient.get("attempts") or []:
        for turn in attempt.get("transcript_turns") or []:
            transcript.append((str(turn.get("speaker") or "unknown"), str(turn.get("text") or "")))

    confidence = None
    raw_confidence = payload.get("completion_confidence") or {}
    if isinstance(raw_confidence, dict) and raw_confidence.get("score") is not None:
        confidence = float(raw_confidence["score"])

    return CallOutcome(
        call_id=call_id,
        status=str(payload.get("status") or ""),
        task_completed=payload.get("task_completed"),
        confidence=confidence,
        structured=mask_deep(structured) if isinstance(structured, dict) else {},
        transcript=[(s, mask_deep(t)) for s, t in transcript],
        failure_code=payload.get("failure_code"),
        provider_summary=mask_deep(payload.get("summary")) if payload.get("summary") else None,
    )
