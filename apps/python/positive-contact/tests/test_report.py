"""Denominator honesty: every count has to be measured against something real."""

from __future__ import annotations

import csv
import io
import json

import pytest

from positive_contact.cli import execute_run, seed_ledger
from positive_contact.escalate import approve_field_visit, operator_confirm
from positive_contact.models import DispositionKind, IntentState
from positive_contact.report import build_report, work_orders_csv, work_orders_json
from positive_contact.transports.fixture import FixtureTransport
from tests.conftest import SCENARIOS


@pytest.fixture
def report_after_demo(ledger, demo_preflight, event, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    return build_report(ledger, event, now=now)


def test_the_headline_counts(report_after_demo):
    counts = report_after_demo.counts
    assert counts["in_scope"] == 12
    assert counts["attempted"] == 11
    assert counts["confirmed"] == 7
    assert counts["live_reached"] == 9  # 8 live persons plus one refusal


def test_confirmed_counts_only_confirmed_dispositions(ledger, report_after_demo):
    confirmed_dispositions = [
        item
        for item in ledger.list_dispositions("psps-demo-2026-09")
        if item.disposition is DispositionKind.CONFIRMED
    ]
    assert report_after_demo.counts["confirmed_by_adjudicator"] == len(confirmed_dispositions)


def test_confirmed_is_not_the_number_of_completed_calls(report_after_demo):
    assert report_after_demo.counts["confirmed"] < report_after_demo.counts["calls_placed"]


def test_an_operator_confirmation_is_counted_separately(
    ledger, demo_preflight, event, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    intent = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])[0]
    operator_confirm(ledger, intent, actor="op-7", evidence_text="They said yes", now=now)

    report = build_report(ledger, event, now=now)
    assert report.counts["confirmed_by_operator"] == 1
    assert (
        report.counts["confirmed"]
        == report.counts["confirmed_by_adjudicator"] + report.counts["confirmed_by_operator"]
    )


def test_confirmed_never_exceeds_live_reached(report_after_demo):
    assert report_after_demo.counts["confirmed"] <= report_after_demo.counts["live_reached"]


def test_live_reached_never_exceeds_attempted(report_after_demo):
    assert report_after_demo.counts["live_reached"] <= report_after_demo.counts["attempted"]


def test_attempted_never_exceeds_in_scope(report_after_demo):
    assert report_after_demo.counts["attempted"] <= report_after_demo.counts["in_scope"]


def test_the_unsupported_locale_contact_is_in_scope_but_not_attempted(report_after_demo):
    counts = report_after_demo.counts
    assert counts["unsupported_locale_routed"] == 1
    assert counts["in_scope"] - counts["attempted"] == counts["unsupported_locale_routed"]


def test_the_unsupported_locale_denominator_says_it_was_never_dialled(report_after_demo):
    metric = next(
        item for item in report_after_demo.metrics if "Language not supported" in item.label
    )
    assert "never dialled" in metric.denominator
    assert "attempted" not in metric.denominator


def test_every_metric_carries_a_denominator(report_after_demo):
    for metric in report_after_demo.metrics:
        assert metric.denominator, metric.label


def test_calls_placed_matches_the_ledger(ledger, report_after_demo):
    assert report_after_demo.counts["calls_placed"] == ledger.count_calls_for_event(
        "psps-demo-2026-09"
    )


def test_field_visits_are_pending_until_a_person_approves(report_after_demo):
    assert report_after_demo.counts["field_visits_pending"] >= 1
    assert report_after_demo.counts["field_visits_issued"] == 0


def test_an_approved_field_visit_moves_to_issued(ledger, demo_preflight, event, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    order = ledger.list_work_orders(event.event_id)[0]
    approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)
    report = build_report(ledger, event, now=now)
    assert report.counts["field_visits_issued"] == 1


# -- output formats ----------------------------------------------------------------


def test_the_markdown_report_is_a_table(report_after_demo):
    rendered = report_after_demo.to_markdown()
    assert "| Metric | Value | Denominator |" in rendered
    assert "Positive contact confirmed" in rendered
    assert rendered.endswith("\n")


def test_the_csv_report_parses(report_after_demo):
    rows = list(csv.reader(io.StringIO(report_after_demo.to_csv())))
    assert rows[0] == ["metric", "value", "denominator"]
    assert len(rows) == len(report_after_demo.metrics) + 1


def test_the_json_report_parses(report_after_demo):
    payload = json.loads(report_after_demo.to_json())
    assert payload["event_id"] == "psps-demo-2026-09"
    assert payload["counts"]["confirmed"] == 7
    assert len(payload["metrics"]) == len(report_after_demo.metrics)


def test_the_report_explains_how_confirmed_was_counted(report_after_demo):
    joined = " ".join(report_after_demo.notes)
    assert "never inferred from a completed call" in joined


# -- work order export -------------------------------------------------------------


def test_the_export_holds_only_approved_visits(ledger, demo_preflight, event, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    assert len(list(csv.reader(io.StringIO(work_orders_csv(ledger, event))))) == 1  # header only

    order = ledger.list_work_orders(event.event_id)[0]
    approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)
    rows = list(csv.reader(io.StringIO(work_orders_csv(ledger, event))))
    assert len(rows) == 2
    assert rows[1][2] == order.contact_id


def test_the_export_masks_the_number(ledger, demo_preflight, event, now):
    from positive_contact.redact import find_raw_e164

    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    for order in ledger.list_work_orders(event.event_id):
        approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)

    exported = work_orders_csv(ledger, event)
    assert find_raw_e164(exported) == []
    assert "•••" in exported
    assert find_raw_e164(work_orders_json(ledger, event)) == []


def test_the_export_json_parses(ledger, demo_preflight, event, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    order = ledger.list_work_orders(event.event_id)[0]
    approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)
    payload = json.loads(work_orders_json(ledger, event))
    assert payload["event_id"] == event.event_id
    assert len(payload["work_orders"]) == 1


def test_an_empty_event_reports_zeroes_without_dividing_by_anything(ledger, event, now):
    ledger.put_event(event)
    report = build_report(ledger, event, now=now)
    assert report.counts["in_scope"] == 0
    assert report.counts["confirmed"] == 0
    assert report.to_markdown()
