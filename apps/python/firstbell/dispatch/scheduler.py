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

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

from .models import (
    CANCELLED,
    Escalation,
    FATAL_ERRORS,
    NO_CONSENT,
    NO_VOICE_CHANNEL,
    dial_refusal,
    PERMANENT_ERRORS,
    RETRYABLE_ERRORS,
    DispatchReport,
    ItemResult,
    Resolution,
    WorkItem,
    mask,
    redact,
)
from .validation import assert_supported, problems
from . import trace

log = logging.getLogger("dispatch")

TERMINAL = frozenset({"completed", "failed", "canceled"})


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 30.0

    def __post_init__(self) -> None:
        # `range(1, max_attempts + 1)` is empty at zero, so the create loop never runs and
        # every item comes back FAILED with an empty reason: a run that placed no calls and
        # blamed the families. A policy that dials nobody is a configuration mistake, and
        # it should be one at construction rather than a queue of blank refusals.
        if self.max_attempts < 1:
            raise ValueError(
                f"RetryPolicy(max_attempts={self.max_attempts}) would place no calls at "
                f"all; one attempt is the minimum a policy can describe.")

    def delay_for(self, attempt: int) -> float:
        """Doubling from the base delay, capped. Chosen with no information, on purpose.

        A rate limit is the one error where the platform knows the right answer and the
        caller does not, and `Retry-After` is how it says so. It cannot be honoured here:
        `calle.errors.api_error_from_response` takes a status code and a decoded body, so
        the response headers never enter the function that builds the exception, and
        `CalleRateLimitError` has no field to carry a wait. `call-e-feedback.md` finding 13
        is that, with the two-parameter fix.

        So this backs off blind, which on a real 429 either returns before the window is
        over or waits longer than the platform needed. If the SDK grows the field, read it
        and prefer it over this.
        """
        return min(self.base_delay_seconds * (2 ** (attempt - 1)), self.max_delay_seconds)


class PollFailed(Exception):
    """The call was created and its outcome could not be read back.

    A distinct type because the difference between this and any other exception is the
    difference between a call that was placed and one that was not. Caught generically,
    it reported a billable call as never having happened.
    """

    def __init__(self, call_id: str, why: str) -> None:
        super().__init__(why)
        self.call_id = call_id
        self.why = why


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
        uninformative_values: frozenset[str] = frozenset({"unknown"}),
        escalate: Callable[[dict[str, Any]], Escalation] | None = None,
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
        self._uninformative = frozenset(v.strip().lower() for v in uninformative_values)
        # What counts as too serious to close automatically is a question about absences,
        # or overdue invoices, or whatever this list is; it is not a question about
        # telephony, so this package does not answer it. The default escalates nothing,
        # which keeps every existing caller behaving exactly as it did.
        self._escalate = escalate or (lambda result: Escalation.NONE)
        self._idempotency_key = idempotency_key or (lambda item: item.id)
        self._retry = retry or RetryPolicy()
        # None until a run happens, then True if CALL-E answered anything at all. An
        # error response still counts: a 401 proves the host is there and rejected us.
        # Configuration cannot tell us this, and the field that used to imply it was
        # computed from a base URL alone.
        self._api_responded: bool | None = None
        self._webhook_url = webhook_url
        self._poll_interval = poll_interval_seconds
        self._call_timeout = call_timeout_seconds
        self._sleep = sleep

        self._cancel = threading.Event()
        self._lock = threading.Lock()
        # Status history, which the API does not keep. Inert unless traced.
        self._seen_status = trace.Transitions()
        self._dispatched = 0
        self._in_flight: set[str] = set()
        self._fatal: str | None = None
        # Whether run() has already been called once. Nothing above this line resets
        # between runs, so a second run on the same instance would silently inherit the
        # first run's cancellation, fatal error and dispatch count. See run()'s guard.
        self._has_run = False

    # -- control ---------------------------------------------------------

    def cancel(self) -> None:
        """Stop dispatching. Calls already accepted by CALL-E cannot be recalled."""
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    # -- the run ---------------------------------------------------------

    @staticmethod
    def _assert_unique_ids(items: list[WorkItem]) -> None:
        """Refuse duplicate work-item ids instead of letting them collide silently.

        Two items sharing an id would also share the default idempotency key, so the
        second `calls.create()` would replay the first item's call: no second call
        happens, and whatever the first call's answer was gets reported against the
        second item too. `CsvSource` already refuses duplicate ids on the way in;
        `run()` accepts any `WorkSource`, so the same refusal belongs here rather than
        only in one particular loader.
        """
        seen: set[str] = set()
        dupes: set[str] = set()
        for item in items:
            if item.id in seen:
                dupes.add(item.id)
            seen.add(item.id)
        if dupes:
            raise ValueError(
                f"duplicate work item id(s): {', '.join(sorted(dupes))}. Two items "
                "sharing an id would share a default idempotency key, so the second "
                "call would replay the first and its answer would be attributed to "
                "the wrong item."
            )

    def run(self, items: Iterable[WorkItem]) -> DispatchReport:
        # _cancel, _fatal, _dispatched and _in_flight all belong to one run and none of
        # them is reset afterwards. Resetting them here instead was rejected: a run
        # already in progress can be cancelled from another thread (see
        # test_cancel_stops_new_dispatch_...), and cancel() before the *first* run is
        # also relied on (test_cancelling_before_the_run_dispatches_nothing) to prove a
        # pre-cancelled run dispatches nothing. A reset at the top of run() cannot tell
        # a flag set for "cancel the run about to start" apart from a flag left over
        # from a run that already finished, so it would either break the first case or
        # only move the second case's ambiguity from run one to run two. Nothing in
        # this codebase constructs one WaveDispatcher and calls run() on it twice, so
        # refusing the second call costs nothing and removes the ambiguity outright.
        #
        # Read and set under the lock, not because anything here calls run() from two
        # threads but because a guard that can be passed by two callers at once is not a
        # guard. `self._lock` already exists for the fatal-error flag. No test covers the
        # concurrent case: writing one would mean racing two threads on purpose and
        # asserting on the loser, which is a flaky test about a caller that does not exist.
        with self._lock:
            if self._has_run:
                raise RuntimeError(
                    "WaveDispatcher.run() was already called on this instance. Its "
                    "cancellation, fatal-error and dispatch-count state belongs to that "
                    "run, and none of it is reset, so a second run here would silently "
                    "reuse it. Construct a fresh WaveDispatcher for each run."
                )
            self._has_run = True

        items = list(items)
        self._assert_unique_ids(items)
        report = DispatchReport()
        if self._api_responded is None:
            self._api_responded = False

        callable_items: list[WorkItem] = []
        for item in items:
            # One reading of the four gates, from `dial_refusal`, which the call ceiling in
            # `firstbell/cli.py` also counts with. This loop used to spell the chain out and
            # the ceiling reimplemented two of its four branches, so a file of five rows
            # that places two calls was refused as "this run would phone 4 families" and
            # told the operator to pass `--max-calls 4`, which is twice the spend the flag
            # exists to cap. Each branch's reasoning is in `dial_refusal`, next to the
            # order it depends on.
            #
            # `needs_another_channel` is the one thing the reason string does not carry. It
            # marks the row that is not dialled, is not a failure, and is still owed contact
            # some other way, which is the voice-channel case and only that one: a family
            # who never agreed to be called is not owed a message on another channel either.
            refusal = dial_refusal(item)
            if refusal is None:
                callable_items.append(item)
                continue
            report.results.append(ItemResult(
                item=item, resolution=Resolution.SKIPPED, reason=refusal,
                needs_another_channel=refusal == NO_VOICE_CHANNEL,
            ))

        if not callable_items:
            return report

        # Anything the service says it created before this moment was not created by this
        # run. That is how an idempotent replay is told apart from a fresh call.
        self._run_started_at = datetime.now(timezone.utc)

        with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
            futures = {pool.submit(self._handle, item): item for item in callable_items}
            collected: set[str] = set()
            try:
                for future, item in futures.items():
                    try:
                        report.results.append(future.result())
                    except Cancelled:
                        report.results.append(ItemResult(
                            item=item, resolution=Resolution.SKIPPED, reason=CANCELLED,
                        ))
                    except PollFailed as failure:
                        # Reachable only if a poll failure escapes _handle, which it should
                        # not. Kept because the alternative is the generic catch below
                        # turning a placed call into "the call did not happen".
                        report.results.append(ItemResult(
                            item=item, resolution=Resolution.UNDETERMINED,
                            call_id=failure.call_id,
                            reason=f"the call was placed and its outcome could not be read "
                                   f"back: {redact(failure.why)}",
                        ))
                    except Exception as exc:  # noqa: BLE001 - one item must not kill the run
                        # `log.exception` would attach the traceback, and the exception text
                        # in it is the same string redacted four lines below before it is
                        # allowed into the receipt. A log is not a lesser sink: this package
                        # calls no basicConfig, so a caller that configures logging at all
                        # gets it, and the last-chance handler is where the vendor error
                        # quoting a rejected number arrives. Type and redacted text, no
                        # traceback, and the item id says where to look.
                        log.error("item %s raised %s: %s", item.id,
                                  type(exc).__name__, redact(str(exc)))
                        report.results.append(ItemResult(
                            item=item, resolution=Resolution.FAILED,
                            reason=f"dispatcher error: {type(exc).__name__}: "
                                   f"{redact(str(exc))}",
                        ))
                    collected.add(item.id)
            except KeyboardInterrupt:
                # An operator pressing Ctrl-C means stop telephoning these families.
                #
                # Every future is submitted before the first result is collected, so leaving
                # this block normally runs the executor's own `shutdown(wait=True)`, which
                # has no `cancel_futures` and drains the queue to the end. A probe that
                # interrupted after 2 of 8 creates watched all 8 reach the transport, took
                # two seconds to get control back, and then had no report at all, because
                # the exception left this method before it could return one. So the whole
                # wave went out and nothing recorded that it had.
                #
                # `cancel()` first, so a handler already inside a poll stops rather than
                # waiting out its retry budget. Then cancel what is queued and wait for what
                # is running: a call already accepted by CALL-E cannot be recalled, and its
                # id belongs on the receipt whatever the operator has decided.
                self.cancel()
                report.cancelled = True
                # `cancelled_after` is not set here. It was, as `len(collected)`, and the
                # unconditional assignment below the `with` block overwrote it on every
                # path, so this line had no effect and described a behaviour the code did
                # not have. `_dispatched` is the number the sentence wants anyway: an
                # operator who interrupts wants to know how many calls went out, not how
                # many results had been gathered when the key was pressed.
                pool.shutdown(wait=True, cancel_futures=True)
                for pending, waiting in futures.items():
                    if waiting.id in collected:
                        continue
                    if pending.done() and not pending.cancelled():
                        try:
                            report.results.append(pending.result())
                            collected.add(waiting.id)
                            continue
                        except BaseException:  # noqa: BLE001 - reported as cancelled below
                            pass
                    report.results.append(ItemResult(
                        item=waiting, resolution=Resolution.SKIPPED, reason=CANCELLED,
                    ))
                    collected.add(waiting.id)

        # Built once, not once per result: the old `[i.id for i in items].index(...)`
        # rebuilt and linear-scanned the whole id list for every single result, which
        # is quadratic in the number of items. Ids are already guaranteed unique by
        # _assert_unique_ids above, so this dict has exactly one position per id.
        position = {item.id: i for i, item in enumerate(items)}
        report.results.sort(key=lambda r: position[r.item.id])
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

        call_id = call.get("id")
        if not call_id:
            # A create() response is documented to carry an id; without one there is
            # nothing to poll and nothing to recall this call by. CALL-E still accepted
            # the request, so FAILED would say nobody was reached when the truth is we
            # cannot tell. This used to be `call["id"]`, which raised KeyError here and
            # was caught by run()'s generic handler as a dispatcher error, FAILED, with
            # no id anywhere in the report because none was ever assigned.
            return ItemResult(
                item=item, resolution=Resolution.UNDETERMINED,
                possibly_placed_key=self._idempotency_key(item),
                reason="the call was created and the response carried no id, so its "
                       "outcome could not be read back",
            )
        with self._lock:
            self._dispatched += 1
            self._in_flight.add(call_id)

        try:
            final = self._await_terminal(call_id)
        except PollFailed as failure:
            # Deliberately not discarded from _in_flight. The report's not_recallable list
            # is exactly the channel for a call this run placed and cannot account for,
            # and it is already printed, so a reader sees the id rather than a wrong
            # verdict. Reporting FAILED here would state that no call happened, when one
            # did and will be billed.
            return ItemResult(
                item=item, resolution=Resolution.UNDETERMINED, call_id=call_id,
                placed_by_this_run=self._was_placed_now(call),
                reason=f"the call was placed and its outcome could not be read back: "
                       f"{redact(failure.why)}",
            )
        # Only a call that finished leaves the in-flight set. `_await_terminal` returns
        # a synthetic dict at its deadline rather than raising, so this used to discard the
        # id of a call that was still ringing: `_classify` read `_timed_out` and correctly
        # said undetermined, while `report.not_recallable` came back empty because the id
        # had already gone. A reader was told the call did not reach a terminal status in
        # time and given nothing to reconcile against a bill. That list is exactly the
        # channel for a call this run placed and cannot account for, and this is the most
        # certain case of it: the call is not merely unreadable, it is still live.
        if not final.get("_timed_out"):
            with self._lock:
                self._in_flight.discard(call_id)

        try:
            return self._classify(item, final, placed_id=call_id)
        except Exception as exc:  # noqa: BLE001 - an unexpected shape, not a crash
            # A response shape _classify does not model (recipients as an object or a
            # bare string, attempts as a list of strings, and so on) used to raise out of
            # here after call_id was already discarded from _in_flight above, so it was
            # caught by run()'s generic handler with no id in scope: a placed, completed,
            # billed call was reported FAILED with its id gone from every place that
            # would carry it. The call happened; only the shape was a surprise, so this
            # is the third outcome, and the id survives it.
            return ItemResult(
                item=item, resolution=Resolution.UNDETERMINED, call_id=call_id,
                reason=f"the call completed and its result could not be read: "
                       f"{type(exc).__name__}: {redact(str(exc))}",
            )

    def _verdict(self, item: WorkItem, key: str, unanswered: bool,
                 why: str, code: str | None) -> ItemResult:
        """FAILED, or the third outcome when a request for this row already went missing.

        Every exit from the create loop that is not a call object used to be FAILED, and
        FAILED is a sentence: nobody was reached, nothing will be billed, and the office
        can put the row on tomorrow's list. That sentence is false the moment an earlier
        attempt has gone out and not come back, because that request may have arrived and
        started a telephone ringing.

        The sequence is ordinary rather than exotic. Attempt one times out. Attempt two
        reaches the platform and is refused, most likely with `invalid_phone`, which is a
        permanent error and returns immediately. The row was then reported FAILED with a
        `failure_code` in `NEVER_CARRIED`, so the run told a reader the platform refused
        the call and nothing was carried, about a call that may have been carried and will
        appear on the bill. A later attempt answering does not retract an earlier attempt
        that did not.

        So once placement is unknown it stays unknown, and `possibly_placed_key` travels
        with it: that key is the only handle anybody has to reconcile the row against the
        vendor's own record, and it is what lets a re-run replay the request rather than
        place a second call.

        `failure_code` is deliberately left off this result. `NEVER_CARRIED` is already
        gated on FAILED, so the arithmetic is safe either way, but `cli.py` collects
        `idempotency_conflict` on the code alone and prints "nothing was dialled again"
        about whatever it finds. A definite sentence about an ambiguous row is the defect
        this method exists to stop, and it must not come back through a consumer that
        reads the code without the resolution. The code is in the reason instead, where a
        reader gets it and no branch keys on it.
        """
        if not unanswered:
            return ItemResult(item=item, resolution=Resolution.FAILED,
                              failure_code=code, reason=why)
        return ItemResult(
            item=item, resolution=Resolution.UNDETERMINED, possibly_placed_key=key,
            reason="an earlier request for this row went unanswered and may already have "
                   "placed the call, so this later refusal is not evidence that nobody "
                   f"was rung. Reconcile under idempotency key {key!r}: {why}")

    def _create_with_retries(self, item: WorkItem) -> dict[str, Any] | ItemResult:
        from calle import CalleAPIError, CalleConnectionError, CalleTimeoutError

        key = self._idempotency_key(item)
        last: str = ""
        # Whether a request has already gone out for this item and nothing came back.
        #
        # This is the one bit of state that has to cross the loop boundary. The clause
        # below knows a timeout or an undecodable body means a request may have arrived and
        # started a telephone ringing, and it used to know it only until the loop
        # re-entered: a cancel landing during the backoff raised `Cancelled`, and `run()`
        # printed "cancelled before dispatch" about a request that had been dispatched.
        #
        # It is not an exotic path. A sibling item taking a code in FATAL_ERRORS, of which
        # `insufficient_balance` is the likeliest on a real wave, cancels the run, and the
        # items sleeping in a create backoff are exactly the ones the platform was already
        # slow to answer.
        unanswered = False
        for attempt in range(1, self._retry.max_attempts + 1):
            if self._cancel.is_set() or self._fatal:
                if unanswered:
                    return ItemResult(
                        item=item, resolution=Resolution.UNDETERMINED,
                        possibly_placed_key=key,
                        reason="the run was cancelled while a request that may already "
                               f"have been placed was waiting to be retried, under "
                               f"idempotency key {key!r}, so retrying it later cannot "
                               f"call twice: " + last)
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
                self._api_responded = True
                # redact, not str(err) alone. `invalid_phone` quotes the number it
                # rejected, and this string is stored on the result and printed.
                last = f"{err.code}: {redact(str(err))}"
                if err.code in FATAL_ERRORS:
                    # The run still stops: a fatal code is about the account, not this
                    # row, and the other items must not go out after it. Only the verdict
                    # on this row changes.
                    with self._lock:
                        self._fatal = err.code
                    self._cancel.set()
                    return self._verdict(item, key, unanswered, last, err.code)
                if err.code in PERMANENT_ERRORS:
                    return self._verdict(item, key, unanswered, last, err.code)
                if err.code not in RETRYABLE_ERRORS or attempt == self._retry.max_attempts:
                    return self._verdict(item, key, unanswered, last, err.code)
                self._sleep(self._retry.delay_for(attempt))
            except (CalleTimeoutError, CalleConnectionError,
                    json.JSONDecodeError, UnicodeDecodeError) as err:
                # A timeout is not an answer. These two subclass Exception rather than
                # CalleAPIError, so they used to walk past the branch above into the
                # dispatcher's catch-all and be recorded as FAILED, which reads as "nobody
                # was reached" about a request that may have arrived and started a phone
                # ringing. That is the one thing this program exists not to do, and the
                # read side was fixed for it already.
                #
                # json.JSONDecodeError joins them for the same reason. The SDK calls
                # response.json() unconditionally on any 4xx or 5xx before it can build a
                # CalleAPIError, and a proxy's own error page for a bad gateway or an
                # unavailable upstream is HTML, not JSON. That body never reached CALL-E's
                # own error handling, so it used to escape both except clauses here and be
                # recorded as FAILED after zero retries, for exactly the class of failure
                # a retry exists to absorb. The status code is not recoverable from this
                # exception, so it is treated the same as a timeout rather than guessed at.
                #
                # UnicodeDecodeError is the same defect one layer lower, and this clause
                # named only the JSON one until a reader pointed at it. `response.json()`
                # is `json.loads(self.content)` over raw bytes, so a body that is not valid
                # UTF-8, which is what a proxy in another locale can return, fails before
                # any JSON parsing happens. Both are ValueError subclasses and catching
                # that would be shorter; it would also catch a mistake in the request this
                # code builds and report it as a call that may have been placed, which is
                # the one sentence that must never be printed without cause.
                #
                # `_api_responded` is deliberately not set: nothing answered. And this
                # is where `unanswered` is raised, one line from the comment explaining why
                # it matters, so the two cannot drift apart.
                unanswered = True
                last = f"{type(err).__name__}: {redact(str(err))}"
                # Stop automatic submission at the first unknown outcome. Keep the
                # intent key for an operator's provider-side reconciliation; even a
                # same-key retry is not a substitute for checking the accepted call.
                return ItemResult(
                    item=item, resolution=Resolution.UNDETERMINED,
                    possibly_placed_key=key,
                    reason="the call may have been placed and the service did not "
                           "answer; automatic submission stopped, reconcile before "
                           "any retry: " + last)
        # Unreachable while every branch above returns, and routed through `_verdict`
        # anyway. A loop that falls out of its own bottom is a loop somebody has edited,
        # and the edit must not be the one that reintroduces a definite verdict on a row
        # whose request went missing.
        return self._verdict(item, key, unanswered, last, None)

    def _await_terminal(self, call_id: str) -> dict[str, Any]:
        """Poll until the call reaches a terminal status, retrying a failed read.

        The retry is the point. Creation is already retried, and this was not, so a single
        transient error here discarded an existing call's id and reported it as never
        having happened. The budget is the same `RetryPolicy` creation uses, and a
        successful read resets it, because five failures spread over a long call are not
        the same thing as five in a row.
        """
        deadline = time.monotonic() + self._call_timeout
        consecutive_failures = 0
        while True:
            # No cancellation check here, deliberately. Once a call is accepted the phone
            # is going to ring, and abandoning the poll would leave the run unable to say
            # what happened to a call it placed. Cancelling stops new dispatch; it does
            # not un-ring a phone. `test_cancel_stops_new_dispatch_and_names_what_could_
            # not_be_recalled` fails if this changes.
            try:
                call = self._client.calls.get(call_id)
                # Which statuses this call was seen in, and when. Nothing the API
                # reports: a call object carries a status but no history of the ones it
                # held before. Off unless FIRSTBELL_TRACE is set.
                self._seen_status.saw(call_id, getattr(call, "status", None)
                                      or (call.get("status") if isinstance(call, dict)
                                          else None))
            except Exception as exc:  # noqa: BLE001 - the call exists; do not lose it
                # A fatal code stops the run here, not after three tries.
                #
                # `FATAL_ERRORS` was read in one place, `_create_with_retries`, and
                # `not_found` is in it for a reason that only applies to a read: a call
                # this run created, reported missing. This app passes no goal, so creation
                # cannot return that code, and the path where it does arrive retried it and
                # carried on dispatching. Retrying a code that means the platform has lost
                # a call, or that this client is pointed at the wrong environment, spends
                # the budget in front of a decision a person has to make, and the calls
                # queued behind it are what it costs.
                code = getattr(exc, "code", None)
                if code in FATAL_ERRORS:
                    with self._lock:
                        self._fatal = code
                    self._cancel.set()
                    raise PollFailed(
                        call_id,
                        f"{code}: {redact(str(exc))}. This is a call this run placed, so "
                        f"the run stops rather than dispatching more") from exc
                consecutive_failures += 1
                if (consecutive_failures >= self._retry.max_attempts
                        or time.monotonic() > deadline):
                    raise PollFailed(
                        call_id,
                        f"{consecutive_failures} consecutive read(s) failed, last "
                        f"{type(exc).__name__}: {exc}") from exc
                self._sleep(self._retry.delay_for(consecutive_failures))
                continue
            consecutive_failures = 0
            if call.get("status") in TERMINAL:
                return call
            if time.monotonic() > deadline:
                return {**call, "status": "failed", "_timed_out": True}
            self._sleep(self._poll_interval)

    # -- the only place a meaning is assigned ----------------------------

    def _classify(self, item: WorkItem, call: dict[str, Any],
                  placed_id: str | None = None) -> ItemResult:
        """Read a meaning off a terminal response.

        `placed_id` is the id the create returned, which the caller has and this body may
        not. It used to be taken from the response alone, so a proxy or an off-spec body
        answering a poll without `id` gave a queue row carrying no id, next to a receipt
        naming the call that had been placed. A clerk reading that row does not ring the
        family back. Every response in `evidence/api-shape.json` carries `.id` as a string,
        so it takes a mangled body to reach; the point is that once a call is placed the id
        does not get lost, and this was the only path that could lose it.
        """
        self._api_responded = True
        recipients = call.get("recipients") or [{}]
        recipient = recipients[0]
        attempts = recipient.get("attempts") or []
        tried = tuple(a.get("phone", "") for a in attempts)
        transcript = tuple(attempts[-1].get("transcript_turns", []) if attempts else ())
        base = dict(
            # `placed_id` first. The previous fix reached only the case where the body
            # carries no id; a body carrying a *different* id still won, so the receipt was
            # written under an id this run never placed while the in-flight bookkeeping at
            # `_poll` used the placed one, and the two never disagreed out loud. A clerk
            # ringing that family back reads the receipt. It takes a proxy or an off-spec
            # body to reach, which is the same reachability the docstring already claims.
            item=item, call_id=placed_id or call.get("id"),
            provider_call_id=attempts[-1].get("provider_call_id") if attempts else None,
            attempts_made=len(attempts),
            numbers_tried=tried, transcript=transcript,
            placed_by_this_run=self._was_placed_now(call),
            # Verbatim, and only if the provider sent a string. A queue derives the
            # thirty-minute callback deadline from this, so a value this code made up
            # would be a deadline nobody has to meet.
            completed_at=(call.get("completed_at")
                          if isinstance(call.get("completed_at"), str) else None),
        )

        status = call.get("status")

        # Read the answer and ask the rule about it before any branch on status, not after.
        # A status says whether the platform finished the call. It does not say what the
        # person on the line said, and the two arrive in the same body: a call that
        # connects, talks, and then drops carries a failure status beside a populated
        # result. Filing that on the status alone was silent four times over. It reached
        # neither `escalated` nor `escalated_unresolved`, so it was in no count and in no
        # `--json`; it got no completed_at-derived thirty-minute clock; the receipt recorded
        # `structured_result: null`, leaving the transcript, which is off by default, as the
        # only trace of what the child said; and `needs_human` sorts escalations first, so
        # it sat below every ordinary callback in a queue a clerk works top-down.
        #
        # This is the same argument `_escalation_for` is already commented with one branch
        # further down: a malformed result that still says the serious thing is not less
        # serious for being malformed. A failed one is not either.
        result = self._result_for(call, recipient, len(recipients))
        escalation = (self._escalation_for(result) if result is not None
                      else Escalation.NONE)

        if call.get("_timed_out"):
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              structured_result=result, escalation=escalation,
                              reason="the call did not reach a terminal status in time")

        if status in ("failed", "canceled"):
            # The same response carries two vocabularies. The task level uses a symbolic
            # code (`call_failed`); the attempt level returns a raw SIP status (`603`).
            # A real production failure showed both at once. Prefer the symbolic one and
            # keep the SIP code as the detail, because "603" means nothing to an office
            # administrator reading a queue of unresolved absences.
            attempt_code = next(
                (a.get("failure_code") for a in reversed(attempts) if a.get("failure_code")),
                None,
            )
            code = call.get("failure_code") or attempt_code
            return ItemResult(**base, resolution=Resolution.FAILED, failure_code=code,
                              structured_result=result, escalation=escalation,
                              reason=self._describe_failure(code, tried, attempt_code))

        # Past the status branches, the call completed. Everything below is a conversation
        # that happened, however unusable its answer, which is what `spoke_to_someone`
        # records and what anything dividing by "answered" actually needs. The escalation
        # rule was asked once, above, so that every path holding a structured result gets
        # the same answer: a malformed result that still says the serious thing is not less
        # serious for being malformed, and it was the well-formed one that was being closed.
        if result is None:
            # Answered, talked, and still no usable answer. This is the outcome that
            # naive code loses, and it is exactly the one a person has to pick up.
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              spoke_to_someone=True,
                              reason="the call completed but returned no structured result")

        found = problems(result, self._schema)
        if found:
            # Redacted because `problems()` quotes the value it is complaining about, and
            # these fields are filled from what a person said. A guardian reading out a
            # callback number puts that number in an off-enum value, and this string is
            # written to a receipt and printed. Same rule as `structured_result` beside it,
            # applied to the sentence about it rather than only to it.
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              structured_result=result, escalation=escalation,
                              spoke_to_someone=True,
                              reason=redact("result did not satisfy the schema: "
                                            + "; ".join(found)))

        if self._learned_nothing(result):
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              structured_result=result, escalation=escalation,
                              spoke_to_someone=True,
                              reason="the call completed but every required field came "
                                     "back unknown")

        if escalation is not Escalation.NONE:
            # Schema-valid, and still not ours to close. This is the branch the whole
            # escalation axis exists for: nothing about the data is wrong, and a person
            # still has to see it.
            return ItemResult(**base, resolution=Resolution.RESOLVED,
                              structured_result=result, escalation=escalation,
                              spoke_to_someone=True,
                              reason=f"schema-valid answer received, escalated as "
                                     f"{escalation.value} and not closed automatically")

        return ItemResult(**base, resolution=Resolution.RESOLVED, structured_result=result,
                          spoke_to_someone=True,
                          reason="schema-valid answer received")

    def _escalation_for(self, result: dict[str, Any]) -> Escalation:
        """Never let a caller's rule take down a run.

        A rule that raises is a bug in the caller, and the safe reading of "I could not
        decide whether this is serious" is that it might be. Failing closed here costs a
        clerk one glance; failing open loses the case the rule was written for.
        """
        try:
            decided = self._escalate(result)
        except Exception:
            return Escalation.SAFEGUARDING
        return decided if isinstance(decided, Escalation) else Escalation.NONE

    def _learned_nothing(self, result: dict[str, Any]) -> bool:
        """Schema-valid and useful are not the same thing.

        A production call where the person said "I am at work, I cannot talk now" came
        back with every required field set to "unknown". That satisfies the schema,
        because a well-designed enum offers "unknown" rather than forcing a guess. It also
        closed a record about a child nobody had heard anything about.

        This is the same lie as counting a null result as contacted, wearing a different
        hat, and it is worse because the record looks answered. A row of unknowns is a
        conversation that happened and produced nothing, which is precisely the third
        outcome.

        Only the required fields count. An optional field left unknown is a question that
        was not important enough to ask twice.
        """
        required = self._schema.get("required") or []
        if not required or not self._uninformative:
            return False
        values = [result.get(name) for name in required]
        return all(
            isinstance(v, str) and v.strip().lower() in self._uninformative for v in values
        )

    def _was_placed_now(self, call: dict[str, Any]) -> bool | None:
        """Did this run place this call, or did an idempotency key replay an older one?

        It matters for anything that counts calls, because a replayed call is not billed
        and no phone rang. Reporting it as placed would overstate both the cost and the
        number of people who were actually disturbed.

        Returns None rather than guessing when the response carries no usable timestamp.
        An unknown that is quietly rounded to "placed" is the same class of error this
        whole project exists to avoid.
        """
        started = getattr(self, "_run_started_at", None)
        raw = call.get("created_at")
        if started is None or not raw:
            return None
        try:
            created = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return None
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created > started + timedelta(hours=1):
            # The service's clock is far enough ahead of ours that the comparison means
            # nothing. Say so rather than reading skew as a fresh call.
            return None
        if created < started - timedelta(hours=1):
            # The symmetric case. A clock far enough behind ours is just as
            # uninformative as one far enough ahead, but reading skew in this direction
            # as "definitely a replay" is the worse mistake of the two: it says no
            # phone rang and nothing was billed for a call that this run may well have
            # placed. Unknown costs a little certainty; a wrong "replayed" costs an
            # accurate account of what the run actually did.
            return None
        # One second of slack: the service stamps the call, not our clock.
        return created >= started - timedelta(seconds=1)

    @property
    def api_responded(self) -> bool | None:
        """Did CALL-E answer this run? None before a run, False if nothing came back."""
        return self._api_responded

    @staticmethod
    def _result_for(call: dict[str, Any], recipient: dict[str, Any],
                    recipient_count: int) -> dict[str, Any] | None:
        """Where the answer actually is.

        The API carries `structured_result` in two places: once per recipient, and once
        on the task as "the whole-task result". A real single-recipient call to production
        came back with the per-recipient field null and the task-level field fully
        populated, so code that reads only the recipient concludes the call produced
        nothing and routes a completed conversation to a human. That is a silent false
        negative, and it is the worst kind, because the fallback path is indistinguishable
        from a genuine failure.

        The fallback is deliberately restricted to a single recipient. With a fan-out,
        the task-level result belongs to no particular person, and guessing which one it
        describes would trade a false negative for a false attribution.
        """
        result = recipient.get("structured_result")
        if result is not None or recipient_count != 1:
            return result
        return call.get("structured_result")

    # SIP response codes seen at the attempt level. Written down because a raw number in
    # a queue an administrator has to work through is not a reason, it is a lookup task.
    SIP_REASONS = {
        "486": "the line was busy",
        "480": "the phone was switched off or out of coverage",
        # SIP calls 603 "Decline". Do not repeat that word to an office.
        #
        # A production attempt returned 603 with failure_message "calling task
        # status=DECLINED (Hangup by: user)" and started_at equal to completed_at. The
        # operator holding the phone reported that it rang in full and that they touched
        # nothing. So the platform said the person declined, the timestamps said the call
        # never rang, and the truth was that it rang out unanswered. Three accounts, and
        # only one of them can be checked.
        #
        # What survives all three readings is that nobody was reached, which is also the
        # only part the office can act on. Anything more specific would be a guess dressed
        # up as a record.
        "603": "nobody answered",
        "408": "nobody picked up before the network gave up",
        "487": "the call was cancelled before it was answered",
    }

    @classmethod
    def _describe_failure(cls, code: str | None, tried: Sequence[str],
                          detail: str | None = None) -> str:
        where = f" after trying {len(tried)} number(s)" if tried else ""
        if detail and detail in cls.SIP_REASONS:
            return f"{cls.SIP_REASONS[detail]}{where}"
        if code in cls.SIP_REASONS:
            return f"{cls.SIP_REASONS[code]}{where}"
        if code == "call_failed":
            return f"the call did not connect{where}"
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
    "WaveDispatcher", "RetryPolicy", "Cancelled", "PollFailed",
    "default_idempotency_key", "mask",
]
