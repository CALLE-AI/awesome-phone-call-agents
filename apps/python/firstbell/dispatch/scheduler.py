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
            if item.held_reason:
                # Another absence on this telephone number is being called this run. First
                # in the chain because it is the only one of these that says nothing about
                # the family: they consented, the phone reaches them, and the reason this
                # row is not a call is that the same call is already being placed. Filing
                # it under consent or reachability would report a fact about a household
                # that is not true of it.
                report.results.append(ItemResult(
                    item=item, resolution=Resolution.SKIPPED, reason=item.held_reason,
                ))
            elif item.consent_refusal:
                # A dated record that does not cover this call. Checked before the boolean
                # because it is the more specific statement: a row carrying a record that
                # was withdrawn last week has a `consent` column that still says yes, and
                # reading the weaker of two answers is how a family that asked not to be
                # called gets called. The reason is the register's own sentence, so the
                # queue says which record and why rather than "no consent".
                report.results.append(ItemResult(
                    item=item, resolution=Resolution.SKIPPED,
                    reason=f"{NO_CONSENT}: {item.consent_refusal}",
                ))
            elif not item.consented:
                # A person who has not consented is never dialled. This is a gate, not a
                # filter: it comes before dispatch and it cannot be configured off.
                report.results.append(ItemResult(
                    item=item, resolution=Resolution.SKIPPED, reason=NO_CONSENT,
                ))
            elif not item.reachable_by_voice:
                # Consent is asked first because a family that never agreed to be called
                # is not owed a call on another channel either. This gate is second and
                # it is the one that leaves work behind: the row is not dialled, is not
                # a failure, and goes to a person.
                report.results.append(ItemResult(
                    item=item, resolution=Resolution.SKIPPED, reason=NO_VOICE_CHANNEL,
                    needs_another_channel=True,
                ))
            else:
                callable_items.append(item)

        if not callable_items:
            return report

        # Anything the service says it created before this moment was not created by this
        # run. That is how an idempotent replay is told apart from a fresh call.
        self._run_started_at = datetime.now(timezone.utc)

        with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
            futures = {pool.submit(self._handle, item): item for item in callable_items}
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
                    log.exception("item %s raised", item.id)
                    report.results.append(ItemResult(
                        item=item, resolution=Resolution.FAILED,
                        reason=f"dispatcher error: {type(exc).__name__}: "
                               f"{redact(str(exc))}",
                    ))

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
        with self._lock:
            self._in_flight.discard(call_id)

        try:
            return self._classify(item, final)
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

    def _create_with_retries(self, item: WorkItem) -> dict[str, Any] | ItemResult:
        from calle import CalleAPIError, CalleConnectionError, CalleTimeoutError

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
                self._api_responded = True
                # redact, not str(err) alone. `invalid_phone` quotes the number it
                # rejected, and this string is stored on the result and printed.
                last = f"{err.code}: {redact(str(err))}"
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
            except (CalleTimeoutError, CalleConnectionError, json.JSONDecodeError) as err:
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
                # `_api_responded` is deliberately not set: nothing answered.
                last = f"{type(err).__name__}: {redact(str(err))}"
                if attempt == self._retry.max_attempts:
                    return ItemResult(
                        item=item, resolution=Resolution.UNDETERMINED,
                        reason="the call may have been placed and the service did not "
                               "answer: " + last)
                # The same key again, which is what makes this safe to repeat: if the
                # first request did land, CALL-E replays it rather than calling twice.
                self._sleep(self._retry.delay_for(attempt))
        return ItemResult(item=item, resolution=Resolution.FAILED, reason=last)

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
            except Exception as exc:  # noqa: BLE001 - the call exists; do not lose it
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

    def _classify(self, item: WorkItem, call: dict[str, Any]) -> ItemResult:
        self._api_responded = True
        recipients = call.get("recipients") or [{}]
        recipient = recipients[0]
        attempts = recipient.get("attempts") or []
        tried = tuple(a.get("phone", "") for a in attempts)
        transcript = tuple(attempts[-1].get("transcript_turns", []) if attempts else ())
        base = dict(
            item=item, call_id=call.get("id"),
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
        if call.get("_timed_out"):
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
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
                              reason=self._describe_failure(code, tried, attempt_code))

        result = self._result_for(call, recipient, len(recipients))
        if result is None:
            # Answered, talked, and still no usable answer. This is the outcome that
            # naive code loses, and it is exactly the one a person has to pick up.
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              reason="the call completed but returned no structured result")

        # Asked once, here, so that every path holding a structured result gets the same
        # answer. A malformed result that still says the serious thing is not less serious
        # for being malformed, and it was the well-formed one that was being closed.
        escalation = self._escalation_for(result)

        found = problems(result, self._schema)
        if found:
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              structured_result=result, escalation=escalation,
                              reason="result did not satisfy the schema: " + "; ".join(found))

        if self._learned_nothing(result):
            return ItemResult(**base, resolution=Resolution.UNDETERMINED,
                              structured_result=result, escalation=escalation,
                              reason="the call completed but every required field came "
                                     "back unknown")

        if escalation is not Escalation.NONE:
            # Schema-valid, and still not ours to close. This is the branch the whole
            # escalation axis exists for: nothing about the data is wrong, and a person
            # still has to see it.
            return ItemResult(**base, resolution=Resolution.RESOLVED,
                              structured_result=result, escalation=escalation,
                              reason=f"schema-valid answer received, escalated as "
                                     f"{escalation.value} and not closed automatically")

        return ItemResult(**base, resolution=Resolution.RESOLVED, structured_result=result,
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
