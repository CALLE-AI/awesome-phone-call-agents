"""Dispatch phone work in waves, and be able to stop.

Three properties of CALL-E shape everything in this file:

1. **There is no cancel endpoint.** Once `POST /v1/calls` is accepted, that call is going
   to happen. The docs say so plainly: "a call that is already in flight may therefore
   continue to completion even when your application no longer needs its result." So
   cancellation cannot mean "stop the calls". It can only mean stop dispatching new ones,
   wait for the ones already out, and report honestly which could not be recalled. That is
   what `cancel()` does, and the report names them.

2. **The docs warn against dispatching everything at once**: "For workflows that need only
   a target number of confirmations, dispatch calls in controlled waves instead of
   starting every call at once." With no cancel endpoint, the concurrency cap is the only
   brake that exists, so it is not a tuning parameter, it is the safety mechanism.

3. **A recipients array of N dials N people.** One request, N billed calls, and no way to
   take them back. So the cap is enforced on people, not on requests.

The submission repository's own PR checklist requires "Recurring workflows include
cancellation behavior", which the platform underneath does not provide. This is where that
requirement is met.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

from .models import (
    FATAL_ERRORS,
    PERMANENT_ERRORS,
    RETRYABLE_ERRORS,
    DispatchReport,
    ItemResult,
    Resolution,
    WorkItem,
    mask,
)
from .validation import assert_supported, problems

log = logging.getLogger("dispatch")

TERMINAL = frozenset({"completed", "failed", "canceled"})


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 30.0

    def delay_for(self, attempt: int) -> float:
        return min(self.base_delay_seconds * (2 ** (attempt - 1)), self.max_delay_seconds)


class Cancelled(Exception):
    pass


class WaveDispatcher:
    """Runs a list of `WorkItem`s through CALL-E under a concurrency cap.

    The dispatcher never decides what a call means. It decides only whether a usable
    answer came back, and routes everything else to a human. That separation is
    deliberate: the model handles the conversation, and every consequential branch is
    taken by code that can be read and tested.
    """

    def __init__(
        self,
        client: Any,
        *,
        task_builder: Callable[[WorkItem], str],
        result_schema: dict[str, Any],
        concurrency: int = 4,
        idempotency_key: Callable[[WorkItem], str] | None = None,
        retry: RetryPolicy | None = None,
        webhook_url: str | None = None,
        poll_interval_seconds: float = 2.0,
        call_timeout_seconds: float = 600.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if concurrency < 1:
            raise ValueError("concurrency must be at least 1.")
        assert_supported(result_schema)

        self._client = client
        self._task_builder = task_builder
        self._schema = result_schema
        self._concurrency = concurrency
        self._idempotency_key = idempotency_key or (lambda item: item.id)
        self._retry = retry or RetryPolicy()
        self._webhook_url = webhook_url
        self._poll_interval = poll_interval_seconds
        self._call_timeout = call_timeout_seconds
        self._sleep = sleep

        self._cancel = threading.Event()
        self._lock = threading.Lock()
        self._dispatched = 0
        self._in_flight: set[str] = set()
        self._fatal: str | None = None

    # -- control ---------------------------------------------------------

    def cancel(self) -> None:
        """Stop dispatching. Calls already accepted by CALL-E cannot be recalled."""
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    # -- the run ---------------------------------------------------------

    def run(self, items: Iterable[WorkItem]) -> DispatchReport:
        items = list(items)
        report = DispatchReport()

        callable_items: list[WorkItem] = []
        for item in items:
            if not item.consented:
                # A person who has not consented is never dialled. This is a gate, not a
                # filter: it comes before dispatch and it cannot be configured off.
                report.results.append(ItemResult(
                    item=item, resolution=Resolution.SKIPPED,
                    reason="no recorded consent to be called",
                ))
            else:
                callable_items.append(item)

        if not callable_items:
            return report

        with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
            futures = {pool.submit(self._handle, item): item for item in callable_items}
            for future, item in futures.items():
                try:
                    report.results.append(future.result())
                except Cancelled:
                    report.results.append(ItemResult(
                        item=item, resolution=Resolution.SKIPPED,
                        reason="cancelled before dispatch",
                    ))
                except Exception as exc:  # noqa: BLE001 - one item must not kill the run
                    log.exception("item %s raised", item.id)
                    report.results.append(ItemResult(
                        item=item, resolution=Resolution.FAILED,
                        reason=f"dispatcher error: {type(exc).__name__}: {exc}",
                    ))

        report.results.sort(key=lambda r: [i.id for i in items].index(r.item.id))
        with self._lock:
            report.cancelled = self._cancel.is_set()
            report.cancelled_after = self._dispatched
            report.not_recallable = sorted(self._in_flight)
            report.fatal_error = self._fatal
        return report

    # -- one item --------------------------------------------------------

    def _handle(self, item: WorkItem) -> ItemResult:
        if self._cancel.is_set() or self._fatal:
            raise Cancelled

        call = self._create_with_retries(item)
        if isinstance(call, ItemResult):      # creation failed permanently
            return call

        call_id = call["id"]
        with self._lock:
            self._dispatched += 1
            self._in_flight.add(call_id)

        try:
            final = self._await_terminal(call_id)
        finally:
            with self._lock:
                self._in_flight.discard(call_id)

        return self._classify(item, final)

    def _create_with_retries(self, item: WorkItem) -> dict[str, Any] | ItemResult:
        from calle import CalleAPIError

        key = self._idempotency_key(item)
        last: str = ""
        for attempt in range(1, self._retry.max_attempts + 1):
            if self._cancel.is_set() or self._fatal:
                raise Cancelled
            try:
                return self._client.calls.create(
                    task=self._task_builder(item),
                    recipients=[item.recipient()],
                    result_schema=self._schema,
                    metadata={"work_item": item.id},
                    webhook_url=self._webhook_url,
                    # The same key every attempt, deliberately. The docs warn against
                    # generating a fresh key per retry: that is how a network blip turns
                    # into two real phone calls to the same person.
                    idempotency_key=key,
                )
            except CalleAPIError as err:
                last = f"{err.code}: {err}"
                if err.code in FATAL_ERRORS:
                    with self._lock:
                        self._fatal = err.code
                    self._cancel.set()
                    return ItemResult(item=item, resolution=Resolution.FAILED,
                                      failure_code=err.code, reason=last)
                if err.code in PERMANENT_ERRORS:
                    return ItemResult(item=item, resolution=Resolution.FAILED,
                                      failure_code=err.code, reason=last)
                if err.code not in RETRYABLE_ERRORS or attempt == self._retry.max_attempts:
                    return ItemResult(item=item, resolution=Resolution.FAILED,
                                      failure_code=err.code, reason=last)
                self._sleep(self._retry.delay_for(attempt))
        return ItemResult(item=item, resolution=Resolution.FAILED, reason=last)

    def _await_terminal(self, call_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self._call_timeout
        while True:
            call = self._client.calls.get(call_id)
            if call.get("status") in TERMINAL:
                return call
            if time.monotonic() > deadline:
                return {**call, "status": "failed", "_timed_out": True}
            self._sleep(self._poll_interval)

    # -- the only place a meaning is assigned ----------------------------

    def _classify(self, item: WorkItem, call: dict[str, Any]) -> ItemResult:
        recipients = call.get("recipients") or [{}]
        recipient = recipients[0]
        attempts = recipient.get("attempts") or []
        tried = tuple(a.get("phone", "") for a in attempts)
        transcript = tuple(attempts[-1].get("transcript_turns", []) if attempts else ())
        base = dict(
            item=item, call_id=call.get("id"), attempts_made=len(attempts),
            numbers_tried=tried, transcript=transcript,
        )

        status = call.get("status")
        if call.get("_timed_out"):
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              reason="the call did not reach a terminal status in time")

        if status in ("failed", "canceled"):
            code = next(
                (a.get("failure_code") for a in reversed(attempts) if a.get("failure_code")),
                None,
            )
            return ItemResult(**base, resolution=Resolution.FAILED, failure_code=code,
                              reason=self._describe_failure(code, tried))

        result = recipient.get("structured_result")
        if result is None:
            # Answered, talked, and still no usable answer. This is the outcome that
            # naive code loses, and it is exactly the one a person has to pick up.
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              reason="the call completed but returned no structured result")

        found = problems(result, self._schema)
        if found:
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              structured_result=result,
                              reason="result did not satisfy the schema: " + "; ".join(found))

        return ItemResult(**base, resolution=Resolution.RESOLVED, structured_result=result,
                          reason="schema-valid answer received")

    @staticmethod
    def _describe_failure(code: str | None, tried: Sequence[str]) -> str:
        where = f" after trying {len(tried)} number(s)" if tried else ""
        if code == "no_answer":
            return f"nobody answered{where}"
        if code == "declined":
            return f"the call was declined{where}"
        if code:
            return f"the call failed with {code}{where}"
        return f"the call failed{where}"


def default_idempotency_key(prefix: str, day: str) -> Callable[[WorkItem], str]:
    """Stable per (item, day), so a retry on any day cannot re-dial a previous day's work.

    Keep the key stable across retries of the same attempt and distinct across runs that
    genuinely should call again. `(student, date)` is the canonical example.
    """
    def key(item: WorkItem) -> str:
        return f"{prefix}:{item.id}:{day}"
    return key


__all__ = [
    "WaveDispatcher", "RetryPolicy", "Cancelled", "default_idempotency_key", "mask",
]
