"""Turn one finished call into a verdict a person can act on.

The engine runs a scenario's assertions and then adds the thing an assertion
list cannot say on its own: **which goal defence was missing.** A report that
says "no_canary_leak failed" tells you a test went red. A report that says "the
goal states no scope boundary" tells you what to write, and it is the same fact
the fix generator will act on.

Both come from the same declaration -- ``REQUIRED_DEFENCE`` in
:mod:`redline.scenario.model` -- so the diagnosis and the fix cannot disagree.
"""

from __future__ import annotations

from dataclasses import dataclass

from redline.evaluate.assertions import (
    AssertionContext,
    AssertionOutcome,
    Status,
    run_assertion,
)
from redline.evaluate.data_policy import evaluate_data_policy
from redline.policy import Defence
from redline.scenario.model import Scenario
from redline.subject import SubjectUnderTest
from redline.types import CallRecord, Severity

__all__ = ["RunReport", "ScenarioResult", "evaluate"]


@dataclass(frozen=True, slots=True)
class ScenarioResult:
    """What one scenario found."""

    scenario: Scenario
    record: CallRecord
    outcomes: tuple[AssertionOutcome, ...]

    missing_defences: frozenset[Defence] = frozenset()
    """Defences this scenario probes that the goal does not state.

    Present even when every assertion passed: a goal can survive a scripted
    attack and still be missing the property that would make it survive the
    next one. That is reported as a warning, never as a failure -- claiming a
    pass is a fail would make the tool cry wolf.
    """

    @property
    def status(self) -> Status:
        if any(outcome.failed for outcome in self.outcomes):
            return Status.FAIL
        if all(outcome.status is Status.SKIP for outcome in self.outcomes):
            return Status.SKIP
        return Status.PASS

    @property
    def failed(self) -> bool:
        return self.status is Status.FAIL

    @property
    def failures(self) -> tuple[AssertionOutcome, ...]:
        return tuple(outcome for outcome in self.outcomes if outcome.failed)

    @property
    def severity(self) -> Severity:
        return self.scenario.severity

    @property
    def is_critical_failure(self) -> bool:
        return self.failed and self.scenario.is_critical

    @property
    def highlighted_turns(self) -> tuple[int, ...]:
        """Every transcript index a failure pointed at, in order."""
        indices = {index for outcome in self.failures for index in outcome.turns}
        return tuple(sorted(indices))


def evaluate(
    record: CallRecord,
    scenario: Scenario,
    subject: SubjectUnderTest,
) -> ScenarioResult:
    """Run every assertion the scenario declares, in the order it declares them."""
    outcomes = tuple(
        run_assertion(
            expectation.assertion,
            AssertionContext(
                record=record,
                scenario=scenario,
                subject=subject,
                params=expectation.params,
                because=expectation.because,
            ),
        )
        for expectation in scenario.expectations
    )
    outcomes += evaluate_data_policy(record, scenario, subject)
    return ScenarioResult(
        scenario=scenario,
        record=record,
        outcomes=outcomes,
        missing_defences=frozenset(scenario.required_defences - subject.defences),
    )


@dataclass(frozen=True, slots=True)
class RunReport:
    """Every scenario in one run, and what it adds up to."""

    subject_name: str
    transport: str
    results: tuple[ScenarioResult, ...]
    duration_seconds: float = 0.0
    real_calls_placed: int = 0

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.status is Status.PASS)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.failed)

    @property
    def skipped(self) -> int:
        return sum(1 for r in self.results if r.status is Status.SKIP)

    @property
    def critical_failures(self) -> tuple[ScenarioResult, ...]:
        return tuple(r for r in self.results if r.is_critical_failure)

    @property
    def failures(self) -> tuple[ScenarioResult, ...]:
        """Failures, most severe first, then by scenario id for stable output."""
        return tuple(
            sorted(
                (r for r in self.results if r.failed),
                key=lambda r: (r.severity.rank, r.scenario.id),
            )
        )

    @property
    def missing_defences(self) -> frozenset[Defence]:
        """Every defence any scenario probed that the goal does not state."""
        return (
            frozenset().union(*(r.missing_defences for r in self.results))
            if (self.results)
            else frozenset()
        )

    def by_family(self) -> dict[str, tuple[ScenarioResult, ...]]:
        """Results grouped for the report, in catalogue order.

        Families exist so a reader gets five judgements instead of fifteen line
        items: "weak on false completion" is actionable in a way a flat list is
        not.
        """
        grouped: dict[str, list[ScenarioResult]] = {}
        for result in self.results:
            grouped.setdefault(str(result.scenario.family), []).append(result)
        return {family: tuple(items) for family, items in grouped.items()}

    def find(self, scenario_id: str) -> ScenarioResult | None:
        return next((r for r in self.results if r.scenario.id == scenario_id), None)

    @property
    def exit_code(self) -> int:
        """0 when nothing failed, 1 otherwise.

        Deliberately not "0 unless something critical failed": a suite that
        goes green while a high-severity scenario is red would train people to
        ignore it.
        """
        return 1 if self.failed else 0

    def summary_line(self) -> str:
        critical = len(self.critical_failures)
        parts = [f"{self.passed}/{self.total} passed"]
        if self.failed:
            parts.append(f"{self.failed} failed")
        if critical:
            parts.append(f"{critical} critical")
        if self.skipped:
            parts.append(f"{self.skipped} skipped")
        return " - ".join(parts)
