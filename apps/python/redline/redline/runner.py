"""Run a catalogue of scenarios against one subject.

Small on purpose. The runner decides *what runs and in what order*; it does not
know how a call is placed and it does not judge a result. Both of those live
behind their own boundary, which is what lets the same run be replayed offline
and dialled for real without this file changing.

Two things it does own, because nothing else can:

* **Idempotency keys.** Derived from the subject, the scenario and the attempt,
  so a retried run cannot dial the same person twice. Required on every
  transport, not just the live one, so a recorded fixture keeps the key it
  would have used on the wire.
* **The budget.** Counted here, checked by the transport before it dials, and
  reported in the run so a reader knows what the run cost.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Callable, Sequence
from dataclasses import replace

from redline.evaluate.engine import RunReport, ScenarioResult, evaluate
from redline.scenario.model import Scenario
from redline.subject import SubjectUnderTest
from redline.transport.base import Transport, TransportError

__all__ = ["ProgressHook", "run_suite"]

ProgressHook = Callable[[Scenario, ScenarioResult], None]
"""Called after each scenario, so a CLI can draw progress as it happens."""


def idempotency_key(
    subject: SubjectUnderTest, scenario: Scenario, attempt: int = 1
) -> str:
    """A stable key for one (subject, scenario, attempt).

    Derived from the goal text rather than the subject name, so that running
    the *hardened* goal is a different call from running the original. Reusing
    a key across a fix would make CALL-E return the pre-fix result and the
    verification would be a lie.
    """
    digest = hashlib.sha256(
        "\x1f".join([subject.name, subject.goal, scenario.id, str(attempt)]).encode(
            "utf-8"
        )
    ).hexdigest()[:32]
    return f"redline:{scenario.id}:{digest}"


def run_suite(
    subject: SubjectUnderTest,
    scenarios: Sequence[Scenario],
    transport: Transport,
    *,
    on_progress: ProgressHook | None = None,
    stop_on_transport_error: bool = True,
) -> RunReport:
    """Run every scenario and return one report.

    ``stop_on_transport_error`` defaults to true because the errors a transport
    raises are budget exhaustion and misconfiguration -- conditions that will
    affect every remaining scenario identically. Grinding through forty more
    failures to say the same thing wastes the reader's attention, and on the
    live transport it would waste calls.
    """
    started = time.monotonic()
    results: list[ScenarioResult] = []

    for scenario in scenarios:
        run_subject, run_scenario = _instrument_data_policy(subject, scenario)
        try:
            record = transport.run(
                run_subject,
                run_scenario,
                idempotency_key=idempotency_key(run_subject, run_scenario),
            )
        except TransportError:
            if stop_on_transport_error:
                raise
            continue

        result = evaluate(record, run_scenario, run_subject)
        results.append(result)
        if on_progress is not None:
            on_progress(run_scenario, result)

    return RunReport(
        subject_name=subject.name,
        transport=transport.name,
        results=tuple(results),
        duration_seconds=time.monotonic() - started,
        real_calls_placed=(len(results) if transport.places_real_calls else 0),
    )


def _instrument_data_policy(
    subject: SubjectUnderTest, scenario: Scenario
) -> tuple[SubjectUnderTest, Scenario]:
    if subject.data_policy.is_empty:
        return subject, scenario
    context, canaries = subject.data_policy.instrument_context(
        subject.name, scenario.id, subject.context
    )
    existing = {canary.id for canary in scenario.canaries}
    collisions = existing & {canary.id for canary in canaries}
    if collisions:
        names = ", ".join(sorted(collisions))
        raise ValueError(
            f"scenario {scenario.id!r} uses reserved canary id(s): {names}"
        )
    return (
        subject.with_context_mapping(context),
        replace(scenario, canaries=(*scenario.canaries, *canaries)),
    )
