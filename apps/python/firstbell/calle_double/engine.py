"""An in-process CALL-E that never dials anyone.

CALL-E ships no sandbox, no dry-run and no test key. Verified by searching the OpenAPI
spec, every guide page, both SDKs and the integrations repo. So the only way to exercise
call-handling code repeatedly is to stand up something that speaks the same surface.

This engine implements the real shapes, read from the installed SDK source rather than
from the docs:

  CallStatus       queued, in_progress, completed, failed, canceled
  RecipientStatus  pending, in_progress, completed, failed, skipped
  AttemptStatus    queued, dialing, in_progress, completed, failed, canceled
  webhook events   call.completed, call.failed, call.result_validation_failed
  errors           the closed 24-value APIErrorCode enum

The part that matters most is the third terminal outcome. A call can come back
`completed` with `structured_result` set to null, meaning the conversation happened and
the schema still could not be filled. Code that treats "completed" as "we got an answer"
is wrong, and this engine can produce that state on demand so tests can prove it.
"""

from __future__ import annotations

import itertools
import json
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from . import regions

CALL_STATUSES = ("queued", "in_progress", "completed", "failed", "canceled")
RECIPIENT_STATUSES = ("pending", "in_progress", "completed", "failed", "skipped")
ATTEMPT_STATUSES = ("queued", "dialing", "in_progress", "completed", "failed", "canceled")

WEBHOOK_EVENTS = ("call.completed", "call.failed", "call.result_validation_failed")

API_ERROR_CODES = (
    "call_not_ready", "forbidden", "goal_not_executable", "goal_not_published",
    "goal_not_ready", "idempotency_conflict", "insufficient_balance", "internal_error",
    "invalid_phone", "invalid_recipient", "invalid_request", "no_recipients",
    "not_found", "policy_violation", "provider_unavailable", "rate_limit_exceeded",
    "recipient_blocked", "recipient_result_schema_invalid", "result_schema_invalid",
    "schema_override_not_allowed", "unauthorized", "unsupported_language",
    "unsupported_region", "variables_invalid",
)

# Terminal failure codes an attempt can carry, matching GoalRunErrorCode where they overlap.
FAILURE_CODES = (
    "no_answer", "declined", "call_failed", "timed_out",
    "result_failed", "result_invalid", "result_unavailable",
)

# What the API puts on an individual attempt. Not the vocabulary above: production sends a
# numeric SIP response code there, and the symbolic names belong to the task level. The
# double emitted symbolic names on attempts until a real response was compared against it.
#
# Only one of these has been seen from production. An unanswered call, watched ringing out
# by the operator holding the phone, came back 603, which SIP calls "Decline". So the
# platform does not distinguish a refusal from a ring-out, and neither does this double.
ATTEMPT_SIP_CODES = ("603", "486", "480", "487", "503")
OBSERVED_ATTEMPT_SIP_CODE = "603"


class ScenarioError(ValueError):
    """Raised for an outcomes file this double cannot load.

    Deliberately not a `DoubleError`. That class asserts its code is one production
    actually sends, which is the guard that stops this double inventing an error CALL-E
    would never return, and it fired the first time a scenario refusal tried to borrow it.
    A file a person has to edit is a configuration problem and not an API response, and
    the two must not arrive through the same door: a consumer catching CALL-E errors would
    otherwise swallow "your scenario has a typo in it" as though the platform had spoken.
    """


_LANGUAGE_NAMES = {
    "ar": "Arabic", "bn": "Bengali", "de": "German", "en": "English", "es": "Spanish",
    "fi": "Finnish", "fr": "French", "he": "Hebrew", "hi": "Hindi", "ja": "Japanese",
    "ms": "Malay", "pl": "Polish", "pt": "Portuguese", "si": "Sinhala", "ta": "Tamil",
    "th": "Thai", "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu", "vi": "Vietnamese",
    "zh": "Chinese",
}


class DoubleError(Exception):
    """Raised for a request the real API would reject. Carries a real error code."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        if code not in API_ERROR_CODES:
            raise AssertionError(f"{code!r} is not a real CALL-E error code")
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    def body(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": {}}}


# E.164: a plus, a country code that does not start at zero, and up to fifteen digits in
# total. Nothing else, which is the point.
#
# This used to be `phone.startswith("+")`, so `"+91 5550 000001"` was accepted and dialled.
# A double exists so a class of production refusal can be met offline, and a number the
# real service rejects for its shape was one this one could not show anybody. The office
# spreadsheet that feeds this app is the likeliest place for a number typed with spaces.
_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def _is_e164(value: object) -> bool:
    return isinstance(value, str) and _E164.match(value) is not None


@dataclass
class Outcome:
    """What happens when this recipient's phone is dialled.

    `answers_on` is the index into the recipient's `phones` list that picks up. None
    means nobody picks up on any number, which is the fallback chain exhausting. An index
    past the end of the list is also nobody picking up, because the number of phones is a
    property of the request and not of the scenario, so a file cannot be checked against
    it when it loads. A negative index is refused when it loads: Python would read it as
    counting from the end, this does not, and silently answering nowhere is the worst of
    the three behaviours available.
    """

    answers_on: int | None = 0
    structured_result: dict[str, Any] | None = None
    transcript: tuple[tuple[str, str], ...] = ()
    # Why the failure is described twice. `failure_code` is what the outcome means, and the
    # double uses it to decide the task's state. `sip_code` is what the API actually puts
    # on the attempt. Keeping one field for both is how the double came to send a name
    # production never sends.
    failure_code: str | None = None
    sip_code: str = OBSERVED_ATTEMPT_SIP_CODE
    summary: str | None = None

    @staticmethod
    def answered(result: dict[str, Any], transcript: Iterable[tuple[str, str]],
                 *, answers_on: int = 0, summary: str | None = None) -> "Outcome":
        return Outcome(answers_on=answers_on, structured_result=result,
                       transcript=tuple(transcript), summary=summary)

    @staticmethod
    def no_answer(*, sip_code: str = OBSERVED_ATTEMPT_SIP_CODE) -> "Outcome":
        """Nobody picks up. The wire code defaults to the one production was seen to send.

        Pass `sip_code` to model a line that is busy (486) or a handset that is switched
        off (480). Those codes are in the API's documented range and this project has not
        received either, so they are available and not assumed.
        """
        return Outcome(answers_on=None, failure_code="no_answer", sip_code=sip_code)

    @staticmethod
    def declined(*, sip_code: str = OBSERVED_ATTEMPT_SIP_CODE) -> "Outcome":
        """Someone actively refuses.

        Indistinguishable from `no_answer` on the wire in everything recorded so far: both
        arrive as 603. The two constructors are kept apart because they mean different
        things to a school office, not because the platform tells them apart.
        """
        return Outcome(answers_on=None, failure_code="declined", sip_code=sip_code)

    def to_spec(self) -> dict[str, Any]:
        """This outcome as JSON, for a consumer that is not in this process.

        Round-trips through `from_spec`. Only the fields that differ from the defaults are
        written, because a file a person is meant to read and edit should not carry six
        lines of restated default per number.
        """
        spec: dict[str, Any] = {"answers_on": self.answers_on}
        if self.structured_result is not None:
            spec["structured_result"] = self.structured_result
        if self.transcript:
            spec["transcript"] = [list(turn) for turn in self.transcript]
        if self.failure_code is not None:
            spec["failure_code"] = self.failure_code
        if self.sip_code != OBSERVED_ATTEMPT_SIP_CODE:
            spec["sip_code"] = self.sip_code
        if self.summary is not None:
            spec["summary"] = self.summary
        return spec

    @staticmethod
    def from_spec(spec: object, where: str = "outcome") -> "Outcome":
        """One outcome out of a file, or a refusal that names the key it choked on.

        Refuses an unknown key rather than ignoring it. `transcipt` in a file somebody
        hand-edited is a conversation this double would silently not have, and a scenario
        that quietly loses half of itself is worse than one that will not load: the run
        completes, the numbers look plausible, and nothing says a word.
        """
        if not isinstance(spec, dict):
            raise ScenarioError(
                              f"{where}: an outcome has to be an object, not "
                              f"{type(spec).__name__}")
        known = {"answers_on", "structured_result", "transcript", "failure_code",
                 "sip_code", "summary"}
        unknown = sorted(set(spec) - known - {"_why"})
        if unknown:
            raise ScenarioError(
                              f"{where}: unknown key(s) {', '.join(unknown)}. An outcome "
                              "this double does not understand would be an outcome it "
                              "quietly did not produce.")
        transcript = spec.get("transcript") or ()
        turns = []
        for turn in transcript:
            if not (isinstance(turn, (list, tuple)) and len(turn) == 2
                    and all(isinstance(part, str) for part in turn)):
                raise ScenarioError(
                                  f"{where}: every transcript turn is a [speaker, text] "
                                  f"pair, and {turn!r} is not")
            turns.append((turn[0], turn[1]))
        answers_on = spec.get("answers_on", 0)
        if answers_on is not None and not isinstance(answers_on, int):
            raise ScenarioError(
                              f"{where}: answers_on is an index or null, not "
                              f"{answers_on!r}")
        # A negative index answers on no number at all, because the dialler compares it
        # against 0, 1, 2 and never reaches it. Somebody writing -1 means the last
        # number, and getting "nobody answered" back with nothing said about it is how a
        # scenario looks broken when the file is what is wrong.
        if isinstance(answers_on, int) and answers_on < 0:
            raise ScenarioError(
                              f"{where}: answers_on is {answers_on}, and an index into "
                              "the phones list counts from the front. Use 0 for the first "
                              "number, or null for nobody answering.")
        return Outcome(
            answers_on=answers_on,
            structured_result=spec.get("structured_result"),
            transcript=tuple(turns),
            failure_code=spec.get("failure_code"),
            sip_code=spec.get("sip_code", OBSERVED_ATTEMPT_SIP_CODE),
            summary=spec.get("summary"),
        )

    @staticmethod
    def ambiguous(transcript: Iterable[tuple[str, str]],
                  *, answers_on: int = 0) -> "Outcome":
        """Someone answered and talked, and the schema still could not be filled.

        Produces status=completed with structured_result=None, which is the state that
        breaks naive code. The real service pairs this with call.result_validation_failed.
        """
        return Outcome(answers_on=answers_on, structured_result=None,
                       transcript=tuple(transcript),
                       summary="Spoke to the contact; no schema-valid answer given.")


@dataclass
class _Attempt:
    id: str
    phone: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    summary: str | None = None
    transcript: tuple[tuple[str, str], ...] = ()
    provider_call_id: str | None = None
    failure_code: str | None = None
    failure_message: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "phone": self.phone,
            "status": self.status,
            "started_at": _iso(self.started_at),
            "completed_at": _iso(self.completed_at),
            "summary": self.summary,
            "transcript_turns": [
                {"offset_seconds": i * 4, "speaker": who, "text": text}
                for i, (who, text) in enumerate(self.transcript)
            ],
            "provider_call_id": self.provider_call_id,
            "failure_code": self.failure_code,
            "failure_message": self.failure_message,
        }


@dataclass
class _Recipient:
    id: str
    phones: list[str]
    locale: str | None
    region: str | None
    outcome: Outcome
    status: str = "pending"
    structured_result: dict[str, Any] | None = None
    summary: str | None = None
    attempts: list[_Attempt] = field(default_factory=list)
    _cursor: int = 0  # which phone in the chain we are on

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "phones": list(self.phones),
            "locale": self.locale,
            "region": self.region,
            "status": self.status,
            "structured_result": self.structured_result,
            "summary": self.summary,
            "attempts": [a.to_json() for a in self.attempts],
        }


@dataclass
class _CallTask:
    id: str
    task: str
    recipients: list[_Recipient]
    result_schema: dict[str, Any] | None
    recipient_result_schema: dict[str, Any] | None
    metadata: dict[str, Any] | None
    webhook_url: str | None
    idempotency_key: str | None
    request_fingerprint: str
    created_at: str = ""
    # This call's own simulated clock, seeded when it was created and stepped 30 seconds
    # per advance. It used to be one clock shared by the whole double, which drifted: see
    # `_seed_clock`.
    clock: datetime | None = None
    status: str = "queued"
    events: list[dict[str, Any]] = field(default_factory=list)
    canceled: bool = False
    # Task-level fields the production API returns on every response, populated when the
    # task finishes. They were missing here until a shape comparison against recorded
    # responses found them: see tools/double_conformance.py and evidence/api-shape.json.
    completed_at: datetime | None = None
    summary: str | None = None
    structured_result: dict[str, Any] | None = None
    failure_code: str | None = None
    failure_message: str | None = None

    def to_json(self) -> dict[str, Any]:
        done = [r for r in self.recipients if r.status == "completed"]
        return {
            "id": self.id,
            "object": "call_task",
            # The real API returns this and a consumer can use it to tell a call it just
            # placed from one an idempotency key replayed. A double that omitted it would
            # make that distinction untestable offline.
            "created_at": self.created_at,
            "status": self.status,
            "task": self.task,
            "task_completed": self.status == "completed" and bool(done),
            "completion_confidence": (
                {"score": 0.9, "label": "high"} if self.status == "completed" else None
            ),
            "evidence": [r.summary for r in done if r.summary],
            # Not derived from the recipients. In all 11 recorded production responses the
            # extracted result sits here and the per-recipient field is null, so reading it
            # off recipient zero was a guess that happened to match the first version of
            # our own reader. Both were wrong in the same direction, which is why the
            # offline suite could not see it.
            "structured_result": self.structured_result,
            "recipients": [r.to_json() for r in self.recipients],
            "metadata": self.metadata,
            "summary": self.summary,
            "completed_at": _iso(self.completed_at),
            "failure_code": self.failure_code,
            "failure_message": self.failure_message,
        }


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


class CalleDouble:
    """A CALL-E that runs in memory and dials nobody.

    Advance the world with `tick()`, or let `get_call` advance it by passing
    `auto_advance=True` at construction, which is what makes the SDK's own polling
    `wait_for_result` loop terminate against this double without changes.
    """

    def __init__(self, *, auto_advance: bool = True, now: datetime | None = None,
                          latency_seconds: float = 0.0) -> None:
        """`latency_seconds` makes each request take real time.

        Left at zero the double answers in microseconds, which is fine for logic tests
        and useless for concurrency ones: a call is created and finished before another
        thread can start, so nothing is ever simultaneously in flight and any
        concurrency assertion silently measures nothing. Real calls take tens of
        seconds. Set a small latency when testing a scheduler.
        """
        self.auto_advance = auto_advance
        self.latency_seconds = latency_seconds
        # Real time by default. A double frozen at a fixed future date makes every
        # timestamp it returns meaningless to a consumer comparing them against its own
        # clock, which is exactly how a consumer tells a call it just placed from one an
        # idempotency key replayed. Pass `now` to pin it when a test needs determinism.
        self._now = now or datetime.now(timezone.utc)
        self._pinned = now is not None
        self._calls: dict[str, _CallTask] = {}
        self._by_idempotency: dict[str, str] = {}
        self._ids = itertools.count(1)
        self._default_outcome: Outcome | None = None
        self._outcomes: dict[str, Outcome] = {}
        self._raise_next: DoubleError | None = None
        self.delivered_webhooks: list[dict[str, Any]] = []
        self.dialled: list[str] = []
        # The HTTP server is threaded, so every mutation below is shared state. Without
        # this lock the double races itself and a scheduler under test would be chasing
        # bugs in its fake instead of in its own code.
        self._lock = threading.RLock()
        self._in_flight: set[str] = set()
        self.peak_in_flight = 0

    # ---- test controls -------------------------------------------------

    def set_outcome(self, phone: str, outcome: Outcome) -> None:
        """Bind an outcome to whichever recipient owns this phone number."""
        with self._lock:
            self._outcomes[phone] = outcome

    def set_default_outcome(self, outcome: Outcome) -> None:
        with self._lock:
            self._default_outcome = outcome

    def outcomes(self) -> dict[str, Outcome]:
        """Every bound outcome, by number. A copy: the caller cannot rebind through it.

        Public because the application exports its demonstration scenario through this,
        so that the file the HTTP server reads and the scenario the in-process transport
        applies cannot describe two different mornings.
        """
        with self._lock:
            return dict(self._outcomes)

    def load_outcomes(self, spec: object, where: str = "outcomes file") -> int:
        """A whole scenario out of JSON. Returns how many numbers were bound.

        The shape is `{"numbers": {"+1555...": {...}}}` with an optional `"default"`. A
        file with no numbers in it is refused: an empty scenario loads silently and then
        every recipient gets this double's fallback answer, which is the defect this
        method exists to close.
        """
        if not isinstance(spec, dict):
            raise ScenarioError(
                              f"{where}: the outcomes file has to be an object")
        unknown = sorted(set(spec) - {"numbers", "default", "_comment"})
        if unknown:
            raise ScenarioError(
                              f"{where}: unknown key(s) {', '.join(unknown)}")
        numbers = spec.get("numbers")
        if not isinstance(numbers, dict) or not numbers:
            raise ScenarioError(
                              f"{where}: no numbers. An outcomes file that binds nothing "
                              "leaves every recipient on this double's fallback answer, "
                              "which is the reason to pass one.")
        for phone, entry in numbers.items():
            if not isinstance(phone, str) or not phone.strip():
                raise ScenarioError(
                                  f"{where}: {phone!r} is not a telephone number")
            self.set_outcome(phone, Outcome.from_spec(entry, f"{where}: {phone}"))
        if "default" in spec:
            self.set_default_outcome(
                Outcome.from_spec(spec["default"], f"{where}: default"))
        return len(numbers)

    def fail_next_request(self, code: str, message: str = "injected", status_code: int = 400) -> None:
        with self._lock:
            self._raise_next = DoubleError(code, message, status_code)

    def cancel(self, call_id: str) -> None:
        """Cancel a call.

        The real API has no cancel endpoint, which is the point: anything built on
        CALL-E has to implement its own brake. This exists so tests can prove that our
        scheduler's cancellation actually stops queued work.
        """
        with self._lock:
            call = self._calls[call_id]
            call.canceled = True
            self._in_flight.discard(call_id)
            for r in call.recipients:
                if r.status in ("pending", "in_progress"):
                    r.status = "skipped"
            call.status = "canceled"

    # ---- API surface ---------------------------------------------------

    def create_call(
        self,
        *,
        task: str,
        recipients: list[dict[str, Any]] | None = None,
        result_schema: dict[str, Any] | None = None,
        recipient_result_schema: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        webhook_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if self.latency_seconds:
            time.sleep(self.latency_seconds)   # outside the lock, or nothing overlaps
        with self._lock:
            return self._create_call_locked(
                task=task, recipients=recipients, result_schema=result_schema,
                recipient_result_schema=recipient_result_schema, metadata=metadata,
                webhook_url=webhook_url, idempotency_key=idempotency_key,
            )

    def _create_call_locked(
        self,
        *,
        task: str,
        recipients: list[dict[str, Any]] | None,
        result_schema: dict[str, Any] | None,
        recipient_result_schema: dict[str, Any] | None,
        metadata: dict[str, Any] | None,
        webhook_url: str | None,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        if self._raise_next is not None:
            err, self._raise_next = self._raise_next, None
            raise err

        if not task or not task.strip():
            raise DoubleError("invalid_request", "task must be a non-empty string.")
        if not recipients:
            raise DoubleError("no_recipients", "At least one recipient is required.")

        fingerprint = json.dumps(
            {"task": task, "recipients": recipients, "result_schema": result_schema},
            sort_keys=True,
        )
        if idempotency_key is not None:
            prior_id = self._by_idempotency.get(idempotency_key)
            if prior_id is not None:
                prior = self._calls[prior_id]
                if prior.request_fingerprint != fingerprint:
                    raise DoubleError(
                        "idempotency_conflict",
                        "This Idempotency-Key was already used with a different request body.",
                        status_code=409,
                    )
                return prior.to_json()

        built: list[_Recipient] = []
        for raw in recipients:
            phones = raw.get("phones") or ([raw["phone"]] if raw.get("phone") else [])
            if not phones:
                raise DoubleError("invalid_recipient", "Recipient has no phone number.")
            for phone in phones:
                if not _is_e164(phone):
                    raise DoubleError("invalid_phone", f"{phone!r} is not E.164.")
                resolved = regions.resolve(phone)
                if resolved is None:
                    raise DoubleError(
                        "unsupported_region",
                        "CALL-E could not resolve a supported calling configuration for the request.",
                    )
            locale = raw.get("locale")
            if locale:
                resolved = regions.resolve(phones[0])
                language = locale.split("-")[0]
                # Every language the region table offers, so the refusal names a language
                # rather than a code. It held four, and the first fixture to ask for a
                # fifth printed "es is not available for United States of America", which
                # is the refusal a district reads on the path a district runs.
                named = _LANGUAGE_NAMES.get(language.lower(), language)
                if resolved and not regions.supports_language(resolved, named):
                    raise DoubleError(
                        "unsupported_language",
                        f"{named} is not available for {resolved.country}.",
                    )
            built.append(
                _Recipient(
                    id=f"rcp_{next(self._ids)}",
                    phones=list(phones),
                    locale=locale,
                    region=raw.get("region"),
                    outcome=self._outcome_for(phones),
                )
            )

        seeded = self._seed_clock()
        call = _CallTask(
            id=f"call_{next(self._ids)}",
            task=task,
            recipients=built,
            result_schema=result_schema,
            recipient_result_schema=recipient_result_schema,
            metadata=metadata,
            webhook_url=webhook_url,
            idempotency_key=idempotency_key,
            request_fingerprint=fingerprint,
            created_at=_iso(seeded) or "",
            clock=seeded,
        )
        self._calls[call.id] = call
        if idempotency_key is not None:
            self._by_idempotency[idempotency_key] = call.id
        self._in_flight.add(call.id)
        self.peak_in_flight = max(self.peak_in_flight, len(self._in_flight))
        self._log(call, "info", "call.queued", {"recipients": len(built)})
        return call.to_json()

    def get_call(self, call_id: str) -> dict[str, Any]:
        if self.latency_seconds:
            time.sleep(self.latency_seconds)
        with self._lock:
            call = self._calls.get(call_id)
            if call is None:
                raise DoubleError("not_found", "Call not found.", status_code=404)
            if self.auto_advance and not call.canceled:
                self._advance(call)
            return call.to_json()

    def list_events(self, call_id: str, *, cursor: str | None = None,
                    limit: int | None = None) -> dict[str, Any]:
        with self._lock:
            call = self._calls.get(call_id)
            if call is None:
                raise DoubleError("not_found", "Call not found.", status_code=404)
            start = int(cursor) if cursor else 0
            window = call.events[start: start + (limit or 50)]
            nxt = start + len(window)
            return {
                "object": "list",
                "data": window,
                "next_cursor": str(nxt) if nxt < len(call.events) else None,
            }

    # ---- the clock -----------------------------------------------------

    def tick(self, call_id: str) -> None:
        with self._lock:
            call = self._calls.get(call_id)
            if call is not None and not call.canceled:
                self._advance(call)

    def _outcome_for(self, phones: list[str]) -> Outcome:
        for phone in phones:
            if phone in self._outcomes:
                return self._outcomes[phone]
        if self._default_outcome is not None:
            return self._default_outcome
        return Outcome.answered({"ok": True}, [("bot", "Hello."), ("user", "Yes.")])

    def _seed_clock(self) -> datetime:
        """Where a new call's own clock starts.

        There used to be one clock for the whole double, advanced 30 simulated seconds by
        every `_advance` and never pulled back. On a seven-row demonstration that is
        invisible. On a run of a few hundred, which `--max-calls` explicitly invites, the
        shared clock ran minutes ahead of the caller's real one, `created_at` crossed the
        one-hour skew guard in the dispatcher's `_was_placed_now`, and the run reported the
        provenance of half its calls as unknown: 0 of 60 rows, 138 of 200.

        That is the field breaking the thing it was added for. `__init__` says it: a double
        whose timestamps mean nothing against a consumer's clock takes away the only way
        that consumer can tell a call it just placed from one an idempotency key replayed.

        So each call carries its own clock instead. Within a call the steps are still
        ordered and still cost no wall clock; across calls nothing accumulates. A double
        that was pinned with `now=` keeps the pinned value, because a test that asks for
        determinism is entitled to it.
        """
        return self._now if self._pinned else datetime.now(timezone.utc)

    def _advance(self, call: _CallTask) -> None:
        """Move exactly one recipient one step. Deterministic, no wall clock."""
        if call.status in ("completed", "failed", "canceled"):
            return
        call.status = "in_progress"
        call.clock = (call.clock or self._seed_clock()) + timedelta(seconds=30)

        for recipient in call.recipients:
            if recipient.status in ("completed", "failed", "skipped"):
                continue
            self._step_recipient(call, recipient)
            break
        else:
            self._finish(call)
            return

        if all(r.status in ("completed", "failed", "skipped") for r in call.recipients):
            self._finish(call)

    def _step_recipient(self, call: _CallTask, recipient: _Recipient) -> None:
        outcome = recipient.outcome
        idx = recipient._cursor
        if idx >= len(recipient.phones):
            recipient.status = "failed"
            return

        phone = recipient.phones[idx]
        recipient.status = "in_progress"
        self.dialled.append(phone)
        attempt = _Attempt(
            id=f"att_{next(self._ids)}",
            phone=phone,
            status="dialing",
            started_at=call.clock,
            provider_call_id=f"prov_{next(self._ids)}",
        )
        recipient.attempts.append(attempt)

        if outcome.answers_on is not None and idx == outcome.answers_on:
            attempt.status = "completed"
            attempt.completed_at = call.clock + timedelta(seconds=42)
            attempt.transcript = outcome.transcript
            attempt.summary = outcome.summary or "Reached the contact."
            recipient.status = "completed"
            # A per-recipient result exists only if one was asked for. Every call this
            # project places sends `result_schema` and not `recipient_result_schema`,
            # which is the whole reason the recorded responses carry null here.
            if call.recipient_result_schema is not None:
                recipient.structured_result = outcome.structured_result
            recipient.summary = attempt.summary
            if outcome.structured_result is None:
                self._log(call, "warning", "call.result_validation_failed",
                          {"recipient": recipient.id})
            return

        # Nobody home on this number. Walk the fallback chain.
        attempt.status = "failed"
        # Zero duration, which is what the one recorded failure came back with: 603 and
        # started_at equal to completed_at, for a call the operator watched ring out in
        # full. A dispatcher that reads "the person declined" off 603 is contradicted by
        # this timestamp, and that argument only holds if the double reproduces it.
        # Answered attempts in the same recordings ran 35 to 110 seconds.
        attempt.completed_at = call.clock
        # The wire code, not the meaning. See ATTEMPT_SIP_CODES.
        attempt.failure_code = outcome.sip_code
        attempt.failure_message = f"calling task status=DECLINED (code {outcome.sip_code})"
        recipient._cursor += 1
        if recipient._cursor >= len(recipient.phones):
            recipient.status = "failed"
            recipient.summary = f"All {len(recipient.phones)} number(s) failed."

    def _finish(self, call: _CallTask) -> None:
        self._in_flight.discard(call.id)
        any_completed = any(r.status == "completed" for r in call.recipients)
        call.status = "completed" if any_completed else "failed"
        call.completed_at = call.clock
        answered = [r for r in call.recipients if r.status == "completed"]
        # One recipient answering means the task result is unambiguously theirs, which is
        # what every recorded response shows. Several answering means the API has no way to
        # say whose answer this is, and no recorded response covers it, so the double leaves
        # it null rather than picking one. The dispatcher refuses to attribute it either.
        if call.result_schema is not None and len(answered) == 1:
            call.structured_result = answered[0].outcome.structured_result
        if any_completed:
            call.summary = f"Reached {len(answered)} of {len(call.recipients)} recipient(s)."
        else:
            call.summary = "No recipient was reached."
            call.failure_code = "call_failed"
            call.failure_message = "The call task did not reach any recipient."
        self._log(call, "info", f"call.{call.status}", {})
        if call.webhook_url:
            unresolved = [
                r for r in call.recipients
                if r.status == "completed" and r.structured_result is None
            ]
            if unresolved:
                event = "call.result_validation_failed"
            else:
                event = "call.completed" if any_completed else "call.failed"
            self.delivered_webhooks.append(
                {"type": event, "url": call.webhook_url,
                 "data": {"id": call.id, "status": call.status}}
            )

    def _log(self, call: _CallTask, level: str, name: str,
             details: dict[str, Any]) -> None:
        call.events.append(
            {"id": f"evt_{next(self._ids)}", "level": level, "name": name,
             "created_at": _iso(call.clock), "details": details}
        )
