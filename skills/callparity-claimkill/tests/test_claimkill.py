"""ClaimKill regressions for leak-drop, merger, and extra fixtures.

Run from the repository root:

    python3 -m pytest skills/callparity-claimkill/tests/test_claimkill.py -q

The suite places zero live CALL-E calls. It must fail if leak-drop keeps
a question that discloses Party A's warehouse answer.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import claimkill  # noqa: E402


def _kept_texts(plan: claimkill.PreviewPlan) -> list[str]:
    return [item.question.text.lower() for item in plan.kept]


def _dropped_texts(plan: claimkill.PreviewPlan) -> list[str]:
    return [item.question.text.lower() for item in plan.dropped]


def test_engine_has_no_network_imports() -> None:
    source = Path(claimkill.__file__).read_text(encoding="utf-8")
    for banned in ("import urllib", "import requests", "import http.client", "from urllib"):
        assert banned not in source, f"claimkill.py must not import {banned}"


def test_confirmed_alias_maps_to_supported() -> None:
    assert claimkill.normalize_status("CONFIRMED") == claimkill.SUPPORTED
    assert claimkill.normalize_status("confirmed") == claimkill.SUPPORTED
    assert claimkill.normalize_status("SUPPORTED") == claimkill.SUPPORTED


def test_fr1842_preview_places_zero_calls() -> None:
    plan = claimkill.preview("FR-1842")
    assert plan.calls_placed == 0
    assert plan.ticket_id == "FR-1842"
    assert plan.sku == "PL-9F21"
    assert "zero live" in plan.side_effect.lower()
    for party in plan.masked_parties:
        assert "*" in party["phone"]
        assert "010018" not in party["phone"]


def test_fr1842_dock_empty_stays() -> None:
    plan = claimkill.preview("FR-1842")
    kept = _kept_texts(plan)
    assert any("dock 3" in text and "empty" in text for text in kept), (
        "FR-1842 driver question about whether dock 3 was empty must stay"
    )
    next_text = "" if plan.next_question is None else plan.next_question.text.lower()
    assert "empty" in next_text
    assert "dock 3" in next_text
    assert "warehouse said" not in next_text


def test_fr1842_warehouse_said_dock_3_is_dropped() -> None:
    plan = claimkill.preview("FR-1842")
    dropped = _dropped_texts(plan)
    kept = _kept_texts(plan)
    assert any("warehouse said dock 3" in text for text in dropped), (
        "FR-1842 questions containing 'warehouse said dock 3' must be dropped"
    )
    assert all("warehouse said dock 3" not in text for text in kept)
    short_leak = claimkill.RefutationQuestion(
        id="synth-short-leak",
        text="warehouse said dock 3?",
        targets=("dock",),
    )
    graph = claimkill.load_fixture("FR-1842").graph
    scored = claimkill.score_question(short_leak, graph.nodes, graph.spoken_time_budget_s)
    assert scored.leak_score >= claimkill.LEAK_DROP_THRESHOLD
    assert scored.discarded is True
    assert scored.discard_reason == "discloses party A answer"


def test_fr1842_short_leak_is_cheaper_than_dock_empty_but_still_dropped() -> None:
    loaded = claimkill.load_fixture("FR-1842")
    leak = next(
        question
        for question in loaded.questions
        if "warehouse said dock 3" in question.text.lower()
        and question.id == "q-short-leak"
    )
    dock = next(
        question for question in loaded.questions if question.id == "q-dock-empty"
    )
    assert claimkill.spoken_seconds(leak.text) < claimkill.spoken_seconds(dock.text)
    plan = claimkill.compile_preview(loaded)
    assert plan.next_question is not None
    assert plan.next_question.id == "q-dock-empty"
    assert all(item.question.id != "q-short-leak" for item in plan.kept)


def test_fr1842_merger_dock_contradicted_arrival_supported_seal_untested() -> None:
    graph = claimkill.merge_fixture("FR-1842")
    assert graph.node("dock").status == claimkill.CONTRADICTED
    assert graph.node("arrival").status == claimkill.SUPPORTED
    assert graph.node("seal").status == claimkill.UNTESTED
    assert graph.to_dict()["overall"] == claimkill.CONTRADICTED
    tested = {edge.claim_id: edge.tested_by for edge in graph.edges}
    assert tested["dock"] == "q-dock-empty"
    assert "seal" not in tested
    assert graph.node("dock").evidence.quote == "pallet left dock 3"


def test_fr1842_merge_without_falsifier_stays_untested() -> None:
    loaded = claimkill.load_fixture("FR-1842")
    event = claimkill.MergeEvent(
        call_id="call-empty-quotes",
        disposition="completed",
        quotes=(),
    )
    graph = claimkill.merge(loaded.graph, event)
    assert graph.node("dock").status == claimkill.UNTESTED
    assert graph.node("arrival").status == claimkill.UNTESTED
    assert graph.node("seal").status == claimkill.UNTESTED


def test_fr1900_low_confidence_abstains() -> None:
    loaded = claimkill.load_fixture("FR-1900")
    assert loaded.graph.node("dock").status == claimkill.ABSTAIN
    assert loaded.graph.node("arrival").status == claimkill.ABSTAIN
    plan = claimkill.preview("FR-1900")
    assert plan.next_question is None
    assert plan.calls_placed == 0
    graph = claimkill.merge_fixture("FR-1900")
    assert graph.node("dock").status == claimkill.ABSTAIN
    assert graph.node("arrival").status == claimkill.ABSTAIN
    assert graph.to_dict()["overall"] == "could-not-verify"


def test_fr1888_voicemail_unreachable_and_low_confidence_abstain() -> None:
    loaded = claimkill.load_fixture("FR-1888")
    assert loaded.graph.node("seal").status == claimkill.ABSTAIN
    graph = claimkill.merge_fixture("FR-1888")
    assert graph.node("dock").status == claimkill.UNREACHABLE
    assert graph.node("arrival").status == claimkill.UNREACHABLE
    assert graph.node("seal").status == claimkill.ABSTAIN
    assert graph.to_dict()["overall"] == "could-not-verify"
    tested = {edge.claim_id: edge.tested_by for edge in graph.edges}
    assert tested["dock"] == "call-nplus1-fr-1888"
    assert "seal" not in tested


def test_preview_cli_json_artifact() -> None:
    plan = claimkill.preview(SKILL_ROOT / "fixtures" / "FR-1842.json")
    artifact = plan.to_dict()
    assert artifact["calls_placed"] == 0
    assert artifact["next_question"]["id"] == "q-dock-empty"
    assert any(
        item["discarded"] is True and "warehouse said dock 3" in item["text"].lower()
        for item in artifact["dropped"]
    )
    assert "warehouse said dock 3" not in json.dumps(artifact["kept"]).lower()
    assert artifact["blocked_reason"] is None


def test_missing_consent_blocks_next_question() -> None:
    loaded = claimkill.load_fixture("FR-1842")
    loaded.parties[1]["consent"] = False
    plan = claimkill.compile_preview(loaded)
    assert plan.blocked_reason == "missing consent"
    assert plan.next_question is None
    assert plan.calls_placed == 0
