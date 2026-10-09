"""The platform surface map cannot drift from the implementation.

docs/platform-surface-map.md states platform vocabularies in prose. Each
test here pins one stated vocabulary to the implementation constant it
describes, so the page and the code cannot disagree silently.
"""

from __future__ import annotations

import re
from pathlib import Path

from warrantyops.cassettes import PLATFORM_STATUSES, SCRIPTED_SPEAKERS
from warrantyops.goal_runs import DOCUMENTED_SPEAKER_LABELS, GoalRunErrorCode
from warrantyops.outcome import TransportState
from warrantyops.providers.calle_client import KNOWN_SDK_STATUSES
from warrantyops.webhooks import WEBHOOK_TERMINAL_EVENTS

DOC = Path(__file__).resolve().parents[1] / "docs" / "platform-surface-map.md"


def page() -> str:
    return DOC.read_text(encoding="utf-8")


def test_the_five_documented_call_statuses_are_exactly_the_sdk_vocabulary():
    statuses = [
        line
        for line in page().splitlines()
        if line.startswith("| Statuses |")
    ]
    assert len(statuses) == 1
    listed = frozenset(re.findall(r"`(\w+)`", statuses[0]))
    assert listed == KNOWN_SDK_STATUSES
    assert listed == PLATFORM_STATUSES


def test_the_transport_enum_matches_the_documented_vocabulary():
    values = {
        state.value
        for state in TransportState
        if state is not TransportState.NOT_ATTEMPTED
    }
    assert values == KNOWN_SDK_STATUSES


def test_the_eight_goal_error_codes_are_listed_exactly_once():
    codes = sorted(member.value for member in GoalRunErrorCode)
    listed = page().split("```text")[1].split("```")[0]
    for code in codes:
        assert listed.count(code) == 1, code
    assert len(codes) == 8


def test_the_webhook_terminal_events_are_the_only_accepted_hints():
    listed = re.search(r"terminal events ([^;]+);", " ".join(page().split()))
    assert listed is not None
    events = frozenset(
        token.strip().strip("` ,")
        for token in listed.group(1).split(",")
        if "call." in token
    )
    assert events == WEBHOOK_TERMINAL_EVENTS


def test_the_speaker_vocabularies_are_pinned():
    body = page()
    assert "bot" in body and "user" in body
    assert SCRIPTED_SPEAKERS <= DOCUMENTED_SPEAKER_LABELS


def test_the_unknown_behaviour_is_stated_not_smoothed_over():
    body = page()
    assert "UNKNOWN" in body
    assert "same-key/different-body" in body.lower() or (
        "Same-key/different-body" in body
    )
    assert "never presented as an observed platform fact" in body


def test_every_claim_row_carries_an_evidence_class_or_names_r1():
    """Each table row in section 1 names R1, a pill, or a public-doc date."""

    section = page().split("## 1. Calls API")[1].split("## 2.")[0]
    pills = ("Recorded CALL-E result", "Synthetic scenario", "Fictional case data")
    for line in section.splitlines():
        if not line.strip().startswith("|") or "---" in line:
            continue
        if "Aspect" in line:
            continue
        assert any(pill in line for pill in pills) or "R1" in line or (
            "public documentation" in line
        ), line
