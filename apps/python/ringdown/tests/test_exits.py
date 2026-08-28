from __future__ import annotations

import pytest

from ringdown.exits import (
    EXIT_ACKNOWLEDGED,
    EXIT_DECLINED,
    EXIT_UNACKNOWLEDGED,
    EXIT_UNKNOWN,
    EXIT_UNRESOLVED,
    EXIT_UNVERIFIED,
    EXIT_USAGE,
    reconcile,
    settle,
    verifiable,
)

HELD = [(True, "one held")]
DENIED = [(True, "one held"), (False, "the second channel said otherwise")]
SILENT = [(True, "one held"), (None, "the second channel never answered")]

TABLE = [
    ("acknowledged", 1, HELD, EXIT_ACKNOWLEDGED),
    ("declined", 1, HELD, EXIT_DECLINED),
    ("unacknowledged", 1, HELD, EXIT_UNACKNOWLEDGED),
    ("unknown", 1, [], EXIT_UNKNOWN),
    ("unknown", 0, DENIED, EXIT_UNKNOWN),
    ("acknowledged", 0, [], EXIT_USAGE),
    ("declined", 0, [], EXIT_USAGE),
    ("acknowledged", 1, DENIED, EXIT_UNVERIFIED),
    ("declined", 1, DENIED, EXIT_UNVERIFIED),
    ("unacknowledged", 1, DENIED, EXIT_UNVERIFIED),
    ("acknowledged", 1, SILENT, EXIT_UNRESOLVED),
    ("declined", 1, SILENT, EXIT_UNRESOLVED),
    ("acknowledged", 1, [], EXIT_UNRESOLVED),
]


@pytest.mark.parametrize("verdict,placed,checks,expected", TABLE)
def test_the_precedence_the_readme_promises_is_the_one_the_cli_runs(
    verdict, placed, checks, expected
):
    assert settle(verdict, placed, checks) == expected


def test_a_verdict_the_second_channel_denies_loses_to_forty_whatever_it_was():
    for verdict in ("acknowledged", "declined", "unacknowledged"):
        assert settle(verdict, 1, DENIED) == EXIT_UNVERIFIED


def test_a_channel_that_said_nothing_is_never_read_as_a_channel_that_disagreed():
    assert settle("declined", 1, SILENT) == EXIT_UNRESOLVED
    assert settle("declined", 1, DENIED) == EXIT_UNVERIFIED


def test_a_call_whose_state_is_unknown_is_never_verified():
    assert not verifiable("unknown", 1)
    assert settle("unknown", 1, DENIED) == EXIT_UNKNOWN


def test_a_ladder_that_placed_nothing_is_never_verified():
    assert not verifiable("acknowledged", 0)
    assert settle("acknowledged", 0, DENIED) == EXIT_USAGE


@pytest.mark.parametrize("verdict,placed,checks,expected", TABLE)
def test_the_ladder_verifies_exactly_when_the_verdict_still_depends_on_it(
    verdict, placed, checks, expected
):
    assert verifiable(verdict, placed) == (expected not in (EXIT_UNKNOWN, EXIT_USAGE))


def test_a_ledger_that_reconciles_keeps_the_verdict_it_was_asked_about():
    assert reconcile(EXIT_ACKNOWLEDGED, HELD) == EXIT_ACKNOWLEDGED
    assert reconcile(EXIT_DECLINED, HELD) == EXIT_DECLINED
    assert reconcile(EXIT_DECLINED, DENIED) == EXIT_UNVERIFIED
    assert reconcile(EXIT_DECLINED, SILENT) == EXIT_UNRESOLVED
