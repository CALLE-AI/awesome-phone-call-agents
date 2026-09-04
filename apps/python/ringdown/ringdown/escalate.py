from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Literal, Sequence

from ringdown.calle import CalleError, RestClient
from ringdown.calls import CallSnapshot
from ringdown.dispositions import Verdict, classify, ground
from ringdown.extract import Extraction, extract, instructed
from ringdown.incident import Incident, Rung
from ringdown.script import attempt_id, call_payload, idempotency_key

LadderVerdict = Literal["acknowledged", "declined", "unacknowledged", "unknown"]


@dataclass(frozen=True)
class Attempt:
    rung: Rung
    key: str
    attempt_id: str
    verdict: Verdict
    reason: str
    call_id: str | None = None
    snapshot: CallSnapshot | None = None
    extraction: Extraction | None = None
    instructed: bool = False

    def __post_init__(self) -> None:
        if (
            self.call_id is not None
            and self.verdict != "unknown"
            and (self.snapshot is None or self.extraction is None)
        ):
            raise ValueError(
                f"attempt {self.attempt_id} settled {self.verdict} "
                f"for call {self.call_id} without a snapshot and extraction"
            )


@dataclass(frozen=True)
class LadderResult:
    verdict: LadderVerdict
    attempts: tuple[Attempt, ...]

    @property
    def deciding(self) -> Attempt | None:
        return self.attempts[-1] if self.attempts else None

    @property
    def placed(self) -> int:
        return sum(1 for attempt in self.attempts if attempt.call_id)

    @property
    def live_call_id(self) -> str | None:
        return self.deciding.call_id if self.deciding else None


def place_and_settle(
    rest: RestClient,
    incident: Incident,
    rung: Rung,
    log: Callable[[str], None] = lambda _: None,
    announce: Callable[[str, str, Rung], None] = lambda *_: None,
) -> Attempt:
    payload = call_payload(incident, rung)
    key = idempotency_key(payload)
    aid = attempt_id(incident, rung)
    log(f"idempotency key {key}")
    announce(aid, key, rung)
    try:
        created = rest.create_call(payload, key)
    except CalleError as error:
        if not error.may_have_landed:
            return Attempt(
                rung=rung, key=key, attempt_id=aid, verdict="not_acknowledged", reason=error.code
            )
        log(f"CALL-E returned {error.code} without saying whether the call exists.")
        if not error.retriable:
            log("A call may be live for this person.")
            return Attempt(rung=rung, key=key, attempt_id=aid, verdict="unknown", reason=error.code)
        log(f"Reconciling {key}.")
        try:
            created = rest.create_call(payload, key)
        except CalleError as replay:
            log(f"Reconciling {key} failed with {replay.code}.")
            log("A call may be live for this person.")
            return Attempt(
                rung=rung, key=key, attempt_id=aid, verdict="unknown", reason=replay.code
            )
        log(f"Reconciled to call {created.id}.")
    policy = incident.policy
    try:
        snapshot = rest.wait_for_result(
            created.id, policy.per_call_timeout_seconds, policy.poll_interval_seconds
        )
    except CalleError as error:
        return Attempt(
            rung=rung,
            key=key,
            attempt_id=aid,
            verdict="unknown",
            reason=error.code,
            call_id=created.id,
        )
    if (
        snapshot.recipient_phone != rung.contact.phone
        or snapshot.metadata.get("ringdown_attempt_id") != aid
    ):
        return Attempt(
            rung=rung,
            key=key,
            attempt_id=aid,
            verdict="unknown",
            reason="call_identity_mismatch",
            call_id=created.id,
        )
    extraction = extract(snapshot.turns)
    judged = classify(
        snapshot, extraction, ground(extraction, snapshot.turns), rung.contact, policy
    )
    return Attempt(
        rung=rung,
        key=key,
        attempt_id=aid,
        verdict=judged.verdict,
        reason=judged.reason,
        call_id=created.id,
        snapshot=snapshot,
        extraction=extraction,
        instructed=instructed(snapshot.turns),
    )


def ladder_verdict(verdicts: Sequence[str]) -> LadderVerdict:
    return next((v for v in verdicts if v != "not_acknowledged"), "unacknowledged")


def run_ladder(
    rest: RestClient,
    incident: Incident,
    rungs: Sequence[Rung],
    log: Callable[[str], None] = lambda _: None,
    watch: Callable[[int, Rung, Attempt | None], None] = lambda *_: None,
    announce: Callable[[str, str, Rung], None] = lambda *_: None,
) -> LadderResult:
    deadline = time.monotonic() + incident.policy.ladder_timeout_seconds
    attempts: list[Attempt] = []
    for position, rung in enumerate(rungs, 1):
        if attempts and time.monotonic() >= deadline:
            log(f"ladder timeout after {len(attempts)} attempt(s)")
            break
        watch(position, rung, None)
        placed = place_and_settle(rest, incident, rung, log=log, announce=announce)
        watch(position, rung, placed)
        attempts.append(placed)
        if placed.verdict != "not_acknowledged":
            break
    return LadderResult(ladder_verdict([a.verdict for a in attempts]), tuple(attempts))
