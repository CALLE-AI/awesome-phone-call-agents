"""The one rule in this app that was arithmetic rather than a branch, and so went unwatched.

A guard sweep over this codebase looked at conditionals and assertions, which is where its
rules live. `RetryPolicy.delay_for` is neither: it is a bare arithmetic return, so it was
structurally invisible to that sweep and to every test. Replacing its body with `return 0.0`
passed the whole suite.

That matters more here than the size of the function suggests. CALL-E has no cancel endpoint,
so once a wave starts the only things standing between a transient upstream failure and a
burst of retries at a family's number are the concurrency cap and this delay. A zero here
turns a retry policy into a tight loop against somebody's phone.

The tests below assert the shape rather than a table of numbers: that it starts at the base,
that each attempt doubles the last, that it stops at the ceiling and stays there, and that it
is never zero for any attempt a policy can reach.
"""
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from dispatch.scheduler import RetryPolicy


def test_the_first_attempt_waits_the_base_delay():
    policy = RetryPolicy(base_delay_seconds=2.0, max_delay_seconds=60.0)
    assert policy.delay_for(1) == 2.0


def test_each_attempt_waits_twice_as_long_as_the_one_before():
    """Doubling is the property. A constant delay retries a struggling upstream at a fixed
    rate, which is the behaviour backoff exists to avoid."""
    policy = RetryPolicy(base_delay_seconds=1.0, max_delay_seconds=1000.0)
    delays = [policy.delay_for(n) for n in range(1, 7)]
    for earlier, later in zip(delays, delays[1:]):
        assert later == earlier * 2, f"{delays} is not a doubling sequence"


def test_the_delay_stops_at_the_ceiling_and_stays_there():
    """Unbounded doubling reaches an hour by attempt twelve. The ceiling is what makes this
    a policy rather than a way of never calling back."""
    policy = RetryPolicy(base_delay_seconds=1.0, max_delay_seconds=8.0)
    assert [policy.delay_for(n) for n in range(1, 8)] == [1, 2, 4, 8, 8, 8, 8]


@pytest.mark.parametrize("attempt", [1, 2, 3, 4, 10])
def test_no_attempt_ever_waits_nothing(attempt):
    """The mutation this file was written for. `return 0.0` satisfies a doubling check for a
    base of zero and nothing else, so the sequence tests above already catch it; this states
    the consequence in its own right, because it is the one a family would notice."""
    policy = RetryPolicy()
    assert policy.delay_for(attempt) > 0, (
        "a zero delay retries a family's number as fast as the network allows, and CALL-E "
        "has no cancel endpoint to stop it"
    )


def test_the_delay_never_exceeds_the_ceiling_the_policy_was_built_with():
    """Reading the ceiling off the policy rather than repeating it, so a changed default
    cannot leave this passing against a number nobody uses."""
    policy = RetryPolicy()
    for attempt in range(1, 20):
        assert policy.delay_for(attempt) <= policy.max_delay_seconds
