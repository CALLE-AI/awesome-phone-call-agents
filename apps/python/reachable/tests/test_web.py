"""The dashboard. In-process test client; no socket, no credential."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from reachable.models import ContactHealth, PatternState
from reachable.store import from_json, to_json
from reachable.web.app import create_app

from .conftest import SCHOOL_DAY_IN_WINDOW

IVY_CASE = "PF-P-1041-2026-09-11"


@pytest.fixture
def client(live):
    live.scan_register()
    return TestClient(create_app(live.config, orchestrator=live)), live


@pytest.fixture
def dry_client(dry):
    dry.scan_register()
    return TestClient(create_app(dry.config, orchestrator=dry)), dry


def test_every_page_renders(client):
    http, _ = client
    for path in ["/", "/contacts", "/tasks", "/decisions", "/import"]:
        assert http.get(path).status_code == 200, path


def test_the_mode_banner_is_always_visible(client, dry_client):
    http, _ = client
    assert "FAKE" in http.get("/").text

    dry_http, _ = dry_client
    body = dry_http.get("/").text
    assert "DRY-RUN" in body
    assert "no call can be placed from" in body


def test_urgent_cases_are_pinned_and_visually_distinct(client, fake_state):
    http, orc = client
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "urgent_did_not_know")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)

    body = http.get("/").text
    assert "Needs a person now" in body
    assert "panel urgent" in body
    # And it is above the ordinary case groups.
    assert body.index("Needs a person now") < body.index("Pattern cases")


def test_the_case_page_shows_guards_cascade_and_preview(client):
    http, _ = client
    body = http.get(f"/cases/{IVY_CASE}").text
    assert "Guards" in body
    assert "Cascade" in body
    assert "Exactly what will be said" in body
    assert "automated assistant" in body
    assert "Idempotency key" in body


def test_the_case_page_never_shows_a_full_number(client):
    http, orc = client
    body = http.get(f"/cases/{IVY_CASE}").text
    for contact in orc.dataset.contacts:
        assert contact.phone_e164 not in body
    assert "…377" in body


def test_free_text_display_mask_preserves_private_evidence(client, fake_state):
    http, orc = client
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_reason_only")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)
    number = "+447700900101"  # reserved fictional fixture
    evidence = f"Please use {number}. <script>alert(1)</script>"
    original = orc.store.attempt(outcome.attempt_id)
    result = from_json(original["structured_result"], {})
    result.update(reason_note=evidence, verbatim_quotes=[evidence])
    if "verbatim_identity_quote" in result:
        result["verbatim_identity_quote"] = evidence
    orc.store.update_attempt(
        outcome.attempt_id, structured_result=to_json(result), disposition_reason=evidence
    )
    orc.store.add_task("display-test", pupil_id="P-1041", kind="support", detail=evidence)
    orc.store.record_event("display.test", case_id=IVY_CASE, reason=evidence)
    before = dict(orc.store.attempt(outcome.attempt_id))

    for response in (
        http.get(f"/cases/{IVY_CASE}"), http.get("/tasks"),
        http.post("/export/register-reasons")
    ):
        assert response.status_code == 200
        assert number not in response.text
        assert "…101" in response.text
        if response.headers["content-type"].startswith("text/html"):
            assert "<script>alert(1)</script>" not in response.text
            assert "&lt;script&gt;" in response.text
    assert dict(orc.store.attempt(outcome.attempt_id)) == before
    assert number in before["structured_result"]
    assert f'/cases/{IVY_CASE}/resolve' in http.get(f"/cases/{IVY_CASE}").text


def test_no_page_ever_leaks_a_full_number(client, fake_state):
    http, orc = client
    orc.start_contact_check()
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "wrong_person")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)

    everything = "".join(
        http.get(p).text for p in ["/", "/contacts", "/tasks", "/decisions", "/import"]
    )
    everything += http.get(f"/cases/{IVY_CASE}").text
    for contact in orc.dataset.contacts:
        assert contact.phone_e164 not in everything


def test_a_call_needs_the_typed_confirmation(client, fake_client):
    """The per-call confirmation gate. A wrong word places nothing."""
    http, orc = client
    http.post(f"/cases/{IVY_CASE}/call", data={"confirm": "wrong"}, follow_redirects=False)
    assert fake_client.state.requests == []
    assert orc.store.case(IVY_CASE)["state"] == PatternState.PF_CASCADE_READY.value


def test_the_right_confirmation_places_the_call(client, fake_client, fake_state):
    http, orc = client
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_support")
    http.post(f"/cases/{IVY_CASE}/call", data={"confirm": "Ivy"}, follow_redirects=False)
    assert len(fake_client.state.requests) == 1
    assert orc.store.case(IVY_CASE)["state"] == PatternState.PF_SUPPORT_REQUESTED.value


def test_the_confirmation_is_case_insensitive_but_must_be_the_name(client, fake_client):
    http, orc = client
    http.post(f"/cases/{IVY_CASE}/call", data={"confirm": "  ivy "}, follow_redirects=False)
    assert len(fake_client.state.requests) == 1


def test_dry_run_shows_a_preview_but_places_nothing(dry_client, fake_client):
    http, orc = dry_client
    body = http.get(f"/cases/{IVY_CASE}").text
    assert "Exactly what will be said" in body
    http.post(f"/cases/{IVY_CASE}/call", data={"confirm": "Ivy"}, follow_redirects=False)
    assert fake_client.state.requests == []


def test_decisions_view_lists_named_refusals(dry_client):
    http, orc = dry_client
    http.post(f"/cases/{IVY_CASE}/call", data={"confirm": "Ivy"}, follow_redirects=False)
    body = http.get("/decisions").text
    assert "DRY_RUN" in body
    assert "hold" in body


def test_the_vulnerable_refusal_is_visible_without_running_anything(client):
    http, _ = client
    assert "PUPIL_VULNERABLE" in http.get("/decisions").text
    tasks = http.get("/tasks").text
    assert "vulnerable_pupil" in tasks
    assert "Dylan" in tasks


def test_contact_health_shows_reachability_per_pupil(client):
    http, _ = client
    body = http.get("/contacts").text
    assert "contacts verified" in body
    assert "no verified contact" in body


def test_a_flagged_contact_appears_after_a_failed_pattern_call(client, fake_state):
    """The loop, visible on screen."""
    http, orc = client
    assert ContactHealth.WRONG_PERSON.value not in http.get("/contacts").text

    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "wrong_person")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)

    body = http.get("/contacts").text
    assert "Wrong person answered" in body
    assert "pattern_call" in body  # found by the absence call, not the termly check


def test_evidence_quotes_are_shown_for_a_completed_call(client, fake_state):
    http, orc = client
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_support")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)

    body = http.get(f"/cases/{IVY_CASE}").text
    assert "Evidence the recipient actually spoke" in body
    assert "bus fare" in body
    assert "is not evidence" in body


def test_a_suggested_reason_waits_for_approval(client, fake_state):
    http, orc = client
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_reason_only")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)

    body = http.get(f"/cases/{IVY_CASE}").text
    assert "Suggested register reason" in body
    assert "never writes to the register" in body
    assert "Approve this suggestion" in body

    http.post(f"/cases/{IVY_CASE}/approve-reason", follow_redirects=False)
    assert "approved by staff" in http.get(f"/cases/{IVY_CASE}").text


def test_staff_can_resolve_a_case(client, fake_state):
    http, orc = client
    request, *_ = orc.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "low_confidence")
    outcome = orc.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    orc.reconcile(outcome.attempt_id)
    assert orc.store.case(IVY_CASE)["state"] == PatternState.PF_NEEDS_HUMAN.value

    http.post(
        f"/cases/{IVY_CASE}/resolve",
        data={"target": PatternState.PF_NOT_CALLED.value, "note": "Spoke to mum directly"},
        follow_redirects=False,
    )
    assert orc.store.case(IVY_CASE)["state"] == PatternState.PF_NOT_CALLED.value


def test_tasks_can_be_marked_handled(client):
    http, orc = client
    task_id = orc.store.tasks()[0]["task_id"]
    http.post(f"/tasks/{task_id}/handled", follow_redirects=False)
    assert all(t["task_id"] != task_id for t in orc.store.tasks())


def test_exports_download_as_csv_and_are_masked(client):
    http, orc = client
    for path in ["/export/contact-changes", "/export/register-reasons", "/export/contact-health"]:
        response = http.post(path)
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]
        assert "attachment" in response.headers["content-disposition"]
        for contact in orc.dataset.contacts:
            assert contact.phone_e164 not in response.text


def test_import_page_shows_the_validation_report(client):
    http, _ = client
    http.post("/import", follow_redirects=False)
    body = http.get("/import").text
    assert "Validation report" in body
    assert "Rejected rows" in body
    assert "invalid phone number" in body
    assert "07700900182" not in body  # masked in the report


def test_healthz_reports_the_mode(client):
    http, _ = client
    assert http.get("/healthz").json() == {"ok": True, "mode": "FAKE"}
