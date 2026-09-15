"""The four Must Fix items from the Roll Call maintainer review, 2026-09-06.

Each section proves one requirement against the real code path, with the
adversarial cases rather than only the happy ones. Named after the review so a
reviewer can check them off directly.

  1. Do not send bearer credentials to an operator-controlled arbitrary origin;
     restrict credential-bearing requests to approved secure provider origins.
  2. Do not persist raw transcript, result, or provider text through JSON
     output; deeply sanitize all stored and displayed free text.
  3. Do not let an unbound guardian or generic yes/no result trigger
     safeguarding or attendance actions. Bind the result to the approved
     destination and keep the high-stakes interpretation explicitly
     human-reviewed.
  4. Enforce strict ASCII E.164 validation before any live call.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.templating import Jinja2Templates

from fake_calle.scripts import SCRIPTS
from reachable.calls.binding import Intent, bind, gather_evidence
from reachable.calls.client import call_task, turn
from reachable.calls.dispositions import classify, contact_check_event, pattern_event
from reachable.calls.dryrun_client import DryRunClient
from reachable.config import Config, CredentialOriginError
from reachable.machines import contact_check as cc
from reachable.machines import pattern_followup as pf
from reachable.models import ContactHealth, Disposition, NoCallReason, PatternState, Workflow
from reachable.web.app import TEMPLATES

from .conftest import APP_ROOT, SCHOOL_DAY_IN_WINDOW

SOURCE = APP_ROOT / "reachable"
IVY_CASE = "PF-P-1041-2026-09-11"
DEST = "+447700900218"


# ===========================================================================
# 1. Credential allowlist
# ===========================================================================


def test_1_only_one_module_ever_receives_the_api_key():
    """A narrow surface is the point: one adapter, one origin check."""
    readers = [
        path
        for path in SOURCE.rglob("*.py")
        if "calle_api_key" in path.read_text(encoding="utf-8")
    ]
    assert {p.name for p in readers} == {"config.py", "calle_client.py"}


def test_1_no_other_http_client_exists_that_could_carry_the_key():
    """No stray httpx/requests/urllib caller that might bypass the allowlist."""
    offenders = []
    for path in SOURCE.rglob("*.py"):
        if path.name in {"config.py", "calle_client.py"}:
            continue
        text = path.read_text(encoding="utf-8")
        for needle in ("httpx.", "requests.get", "requests.post", "urlopen"):
            if needle in text:
                offenders.append(f"{path.name}: {needle}")
    assert offenders == []


def test_1_the_origin_is_validated_at_startup_before_the_key_is_read():
    class Tripwire(dict):
        read_key = False

        def get(self, name, default=None):
            if name == "CALLE_API_KEY":
                type(self).read_key = True
            return super().get(name, default)

    Tripwire.read_key = False
    env = Tripwire(
        {"REACHABLE_CALLE_BASE_URL": "https://attacker.test", "CALLE_API_KEY": "secret"}
    )
    with pytest.raises(CredentialOriginError):
        Config.from_env(env)
    assert Tripwire.read_key is False


@pytest.mark.parametrize(
    "hostile",
    [
        "https://api.heycall-e.com.attacker.test",
        "https://api.heycall-e.com@evil.test",
        "https://evil.test/?u=https://api.heycall-e.com",
        "https://evil.test#api.heycall-e.com",
        "http://api.heycall-e.com",
        "https://API.HEYCALL-E.COM.evil.test",
    ],
)
def test_1_lookalike_origins_are_refused(hostile):
    """Matching is on the parsed host, never a substring."""
    with pytest.raises(CredentialOriginError):
        Config.from_env({"REACHABLE_CALLE_BASE_URL": hostile})


def test_1_the_adapter_revalidates_rather_than_trusting_config():
    """Belt and braces: a future refactor cannot route a token elsewhere."""
    text = (SOURCE / "calls" / "calle_client.py").read_text(encoding="utf-8")
    assert "validate_calle_origin(config.calle_base_url)" in text
    # And the key is only read after that line.
    assert text.index("validate_calle_origin") < text.index("api_key=self._config")


def test_1_a_redacted_config_never_carries_key_material():
    config = Config.from_env({"CALLE_API_KEY": "sk-live-abc", "REACHABLE_ADMIN_TOKEN": "t-xyz"})
    rendered = json.dumps(config.redacted())
    assert "sk-live-abc" not in rendered and "sk-" not in rendered
    assert "t-xyz" not in rendered


# ===========================================================================
# 2. Sanitisation of all stored and displayed free text
# ===========================================================================


HOSTILE_TEXT = "Yes\x00\x07 spea‮kcab ​<script>alert(1)</script>"


def test_2_provider_text_is_sanitised_before_it_is_stored(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    original = SCRIPTS["clean_identity"]

    def hostile(destination, metadata):
        snapshot = original(destination, metadata)
        snapshot["structured_result"]["verbatim_identity_quote"] = HOSTILE_TEXT
        snapshot["recipients"][0]["attempts"][0]["transcript_turns"].append(
            turn("user", HOSTILE_TEXT, 30)
        )
        return snapshot

    SCRIPTS["clean_identity"] = hostile
    fake_state.queue(request.idempotency_key, "clean_identity")
    try:
        outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
        live.reconcile(outcome.attempt_id)
    finally:
        SCRIPTS["clean_identity"] = original

    row = live.store.attempt(outcome.attempt_id)
    stored = (row["structured_result"] or "") + (row["transcript"] or "")
    assert "\x00" not in stored and "\x07" not in stored
    assert "‮" not in stored  # bidirectional override
    assert "​" not in stored  # zero width


def test_2_provider_summary_and_evidence_are_never_persisted_at_all():
    """The strongest form of "do not persist raw provider text": no column."""
    schema = (SOURCE / "store.py").read_text(encoding="utf-8")
    columns = schema[schema.index("CREATE TABLE IF NOT EXISTS call_attempts") :]
    columns = columns[: columns.index(");")]
    assert "summary" not in columns
    assert "evidence" not in columns


def test_2_every_stored_free_text_field_goes_through_a_cleaner():
    """Grep the persistence path: no raw provider value reaches update_attempt."""
    text = (SOURCE / "orchestrator.py").read_text(encoding="utf-8")
    block = text[text.index("def _store_result") : text.index("# ------------------------------------------------------- applying results")]
    for field in ("disposition_reason=", "failure_code="):
        line = next(l for l in block.splitlines() if field in l)
        assert "clean_text(" in line, field
    assert "to_json(_clean_result(result))" in block
    assert "clean_transcript_turns(" in block


def test_2_templates_autoescape_so_displayed_text_is_escaped():
    templates = Jinja2Templates(directory=str(TEMPLATES))
    rendered = templates.env.from_string("{{ x }}").render(x="<script>alert(1)</script>")
    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered


def test_2_no_template_disables_escaping():
    for path in TEMPLATES.glob("*.html"):
        text = path.read_text(encoding="utf-8")
        assert "|safe" not in text, path.name
        assert "autoescape false" not in text, path.name


def test_2_csv_exports_neutralise_formulas_and_strip_control_characters(live):
    from reachable import exports

    live.start_contact_check()
    live.store.set_contact_health(
        "C-2088",
        pupil_id="P-1041",
        status=ContactHealth.WRONG_PERSON.value,
        reason="=cmd|'/c calc'!A1\x00",
        source="test",
    )
    text = exports.suggested_contact_changes(live.store, live.dataset)
    assert "'=cmd" in text
    assert "\x00" not in text


def test_2_a_needs_human_result_is_not_persisted_as_a_usable_result(live, fake_state):
    """A result that failed validation is not stored as though it were good."""
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "schema_invalid")
    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)
    row = live.store.attempt(outcome.attempt_id)
    assert row["structured_result"] is None
    assert row["disposition"] == Disposition.RESULT_INVALID.value


# ===========================================================================
# 3. Result binding, and human-reviewed high-stakes interpretation
# ===========================================================================


def intent(**overrides) -> Intent:
    base = dict(
        call_id="call_1",
        idempotency_key="reachable:abc",
        destination=DEST,
        pupil_ref="P-1041",
        contact_ref="C-2090",
        workflow="contact_check",
    )
    base.update(overrides)
    return Intent(**base)


def metadata(**overrides) -> dict:
    base = {
        "pupil_ref": "P-1041",
        "contact_ref": "C-2090",
        "workflow": "contact_check",
        "idempotency_key": "reachable:abc",
    }
    base.update(overrides)
    return base


@pytest.mark.parametrize(
    "broken",
    [
        {"call_id": "call_other"},
        {"destination": "+447700900999"},
        {"pupil_ref": "P-9999"},
        {"contact_ref": "C-9999"},
        {"idempotency_key": "reachable:other"},
        {"workflow": "pattern_followup"},
    ],
)
def test_3_every_binding_field_must_match_or_the_result_is_unusable(broken):
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["id"] = "call_1"
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(**broken),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.NEEDS_HUMAN
    assert contact_check_event(result) is cc.CCEvent.RESULT_NEEDS_HUMAN


def test_3_a_generic_yes_with_no_recipient_turn_never_verifies():
    """The headline case. Schema-valid, confident, and still not evidence."""
    snapshot = SCRIPTS["identity_only_in_bot_turn"](DEST, metadata())
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(call_id=snapshot["id"]),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.CONFIRMED  # schema and confidence pass
    assert contact_check_event(result) is cc.CCEvent.RESULT_NEEDS_HUMAN  # still not verified


@pytest.mark.parametrize("speaker", ["bot", "unknown"])
def test_3_only_a_recipient_spoken_turn_counts_as_evidence(speaker):
    attempt = {"phone": DEST, "transcript_turns": [turn(speaker, "Yes, speaking.", 3)]}
    assert not gather_evidence(attempt).identity_confirmed


def test_3_an_unbound_result_never_triggers_a_safeguarding_action(live, fake_state):
    """An escalation requires a bound call, not merely an alarming payload."""
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)

    original = SCRIPTS["urgent_did_not_know"]

    def unbound(destination, metadata_in):
        snapshot = original(destination, metadata_in)
        snapshot["metadata"]["pupil_ref"] = "P-SOMEBODY-ELSE"
        return snapshot

    SCRIPTS["urgent_did_not_know"] = unbound
    fake_state.queue(request.idempotency_key, "urgent_did_not_know")
    try:
        outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
        live.reconcile(outcome.attempt_id)
    finally:
        SCRIPTS["urgent_did_not_know"] = original

    assert live.store.case(IVY_CASE)["state"] == PatternState.PF_NEEDS_HUMAN.value
    assert not any(t["kind"] == "safeguarding" for t in live.store.tasks())


def test_3_an_attendance_reason_is_a_suggestion_that_a_human_approves(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_reason_only")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    from reachable import exports

    rows = exports.suggested_register_reasons(live.store, live.dataset)
    assert "approved_by_staff" in rows
    assert rows.strip().splitlines()[1].endswith(",no")


def test_3_nothing_in_the_app_can_write_an_attendance_code():
    """No register writer exists to be called."""
    for path in SOURCE.rglob("*.py"):
        text = path.read_text(encoding="utf-8").lower()
        for forbidden in ("def write_register", "def set_attendance", "def record_code"):
            assert forbidden not in text, path.name


def test_3_the_urgent_rule_is_evaluated_before_any_other_result_branch():
    """A call carrying both a reason and an unaware contact escalates."""
    snapshot = call_task(
        "call_1",
        destination=DEST,
        metadata=metadata(workflow="pattern_followup"),
        structured_result={
            "outcome": "reached",
            "identity_confirmed": "yes",
            "aware_of_absence": "no",          # the alarm
            "reason_category": "illness",       # and a perfectly good reason
            "reason_note": "Unwell.",
            "barrier_mentioned": "no",
            "barrier_note": "",
            "wants_call_from_attendance_officer": "no",
            "knows_child_whereabouts": "yes",
            "verbatim_quotes": ["Speaking, yes."],
        },
        transcript_turns=[turn("user", "Speaking, yes.", 3)],
    )
    result = classify(
        snapshot,
        workflow=Workflow.PATTERN_FOLLOWUP,
        intent=intent(workflow="pattern_followup"),
        confidence_floor=0.6,
    )
    assert pattern_event(result) is pf.PFEvent.RESULT_URGENT


# ===========================================================================
# 4. Strict ASCII E.164 before any live call
# ===========================================================================


def test_4_an_invalid_number_cannot_survive_import(live):
    assert all(c.contact_id != "C-2131" for c in live.dataset.contacts)


def test_4_the_guard_rechecks_the_destination_immediately_before_dialling():
    """Not only at import: guard 8 runs on the stored value at dial time."""
    text = (SOURCE / "policy.py").read_text(encoding="utf-8")
    block = text[text.index("def evaluate(") : text.index("def _inside_window")]
    assert "is_e164(contact.phone_e164)" in block
    assert "INVALID_DESTINATION" in block


def test_4_a_non_ascii_number_never_reaches_a_transport(live, fake_client):
    """Unicode digits are refused, not normalised into something dialable."""
    from dataclasses import replace

    live.scan_register()
    contact = next(c for c in live.dataset.contacts if c.contact_id == "C-2089")
    hostile = replace(contact, phone_e164="+٤٤٧٧٠٠٩٠٠٣٧٧")
    live.dataset.contacts = [
        hostile if c.contact_id == "C-2089" else c for c in live.dataset.contacts
    ]

    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert not outcome.placed
    assert outcome.reason is NoCallReason.INVALID_DESTINATION
    assert fake_client.state.requests == []


def test_4_the_live_contact_command_validates_before_writing(tmp_path, capsys):
    from reachable.cli import main

    (tmp_path / "contacts.csv").write_text(
        "contact_id,pupil_id,contact_order,contact_name,relationship,phone_e164,"
        "language,is_emergency_contact,do_not_call\n"
        "C-2090,P-1041,2,Martin Dunn,Grandfather,+447700900218,English,Y,N\n",
        encoding="utf-8",
    )
    code = main(
        ["live-contact", "--contact", "C-2090", "--number", "07911123456",
         "--data-dir", str(tmp_path), "--yes"]
    )
    assert code == 2
    assert "+447700900218" in (tmp_path / "contacts.csv").read_text(encoding="utf-8")


def test_4_no_transport_is_reachable_without_passing_the_guards():
    """place_call is the only caller of client.create, and it evaluates first."""
    callers = []
    for path in SOURCE.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "self.client.create(" in text or ".client.create(" in text:
            callers.append(path.name)
    assert callers == ["orchestrator.py"]

    text = (SOURCE / "orchestrator.py").read_text(encoding="utf-8")
    place = text[text.index("def place_call") : text.index("def _reserve")]
    reserve = text[text.index("def _reserve") : text.index("def _refuse")]

    # place_call reserves before it dials, and nothing else.
    assert place.index("self._reserve(") < place.index("self.client.create(")

    # The reservation itself evaluates the guards, then reserves the key, then
    # writes the attempt row -- and never touches a transport.
    assert reserve.index("policy.evaluate(") < reserve.index("reserve_key(")
    assert reserve.index("reserve_key(") < reserve.index("create_attempt(")
    assert "client.create" not in reserve


def test_4_the_dry_run_client_raises_rather_than_silently_not_dialling():
    from reachable.calls.client import CallError, CallRequest

    with pytest.raises(CallError):
        DryRunClient().create(
            CallRequest(task="t", result_schema={}, destination=DEST, idempotency_key="k")
        )


# ===========================================================================
# Retention, which SAFETY.md documents and which must actually run
# ===========================================================================


def test_retention_actually_deletes_transcripts_and_keeps_the_outcome(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "clean_identity")
    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    live.store.execute(
        "UPDATE call_attempts SET created_at = '2020-01-01T00:00:00+00:00' WHERE id = ?",
        (outcome.attempt_id,),
    )
    assert live.purge_expired_transcripts() == 1

    row = live.store.attempt(outcome.attempt_id)
    assert row["transcript"] is None
    assert row["disposition"] == Disposition.CONFIRMED.value
    assert row["structured_result"] is not None


def test_retention_runs_at_dashboard_startup():
    text = (SOURCE / "web" / "app.py").read_text(encoding="utf-8")
    assert "purge_expired_transcripts()" in text


# ===========================================================================
# Idempotency: one authorisation, one call -- and a retry is a new authorisation
# ===========================================================================


def test_retrying_one_authorisation_always_reuses_the_same_key():
    """A timeout, a crash or a replay must never dial twice."""
    from reachable.policy import idempotency_key

    first = idempotency_key(
        Workflow.CONTACT_CHECK,
        pupil_id="P-1041",
        contact_id="C-2088",
        scope="2026-autumn",
        authorisation=1,
    )
    again = idempotency_key(
        Workflow.CONTACT_CHECK,
        pupil_id="P-1041",
        contact_id="C-2088",
        scope="2026-autumn",
        authorisation=1,
    )
    assert first == again


def test_a_new_authorisation_is_a_new_key():
    from reachable.policy import idempotency_key

    def key(**over):
        base = dict(
            pupil_id="P-1041", contact_id="C-2088", scope="2026-autumn", authorisation=1
        )
        base.update(over)
        return idempotency_key(Workflow.CONTACT_CHECK, **base)

    assert key() != key(authorisation=2)
    assert key() != key(contact_id="C-2089")
    assert key() != key(scope="2027-spring")


def test_an_authorisation_ordinal_below_one_is_refused():
    from reachable.policy import idempotency_key

    with pytest.raises(ValueError):
        idempotency_key(
            Workflow.CONTACT_CHECK,
            pupil_id="P",
            contact_id="C",
            scope="s",
            authorisation=0,
        )


def test_voicemail_then_a_retry_dials_once_more_and_then_stops(live, fake_state):
    """The transition the docs promise, now reachable, and still capped."""
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"

    first, *_ = live.build_request(case_id)
    fake_state.queue(first.idempotency_key, "voicemail")
    one = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(one.attempt_id)
    assert live.store.case(case_id)["state"] == "CC_READY"

    second, *_ = live.build_request(case_id)
    assert second.idempotency_key != first.idempotency_key
    fake_state.queue(second.idempotency_key, "clean_identity")
    two = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert two.placed
    live.reconcile(two.attempt_id)
    assert live.store.case(case_id)["state"] == "CC_VERIFIED"

    third = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert not third.placed
    assert third.reason is NoCallReason.ATTEMPT_BUDGET_SPENT


def test_the_key_is_stable_across_a_preview_and_the_dial_it_previews(live):
    """What the office is shown is what gets reserved."""
    live.scan_register()
    preview = live.preview(IVY_CASE)
    request, *_ = live.build_request(IVY_CASE)
    assert preview.idempotency_key == request.idempotency_key


def test_the_test_suite_never_reads_a_real_env_file():
    """Wiring python-dotenv must not let `pytest` pick up real credentials.

    An autouse fixture sets REACHABLE_SKIP_ENV_FILE, so a developer with a live
    key in .env cannot place a real call by running the suite.
    """
    import os

    from reachable.config import load_env_file

    assert os.environ.get("REACHABLE_SKIP_ENV_FILE") == "1"
    assert load_env_file() is None
    assert Config.from_env().calle_api_key == ""
    assert Config.from_env().live_calls is False
