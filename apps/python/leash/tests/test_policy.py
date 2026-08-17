"""The asymmetry, tested from the side that matters.

Happy-path tests are nearly worthless here. The lease continuing is the rare, narrow
outcome; every interesting case is one where something is wrong and the question is
whether the credential survives it. So almost every test below asserts a RELEASE, and
several assert it under inputs that should never occur -- because "should never occur"
is exactly the assumption that leaves a live credential in the hands of an unattended
agent.

Three of these regressions come from real calls, not from imagination, and they are
marked. Those are the ones worth reading.
"""
import dataclasses
import math

import pytest

from leash import policy
from leash.outcomes import CallOutcome, Turn


JOB = "tidy-0002"


def _keep() -> CallOutcome:
    """The only shape that keeps the lease: every condition holding at once."""
    return CallOutcome(
        call_id="call_keep",
        status="completed",
        task_completed=True,
        confidence_score=0.94,
        confidence_label="high",
        structured_result={
            "job_decision": "continue_job",
            "choice_readback_confirmed": "yes",
            "reason_sentence": "the backup still needs to finish tonight.",
            "spoke_with_person": "yes",
        },
        evidence=(
            "A live person responded during the call.",
            "The person selected continue_job and confirmed that choice.",
            "A one-sentence reason was provided.",
        ),
        turns=(
            Turn(0.0, "bot", "Should the job continue, or should it stop?"),
            Turn(10.0, "user", "continue."),
            Turn(20.0, "user", "yes."),
            Turn(30.0, "user", "the backup still needs to finish tonight."),
        ),
        failure_code=None,
        error_code=None,
        raw={"metadata": {"job_id": JOB}},
        reached_terminal=True,
    )


def _evaluate(outcome, **kw):
    kw.setdefault("expected_job_id", JOB)
    return policy.evaluate(outcome, **kw)


# --------------------------------------------------------------------------------------
# the count, pinned
# --------------------------------------------------------------------------------------

def test_there_are_exactly_twelve_conditions():
    """The README, the PR body and the video all say twelve. This is what stops that
    number from quietly becoming a lie when a condition is added or removed."""
    assert len(policy.CONDITION_NAMES) == 12
    assert len(set(policy.CONDITION_NAMES)) == 12


def test_a_kept_lease_reports_all_twelve_and_no_failures():
    verdict = _evaluate(_keep())
    assert verdict.release is False
    assert verdict.failed == ()
    assert len(verdict.held) == 12


def test_release_is_always_consistent_with_the_failed_list():
    """The invariant an operator reads the log by: if it released, something failed."""
    for outcome in (_keep(), dataclasses.replace(_keep(), status="failed")):
        verdict = _evaluate(outcome)
        assert verdict.release == bool(verdict.failed)


# --------------------------------------------------------------------------------------
# one condition at a time
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "field,value",
    [
        ("reached_terminal", False),
        ("status", "failed"),
        ("status", "canceled"),
        ("task_completed", False),
        ("task_completed", None),
        ("confidence_score", 0.79),
        ("confidence_score", None),
        ("confidence_label", "low"),
        ("structured_result", None),
        ("evidence", ()),
    ],
)
def test_each_single_defect_releases_the_lease(field, value):
    assert _evaluate(dataclasses.replace(_keep(), **{field: value})).release is True


@pytest.mark.parametrize(
    "key,value",
    [
        ("job_decision", "stop_job"),
        ("job_decision", "unclear"),
        ("job_decision", None),
        ("choice_readback_confirmed", "no"),
        ("choice_readback_confirmed", "unclear"),
        ("spoke_with_person", "no"),
        ("spoke_with_person", "unclear"),
    ],
)
def test_each_structured_field_defect_releases_the_lease(key, value):
    base = _keep()
    result = dict(base.structured_result)
    result[key] = value
    assert _evaluate(dataclasses.replace(base, structured_result=result)).release is True


# --------------------------------------------------------------------------------------
# regressions from real calls
# --------------------------------------------------------------------------------------

def test_a_voicemail_arriving_as_completed_releases_the_lease():
    """OBSERVED: CALL-E has no voicemail status. A recording answering produces
    status 'completed' and task_completed true, identical to a real conversation at
    the status level. The transcript is the only thing that tells them apart, so the
    policy counts what the caller actually said."""
    machine = dataclasses.replace(
        _keep(),
        structured_result={**_keep().structured_result, "spoke_with_person": "no"},
        turns=(
            Turn(0.0, "bot", "Should the job continue, or should it stop?"),
            Turn(2.0, "user", "Hi, leave a message."),
        ),
    )
    verdict = _evaluate(machine)
    assert verdict.release is True
    assert "live_human_evidence_in_transcript" in {c.name for c in verdict.failed}


def test_a_reason_that_contradicts_the_choice_releases_the_lease():
    """OBSERVED on a real call: the caller said "continue" twice and confirmed it, then
    gave the reason "the job's done enough, take it back" -- a reason that means stop.
    Extraction was faithful; the human was inconsistent. Trusting the enum alone would
    have kept a live credential against the caller's actual intent."""
    contradicted = dataclasses.replace(
        _keep(),
        structured_result={
            **_keep().structured_result,
            "reason_sentence": "the jobs done enough, take it back.",
        },
    )
    verdict = _evaluate(contradicted)
    assert verdict.release is True
    assert "reason_does_not_contradict_decision" in {c.name for c in verdict.failed}


@pytest.mark.parametrize(
    "reason",
    [
        "the job's done enough, take it back.",       # curly-safe apostrophe
        "don't let it rewrite anything",
        "do not let it continue",
        "shut it down please",
        "kill it",
        "pull the plug on that one",
    ],
)
def test_stop_leaning_reasons_are_recognised(reason):
    base = _keep()
    contradicted = dataclasses.replace(
        base, structured_result={**base.structured_result, "reason_sentence": reason}
    )
    assert _evaluate(contradicted).release is True


def test_a_reason_containing_stop_as_a_substring_is_not_a_contradiction():
    """'nonstop' must not trip the stop check. A false positive here releases a lease
    the caller meant to keep, which is safe but wrong, and it would look like a bug."""
    base = _keep()
    fine = dataclasses.replace(
        base,
        structured_result={**base.structured_result, "reason_sentence": "it has to run nonstop tonight."},
    )
    assert _evaluate(fine).release is False


# --------------------------------------------------------------------------------------
# nothing may raise, and nothing may keep by accident
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize("score", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_confidence_never_keeps_the_lease(score):
    """NaN compares False against every threshold, so a naive `>=` would silently pass
    it through as 'not below the floor'. json.loads parses NaN without complaint."""
    assert _evaluate(dataclasses.replace(_keep(), confidence_score=score)).release is True


@pytest.mark.parametrize("threshold", [None, float("nan"), float("inf"), -1, "nan", "nonsense", ""])
def test_an_unusable_threshold_never_keeps_the_lease(threshold):
    """A misconfigured caller must not be able to widen the permissive branch.

    "Unusable" means absent, non-finite, out of range, or not a number at all. Each of
    those releases rather than falling back to a default, because a silently-defaulted
    floor is indistinguishable from a deliberate one in a log.
    """
    assert _evaluate(_keep(), min_confidence=threshold).release is True


def test_a_numeric_string_threshold_is_accepted_deliberately():
    """Pinning the other half of the contract, so the leniency is a decision rather
    than an accident: a threshold that parses to a finite number in range is honoured,
    whatever type it arrived as. Config files and environment variables hand over
    strings, and refusing them would release leases for a formatting reason."""
    assert _evaluate(_keep(), min_confidence="0.9").release is False
    assert _evaluate(_keep(), min_confidence="0.99").release is True


def test_evaluating_nothing_at_all_releases_the_lease():
    verdict = _evaluate(None)
    assert verdict.release is True
    assert verdict.failed


@pytest.mark.parametrize(
    "field,value",
    [
        ("structured_result", "a string, not a mapping"),
        ("structured_result", 42),
        ("evidence", "not a sequence of strings"),
        ("turns", None),
        ("status", None),
    ],
)
def test_malformed_shapes_release_rather_than_raise(field, value):
    verdict = _evaluate(dataclasses.replace(_keep(), **{field: value}))
    assert verdict.release is True


def test_an_exception_inside_the_snapshot_releases_rather_than_escapes():
    """If evaluation itself breaks, the credential must not survive on a technicality."""

    class Hostile(dict):
        def get(self, *args, **kwargs):
            raise RuntimeError("boom")

    assert _evaluate(dataclasses.replace(_keep(), raw=Hostile())).release is True


def test_a_verdict_for_a_different_lease_releases():
    """A snapshot that belongs to another job must never keep this one."""
    assert _evaluate(_keep(), expected_job_id="tidy-9999").release is True


# --------------------------------------------------------------------------------------
# nothing sensitive reaches a log or a screen
# --------------------------------------------------------------------------------------

def test_a_phone_number_in_a_provider_string_never_reaches_the_verdict():
    """failure_code is free-form provider text. It has no schema and we do not control
    it, so it is treated as untrusted and swept before it is rendered."""
    leaky = dataclasses.replace(
        _keep(), status="failed", failure_code="no_answer for +60123456789 after 3 rings"
    )
    verdict = _evaluate(leaky)
    rendered = verdict.summary + " ".join(c.detail for c in verdict.conditions)
    assert "60123456789" not in rendered


def test_no_permissive_vocabulary_appears_in_any_condition_name():
    """Polarity check. The call cannot grant anything, and the vocabulary must not
    suggest otherwise -- a reader who sees 'approved' here will read the whole project
    as a gate, which is the one thing it is not."""
    joined = " ".join(policy.CONDITION_NAMES).lower()
    for word in ("approve", "approval", "authoris", "authoriz", "permission", "grant"):
        assert word not in joined
