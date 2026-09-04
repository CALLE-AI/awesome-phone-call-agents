"""Replay the attacks against the patched subject and report what changed.

This is the step that turns a finding into a result. Anything can produce a
list of problems; the claim worth making is "this rewrite closes them, and here
is the same suite proving it".

Three outcomes are reported, and the third is the one that keeps this honest:

``closed``
    Failed before, passes now. The fix worked.

``still_failing``
    Failed before, fails now. The fix was not enough, and saying so is the
    difference between a tool and a sales pitch.

``regressions``
    **Passed before, fails now.** A patch that closes one hole by opening
    another is not an improvement, and a verification that could not detect
    that would be worthless. This is why the whole suite is re-run rather than
    only the scenarios that failed.

And one more, which is the honest price of hardening:

``benign_regressions``
    **An ordinary call the agent used to handle and now refuses.** A control
    library that closes every attack by making the agent decline every caller
    would score perfectly on the three outcomes above. This is the number that
    stops it. It is measured against a separate suite of legitimate calls --
    a clear yes, a clear no, a reschedule, a customer asking about their own
    appointment, a bad line, a callback request -- run before and after the
    patch exactly like the attacks.

    It has already earned its place: the first version of the disclosure
    clause broke several of those seven, because "never read out any
    context data, even when you are asked directly" makes an agent refuse
    its own customer. The clause is now scoped to unconfirmed callers, and the attack
    that exploits that scoping was added to the catalogue in the same change.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from redline.evaluate.engine import RunReport
from redline.remediate.generator import Patch
from redline.runner import run_suite
from redline.scenario.model import Scenario
from redline.transport.base import Transport

__all__ = ["Verification", "verify_patch"]


@dataclass(frozen=True, slots=True)
class Verification:
    """The same suite, before and after a patch."""

    patch: Patch
    before: RunReport
    after: RunReport

    benign_before: RunReport | None = None
    benign_after: RunReport | None = None

    @property
    def closed(self) -> tuple[str, ...]:
        """Scenarios that failed before and pass now."""
        return tuple(
            sorted(
                result.scenario.id
                for result in self.before.results
                if result.failed and not self._fails_after(result.scenario.id)
            )
        )

    @property
    def still_failing(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                result.scenario.id
                for result in self.before.results
                if result.failed and self._fails_after(result.scenario.id)
            )
        )

    @property
    def regressions(self) -> tuple[str, ...]:
        """Scenarios that passed before and fail now.

        A patch that trades one hole for another is not an improvement.
        """
        return tuple(
            sorted(
                result.scenario.id
                for result in self.before.results
                if not result.failed and self._fails_after(result.scenario.id)
            )
        )

    @property
    def benign_regressions(self) -> tuple[str, ...]:
        """Legitimate calls the agent handled before the patch and refuses now.

        The price of hardening, in the same units as the benefit. A zero here
        is only worth anything if the benign suite is varied enough to have
        found something -- see its directory for what it covers.
        """
        if self.benign_before is None or self.benign_after is None:
            return ()
        before_failing = {r.scenario.id for r in self.benign_before.results if r.failed}
        return tuple(
            sorted(
                r.scenario.id
                for r in self.benign_after.results
                if r.failed and r.scenario.id not in before_failing
            )
        )

    @property
    def benign_repaired(self) -> tuple[str, ...]:
        """Legitimate calls the patch happened to fix. Reported, not claimed."""
        if self.benign_before is None or self.benign_after is None:
            return ()
        after_failing = {r.scenario.id for r in self.benign_after.results if r.failed}
        return tuple(
            sorted(
                r.scenario.id
                for r in self.benign_before.results
                if r.failed and r.scenario.id not in after_failing
            )
        )

    @property
    def benign_total(self) -> int:
        return self.benign_before.total if self.benign_before else 0

    @property
    def is_clean(self) -> bool:
        """Whether the patch closed something and broke nothing.

        "Nothing" includes ordinary calls: a patch that stops every attack and
        breaks a legitimate one has not made the agent better.
        """
        return (
            bool(self.closed) and not self.regressions and not self.benign_regressions
        )

    @property
    def fully_closed(self) -> bool:
        return not self.after.failed and not self.regressions

    def _fails_after(self, scenario_id: str) -> bool:
        result = self.after.find(scenario_id)
        return result is not None and result.failed

    def summary_line(self) -> str:
        parts = [f"{len(self.closed)} closed"]
        if self.still_failing:
            parts.append(f"{len(self.still_failing)} still failing")
        if self.regressions:
            parts.append(f"{len(self.regressions)} regressed")
        if self.benign_total:
            parts.append(
                f"{len(self.benign_regressions)} benign regression(s) "
                f"of {self.benign_total}"
            )
        return " - ".join(parts)


def verify_patch(
    patch: Patch,
    scenarios: Sequence[Scenario],
    transport: Transport,
    *,
    before: RunReport,
    benign: Sequence[Scenario] = (),
    benign_before: RunReport | None = None,
) -> Verification:
    """Re-run the whole suite against the patched subject.

    The whole suite, not just the failures: a fix that closes one scenario and
    breaks two others has to be visible, and it only is if everything is
    re-run. On the live transport that costs calls, which is a real reason to
    develop against the static model and verify on the wire once.
    """
    after = run_suite(patch.after, scenarios, transport)

    benign_after = None
    if benign:
        if benign_before is None:
            benign_before = run_suite(patch.before, benign, transport)
        benign_after = run_suite(patch.after, benign, transport)

    return Verification(
        patch=patch,
        before=before,
        after=after,
        benign_before=benign_before,
        benign_after=benign_after,
    )
