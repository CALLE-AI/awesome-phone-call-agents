"""Contracts, binding and dispositions, against the fake CALL-E server."""

from __future__ import annotations

import pytest

from fake_calle.scripts import SCRIPTS
from fake_calle.server import FakeCalleClient, FakeCalleState
from reachable.calls import contracts
from reachable.calls.binding import Intent, bind, gather_evidence, iter_attempts
from reachable.calls.client import CallRequest, call_task, turn
from reachable.calls.dispositions import (
    classify,
    contact_check_event,
    is_urgent,
    pattern_event,
)
from reachable.calls.dryrun_client import DryRunClient
from reachable.machines import contact_check as cc
from reachable.machines import pattern_followup as pf
from reachable.models import Disposition, Workflow

DEST = "+447700900218"

CONTACT_VALUES = {
    "school_name": "Fernhollow Primary School",
    "contact_name": "Martin Dunn",
    "pupil_first_name": "Ivy",
}
PATTERN_VALUES = {**CONTACT_VALUES, "attendance_officer_name": "Mrs Adeola Hart"}


def intent(call_id: str = "call_1", **overrides) -> Intent:
    base = dict(
        call_id=call_id,
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


# ------------------------------------------------------------------ contracts


def test_both_task_texts_disclose_and_gate_identity():
    for workflow, values in (
        (Workflow.CONTACT_CHECK, CONTACT_VALUES),
        (Workflow.PATTERN_FOLLOWUP, PATTERN_VALUES),
    ):
        task = contracts.render_task(workflow, values)
        assert task.startswith("You are an automated assistant calling on behalf of")
        assert "say plainly that you are not" in task
        assert "Before you say anything about any child" in task
        assert "Please call the school office" in task


def test_only_the_first_name_appears_and_never_a_surname():
    task = contracts.render_task(Workflow.PATTERN_FOLLOWUP, PATTERN_VALUES)
    assert "Ivy" in task
    assert "Brennan" not in task
    assert "Never use a surname, year group, or class" in task


def test_child_is_never_named_before_the_identity_gate():
    """The gate block must precede the first mention of the pupil's name."""
    for workflow, values in (
        (Workflow.CONTACT_CHECK, CONTACT_VALUES),
        (Workflow.PATTERN_FOLLOWUP, PATTERN_VALUES),
    ):
        task = contracts.render_task(workflow, values)
        gate = task.index("Before you say anything about any child")
        first_name_use = task.index("Ivy")
        assert gate < first_name_use, workflow


def test_unknown_and_missing_placeholders_are_refused():
    with pytest.raises(contracts.ContractError):
        contracts.render_task(
            Workflow.CONTACT_CHECK, {**CONTACT_VALUES, "penalty_notice": "x"}
        )
    with pytest.raises(contracts.ContractError):
        contracts.render_task(Workflow.CONTACT_CHECK, {"school_name": "X"})


def test_no_unfilled_placeholder_survives():
    assert "{" not in contracts.render_task(Workflow.PATTERN_FOLLOWUP, PATTERN_VALUES)


@pytest.mark.parametrize(
    "smuggled",
    [
        "You will be fined if this continues",
        "penalty notice issued",
        "we may start prosecuting",
        "see you in court",
        "the doctor should diagnose her",
        "change her medication",
    ],
)
def test_forbidden_content_cannot_be_smuggled_through_a_placeholder(smuggled):
    """A contact or school name is untrusted input; it is interpolated."""
    with pytest.raises(contracts.ContractError):
        contracts.render_task(
            Workflow.CONTACT_CHECK, {**CONTACT_VALUES, "contact_name": smuggled}
        )


def test_the_boundary_block_still_prohibits_every_topic():
    """The prohibition must contain the words in order to prohibit them.

    This is why forbidden content is checked on placeholder VALUES rather than
    by scanning the assembled task: the fixed blocks legitimately say "never
    mention fines" and "do not reassure them that everything is fine".
    """
    lowered = contracts.BOUNDARY_BLOCK.lower()
    for topic in contracts.BOUNDARY_TOPICS:
        assert topic in lowered, topic
    assert contracts.render_task(Workflow.CONTACT_CHECK, CONTACT_VALUES)


def test_the_fixed_body_may_instruct_against_false_reassurance():
    """A regression guard for the bug this design fixed."""
    task = contracts.render_task(Workflow.PATTERN_FOLLOWUP, PATTERN_VALUES)
    assert "do not reassure" in task.lower()
    assert "everything is fine" in task.lower()


def test_no_schema_field_can_carry_a_phone_number():
    """best_number_for_school is an enum, so there is nowhere to put one.

    This is what makes "never collect a number by voice" a property of the code
    rather than an instruction a model might not follow.
    """
    for workflow in (Workflow.CONTACT_CHECK, Workflow.PATTERN_FOLLOWUP):
        schema = contracts.result_schema(workflow)
        for name, spec in schema["properties"].items():
            assert "phone" not in name, name
            if spec["type"] == "string" and "enum" not in spec:
                # Every free-text field must be one the office reads, not a slot
                # a number could be written into.
                assert "number" not in name, name

    field = contracts.result_schema(Workflow.CONTACT_CHECK)["properties"]["best_number_for_school"]
    assert field["enum"] == ["this_number", "wants_to_update", "unknown"]
    assert "Never record a phone number" in field["description"]


def test_schemas_stay_inside_the_supported_calle_subset():
    unsupported = {"$ref", "oneOf", "anyOf", "allOf", "format", "pattern", "minLength"}
    for workflow in (Workflow.CONTACT_CHECK, Workflow.PATTERN_FOLLOWUP):
        rendered = repr(contracts.result_schema(workflow))
        for keyword in unsupported:
            assert keyword not in rendered
        assert contracts.result_schema(workflow)["additionalProperties"] is False


def test_no_reserved_recipient_field_names_are_reused():
    for workflow in (Workflow.CONTACT_CHECK, Workflow.PATTERN_FOLLOWUP):
        props = set(contracts.result_schema(workflow)["properties"])
        assert not (props & contracts.RESERVED_RESULT_FIELDS)


def test_every_decision_field_is_an_enum_carrying_unknown():
    for workflow in (Workflow.CONTACT_CHECK, Workflow.PATTERN_FOLLOWUP):
        for name, spec in contracts.result_schema(workflow)["properties"].items():
            assert spec["type"] != "boolean", name
            if "enum" in spec and name != "outcome":
                assert "unknown" in spec["enum"], name


# -------------------------------------------------------------------- binding


def test_a_clean_call_binds():
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["id"] = "call_1"
    assert bind(snapshot, intent()).ok


@pytest.mark.parametrize(
    ("field", "value", "fragment"),
    [
        ("call_id", "call_other", "call id"),
        ("destination", "+447700900999", "destination"),
        ("pupil_ref", "P-9999", "pupil_ref"),
        ("contact_ref", "C-9999", "contact_ref"),
        ("idempotency_key", "reachable:different", "idempotency key"),
        ("workflow", "pattern_followup", "workflow"),
    ],
)
def test_every_binding_field_is_checked(field, value, fragment):
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["id"] = "call_1"
    result = bind(snapshot, intent(**{field: value}))
    assert not result.ok
    assert fragment in result.reason_text


def test_all_mismatches_are_reported_not_just_the_first():
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["id"] = "call_other"
    result = bind(snapshot, intent(pupil_ref="P-9999"))
    assert len(result.reasons) >= 2


def test_transcript_turns_are_read_from_the_nested_attempt_shape():
    """They live at recipients[].attempts[].transcript_turns, not top level."""
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    attempts = iter_attempts(snapshot)
    assert len(attempts) == 1
    assert attempts[0]["phone"] == DEST
    assert any(t["speaker"] == "user" for t in attempts[0]["transcript_turns"])
    assert "transcript" not in snapshot  # deliberately not the old flat shape


def test_identity_needs_a_turn_the_recipient_actually_spoke():
    clean = SCRIPTS["clean_identity"](DEST, metadata())
    assert gather_evidence(iter_attempts(clean)[0]).identity_confirmed

    bot_only = SCRIPTS["identity_only_in_bot_turn"](DEST, metadata())
    evidence = gather_evidence(iter_attempts(bot_only)[0])
    assert not evidence.identity_confirmed
    assert evidence.recipient_turn_count == 0


def test_an_unknown_speaker_is_not_evidence():
    attempt = {
        "phone": DEST,
        "transcript_turns": [turn("unknown", "yes, speaking", 3)],
    }
    assert not gather_evidence(attempt).identity_confirmed


def test_a_bot_turn_containing_yes_is_not_evidence():
    attempt = {"phone": DEST, "transcript_turns": [turn("bot", "Yes, thank you.", 1)]}
    assert not gather_evidence(attempt).identity_confirmed


def test_an_empty_transcript_is_not_evidence():
    assert not gather_evidence({"phone": DEST, "transcript_turns": []}).identity_confirmed
    assert not gather_evidence(None).identity_confirmed


def test_a_denial_is_detected_and_is_not_confirmation():
    wrong = SCRIPTS["wrong_person"](DEST, metadata())
    evidence = gather_evidence(iter_attempts(wrong)[0])
    assert not evidence.identity_confirmed


# --------------------------------------------------------------- dispositions


def classify_script(name: str, *, workflow=Workflow.CONTACT_CHECK, floor=0.6, **kw):
    snapshot = SCRIPTS[name](DEST, metadata(**kw.pop("metadata_overrides", {})))
    call_id = snapshot["id"]
    return classify(
        snapshot,
        workflow=workflow,
        intent=intent(call_id, workflow=workflow.value,
                      **{k: v for k, v in kw.items() if k != "metadata_overrides"}),
        confidence_floor=floor,
    )


def test_clean_call_is_confirmed():
    assert classify_script("clean_identity").disposition is Disposition.CONFIRMED


def test_low_confidence_score_beats_an_acceptable_label():
    """Score 0.31 with label 'medium'. Checking only the label accepts it."""
    result = classify_script("low_confidence")
    assert result.disposition is Disposition.REVIEW_REQUIRED
    assert "0.31" in result.reason


def test_schema_invalid_is_result_invalid():
    assert classify_script("schema_invalid").disposition is Disposition.RESULT_INVALID


def test_unbound_result_is_needs_human():
    snapshot = SCRIPTS["clean_identity"](DEST, metadata(pupil_ref="P-OTHER"))
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(snapshot["id"]),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.NEEDS_HUMAN


def test_uppercase_cli_status_is_rejected():
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["status"] = "NO_ANSWER"
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(snapshot["id"]),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.NEEDS_HUMAN
    assert "status" in result.reason


def test_non_terminal_is_outcome_unknown_not_a_failure():
    snapshot = call_task("call_1", status="in_progress", structured_result=None, destination=DEST)
    result = classify(
        snapshot, workflow=Workflow.CONTACT_CHECK, intent=intent(), confidence_floor=0.6
    )
    assert result.disposition is Disposition.OUTCOME_UNKNOWN


def test_failure_code_is_logged_verbatim_never_branched_on():
    snapshot = call_task(
        "call_1", status="failed", structured_result=None, failure_code="carrier_x9",
        destination=DEST, metadata=metadata(),
    )
    result = classify(
        snapshot, workflow=Workflow.CONTACT_CHECK, intent=intent(), confidence_floor=0.6
    )
    assert result.disposition is Disposition.FAILED
    assert "carrier_x9" in result.reason


def test_null_structured_result_on_a_completed_call_is_review_required():
    snapshot = call_task("call_1", structured_result=None, destination=DEST, metadata=metadata())
    result = classify(
        snapshot, workflow=Workflow.CONTACT_CHECK, intent=intent(), confidence_floor=0.6
    )
    assert result.disposition is Disposition.REVIEW_REQUIRED


# ------------------------------------------------- disposition -> machine event


def test_contact_check_events():
    assert contact_check_event(classify_script("clean_identity")) is cc.CCEvent.RESULT_VERIFIED
    assert contact_check_event(classify_script("wrong_person")) is cc.CCEvent.RESULT_WRONG_PERSON
    assert (
        contact_check_event(classify_script("not_in_service")) is cc.CCEvent.RESULT_NOT_IN_SERVICE
    )
    assert contact_check_event(classify_script("voicemail")) is cc.CCEvent.RESULT_NO_CONTACT
    assert contact_check_event(classify_script("no_answer")) is cc.CCEvent.RESULT_NO_CONTACT
    assert contact_check_event(classify_script("schema_invalid")) is cc.CCEvent.RESULT_NEEDS_HUMAN
    assert contact_check_event(classify_script("low_confidence")) is cc.CCEvent.RESULT_NEEDS_HUMAN


def test_identity_claimed_only_by_the_bot_never_verifies():
    """The headline case for requirement 3."""
    result = classify_script("identity_only_in_bot_turn")
    assert result.disposition is Disposition.CONFIRMED  # schema-valid and confident
    # ...but it still cannot verify, because nothing the recipient said backs it.
    assert contact_check_event(result) is cc.CCEvent.RESULT_NEEDS_HUMAN


def test_a_language_note_overrides_a_success():
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["structured_result"]["language_preference_note"] = "Prefers Polish"
    result = classify(
        snapshot, workflow=Workflow.CONTACT_CHECK, intent=intent(snapshot["id"]),
        confidence_floor=0.6,
    )
    assert contact_check_event(result) is cc.CCEvent.RESULT_NEEDS_HUMAN


def test_pattern_urgent_beats_everything():
    result = classify_script(
        "urgent_did_not_know",
        workflow=Workflow.PATTERN_FOLLOWUP,
        metadata_overrides={"workflow": "pattern_followup"},
    )
    assert pattern_event(result) is pf.PFEvent.RESULT_URGENT


def test_pattern_support_and_reason():
    support = classify_script(
        "pattern_support",
        workflow=Workflow.PATTERN_FOLLOWUP,
        metadata_overrides={"workflow": "pattern_followup"},
    )
    assert pattern_event(support) is pf.PFEvent.RESULT_SUPPORT_REQUESTED

    reason = classify_script(
        "pattern_reason_only",
        workflow=Workflow.PATTERN_FOLLOWUP,
        metadata_overrides={"workflow": "pattern_followup"},
    )
    assert pattern_event(reason) is pf.PFEvent.RESULT_REASON_GIVEN


@pytest.mark.parametrize(
    ("aware", "whereabouts", "urgent"),
    [
        ("yes", "yes", False),
        ("yes", "unknown", False),   # secondary signal, never established
        ("yes", "no", True),         # explicit "I don't know where he is"
        ("no", "yes", True),
        ("unknown", "yes", True),    # awareness escalates on unknown
        ("unknown", "unknown", True),
        ("no", "no", True),
    ],
)
def test_the_escalation_rule_is_asymmetric(aware, whereabouts, urgent):
    result = {"aware_of_absence": aware, "knows_child_whereabouts": whereabouts}
    assert is_urgent(result) is urgent


# ---------------------------------------------------------------- dry run


def test_the_dry_run_client_never_dials():
    from reachable.calls.client import CallError

    client = DryRunClient()
    request = CallRequest(
        task="say hello",
        result_schema={},
        destination=DEST,
        idempotency_key="reachable:abc",
    )
    with pytest.raises(CallError):
        client.create(request)


def test_the_preview_masks_the_destination():
    client = DryRunClient()
    preview = client.preview(
        CallRequest(
            task=contracts.render_task(Workflow.CONTACT_CHECK, CONTACT_VALUES),
            result_schema=contracts.result_schema(Workflow.CONTACT_CHECK),
            destination=DEST,
            idempotency_key="reachable:abc",
        )
    )
    assert preview.masked_destination == "…218"
    assert DEST not in preview.as_text()
    assert "automated assistant" in preview.as_text()


# ------------------------------------------------------------ fake transport


def test_reusing_a_key_returns_the_original_call():
    client = FakeCalleClient(FakeCalleState())
    request = CallRequest(
        task="t", result_schema={}, destination=DEST, idempotency_key="reachable:same"
    )
    first = client.create(request)
    second = client.create(request)
    assert first.call_id == second.call_id
    assert len(client.state.requests) == 1


def test_a_deferred_script_reads_non_terminal_first_then_completes():
    state = FakeCalleState()
    state.queue("reachable:slow", "timeout_then_complete")
    client = FakeCalleClient(state)
    handle = client.create(
        CallRequest(task="t", result_schema={}, destination=DEST,
                    idempotency_key="reachable:slow")
    )
    assert client.get(handle.call_id)["status"] == "in_progress"
    assert client.get(handle.call_id)["status"] == "completed"


def test_submission_can_be_made_unknown():
    from reachable.calls.client import CallSubmissionUnknown

    state = FakeCalleState()
    state.fail_submission = "unknown"
    client = FakeCalleClient(state)
    with pytest.raises(CallSubmissionUnknown):
        client.create(
            CallRequest(task="t", result_schema={}, destination=DEST, idempotency_key="k")
        )


def test_every_script_produces_the_contract_shape():
    for name, builder in SCRIPTS.items():
        snapshot = builder(DEST, metadata())
        assert set(snapshot) >= {
            "id", "object", "status", "task", "recipients", "structured_result",
            "summary", "task_completed", "completion_confidence", "evidence",
            "metadata", "failure_code", "failure_message", "created_at", "completed_at",
        }, name
        attempts = iter_attempts(snapshot)
        assert attempts and attempts[0]["phone"] == DEST, name
        for t in attempts[0]["transcript_turns"]:
            assert t["speaker"] in {"bot", "user", "unknown"}, name


# ---------------------------------------------------------------------------
# task_completed False with a clear non-contact outcome
#
# Observed on a live call: CALL-E returned status "completed", task_completed
# False, and a schema-valid structured_result whose outcome was "no_answer".
# Before this, the classifier read task_completed first, so every unanswered
# call became NEEDS_HUMAN -- the cascade never advanced to the next contact and
# the attempt budget never engaged.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("script", ["no_answer", "voicemail", "not_in_service"])
def test_the_no_contact_scripts_report_the_task_as_not_completed(script):
    """The fake tracks the live API here, or these tests prove nothing."""
    assert SCRIPTS[script](DEST, metadata())["task_completed"] is False


@pytest.mark.parametrize("script", ["no_answer", "voicemail", "not_in_service"])
def test_a_non_contact_outcome_is_read_even_when_the_task_did_not_complete(script):
    """Nobody picked up *is* the task completing, in the only way it could."""
    snapshot = SCRIPTS[script](DEST, metadata())
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(snapshot["id"]),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.CONFIRMED
    assert script in result.reason
    assert contact_check_event(result) is not cc.CCEvent.RESULT_NEEDS_HUMAN


def test_the_cascade_advances_on_an_incomplete_no_answer():
    """The point of the relaxation: the case moves on instead of queueing."""
    meta = metadata(workflow="pattern_followup")
    snapshot = SCRIPTS["no_answer"](DEST, meta)
    result = classify(
        snapshot,
        workflow=Workflow.PATTERN_FOLLOWUP,
        intent=intent(snapshot["id"], workflow="pattern_followup"),
        confidence_floor=0.6,
    )
    assert pattern_event(result) is pf.PFEvent.RESULT_NO_CONTACT


def test_an_incomplete_reached_result_still_needs_a_human():
    """The relaxation is narrow. A conversation that did not finish is not a fact."""
    snapshot = SCRIPTS["clean_identity"](DEST, metadata())
    snapshot["task_completed"] = False
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(snapshot["id"]),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.REVIEW_REQUIRED
    assert contact_check_event(result) is cc.CCEvent.RESULT_NEEDS_HUMAN


def test_an_incomplete_malformed_non_contact_result_still_needs_a_human():
    """A result that fails its own schema never takes the relaxed path."""
    snapshot = call_task(
        "call_1",
        destination=DEST,
        metadata=metadata(),
        task_completed=False,
        structured_result={"outcome": "no_answer"},
    )
    result = classify(
        snapshot,
        workflow=Workflow.CONTACT_CHECK,
        intent=intent(),
        confidence_floor=0.6,
    )
    assert result.disposition is Disposition.REVIEW_REQUIRED
