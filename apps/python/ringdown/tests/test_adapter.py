from __future__ import annotations

import pytest

from ringdown.adapter import MISSING, adapt, resolve
from ringdown.incident import IncidentError, parse_incident
from tests.data import example_body


def mapped(**payload_overrides) -> dict:
    payload = example_body("pagerduty")
    payload["event"]["data"].update(payload_overrides)
    return adapt(payload, example_body("pagerduty-mapping"))


def test_a_pagerduty_webhook_becomes_an_incident_ringdown_can_dial():
    incident = parse_incident(mapped())

    assert incident.id == "PBAZLIU"
    assert incident.title == "checkout p99 latency above 3s"
    assert incident.service == "checkout-api"
    assert incident.runbook_url == "https://example.pagerduty.com/incidents/PBAZLIU"


def test_the_pagerduty_priority_is_the_severity_that_gets_spoken():
    assert parse_incident(mapped()).severity == "p2"
    assert parse_incident(mapped(priority={"summary": "P1"})).severity == "p1"


def test_an_incident_without_a_priority_is_refused_rather_than_given_one():
    with pytest.raises(IncidentError):
        parse_incident(mapped(priority=None))


def test_the_summary_comes_from_the_mapping_because_the_webhook_carries_none():
    payload = example_body("pagerduty")
    mapping = example_body("pagerduty-mapping")

    assert adapt(payload, mapping)["summary"] == mapping["summary"]


def test_a_path_that_does_not_resolve_omits_the_key_instead_of_inventing_one():
    assert "runbook_url" not in adapt({}, {"runbook_url": "$.event.data.html_url"})


@pytest.mark.parametrize(
    "payload, path",
    [
        ({"a": {}}, "$.a.b"),
        ({"a": [1]}, "$.a[3]"),
        ({"a": {"b": 1}}, "$.a[0]"),
        ({"a": [1]}, "$.a.b"),
        ({"a": 1}, "a"),
        ({"a": 1}, "$.a["),
        ({"a": 1}, "$$a"),
    ],
)
def test_a_path_that_cannot_be_followed_reports_missing_instead_of_raising(payload, path):
    assert resolve(payload, path) is MISSING


def test_a_mapping_value_that_is_not_a_path_is_copied_as_a_literal():
    assert adapt({}, {"ladder": ["primary"], "timezone": "UTC"}) == {
        "ladder": ["primary"],
        "timezone": "UTC",
    }


def opsgenie_mapped(**alert_overrides) -> dict:
    payload = example_body("opsgenie")
    payload["alert"].update(alert_overrides)
    return adapt(payload, example_body("opsgenie-mapping"))


def test_an_opsgenie_webhook_becomes_an_incident_ringdown_can_dial():
    incident = parse_incident(opsgenie_mapped())

    assert incident.id == "052652ac-5d1c-464a-812a-7dd18bbfba8c"
    assert incident.title == "checkout p99 latency above 3s"
    assert incident.service == "checkout-api"
    assert incident.severity == "p2"
    assert incident.runbook_url == ""


def test_the_first_opsgenie_tag_is_the_severity_that_gets_spoken():
    assert parse_incident(opsgenie_mapped(tags=["P1", "checkout"])).severity == "p1"


def test_an_opsgenie_alert_tagged_with_something_else_is_refused_rather_than_guessed():
    with pytest.raises(IncidentError):
        parse_incident(opsgenie_mapped(tags=["checkout", "p2"]))

