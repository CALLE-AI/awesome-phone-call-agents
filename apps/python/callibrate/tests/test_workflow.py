"""The whole loop, and what it leaves behind when it goes wrong.

The property under test throughout is transactional: after any outcome, the
database is in exactly one of two states — the verification happened and every
part of it is recorded, or it did not and nothing moved.
"""

from __future__ import annotations

import pytest

from callibrate.calling.base import VerificationCaller
from callibrate.calling.models import CallError, CallOutcome
from callibrate.calling.pilot import PilotLineCaller
from callibrate.config import Settings
from callibrate.evidence.reconcile import build_evidence
from callibrate.evidence.transcript import normalize_turns
from callibrate.store import Store
from callibrate.verification import VerificationWorkflow
from tests.conftest import turns


def hours(store: Store, service_id: str = "svc_food") -> str:
    service = store.service(service_id)
    return f"{service['byday']} {service['opens_at']}-{service['closes_at']}"


async def run(store: Store, settings: Settings, task="task_food", scenario="hours_changed"):
    return await VerificationWorkflow(store, settings).run(task, pilot_scenario=scenario)


@pytest.mark.asyncio
async def test_a_confirmed_change_is_applied_and_recorded(store, settings):
    before = hours(store)
    result = await run(store, settings)
    assert result["authority"] == "APPLY"
    assert hours(store) == "WE 10:00-13:00" != before
    assert store.verify_audit_chain()
    ledger = [event["event_type"] for event in store.audit_events()]
    assert "change.auto_applied" in ledger
    assert "verification.completed" in ledger


@pytest.mark.asyncio
async def test_an_unchanged_record_is_only_re_dated(store, settings):
    before = hours(store)
    result = await run(store, settings, scenario="confirmed")
    assert result["authority"] == "REFRESH"
    assert hours(store) == before
    assert store.service("svc_food")["age_days"] == 0


@pytest.mark.asyncio
async def test_a_closure_never_touches_the_record(store, settings):
    before = hours(store)
    result = await run(store, settings, scenario="program_closed")
    assert result["authority"] == "REVIEW"
    assert hours(store) == before
    assert store.service("svc_food")["status"] == "active"
    assert any(item["field_name"] == "status" for item in store.decisions())


@pytest.mark.asyncio
async def test_an_uncertain_answer_reaches_a_curator_with_the_reason(store, settings):
    result = await run(store, settings, scenario="uncertain_volunteer")
    assert result["authority"] == "REVIEW"
    pending = [item for item in store.decisions() if item["service_id"] == "svc_food"]
    assert pending and pending[0]["new_value"] == "WE 10:00-13:00"
    assert pending[0]["reason"]


@pytest.mark.asyncio
async def test_a_stop_request_suppresses_the_whole_organization(store, settings):
    result = await run(store, settings, scenario="stop_calling")
    assert result["authority"] == "STOP"
    task = store.get_task("task_food")
    assert task["do_not_call"] == 1
    with pytest.raises(ValueError):
        await run(store, settings, scenario="confirmed")


@pytest.mark.asyncio
async def test_a_corrected_readback_does_not_publish(store, settings):
    before = hours(store)
    result = await run(store, settings, scenario="corrects_the_readback")
    assert result["authority"] == "REVIEW"
    assert hours(store) == before


@pytest.mark.asyncio
async def test_nobody_answering_reschedules_and_changes_nothing(store, settings):
    before = store.service("svc_food")["assured_date"]
    result = await run(store, settings, scenario="no_answer")
    assert result["status"] == "completed"
    task = store.get_task("task_food")
    assert task["status"] == "queued"
    assert task["scheduled_for"]
    assert task["attempts"] == 1
    assert store.service("svc_food")["assured_date"] == before
    assert not store.decisions() or all(
        item["service_id"] != "svc_food" for item in store.decisions()
    )


class ExplodingCaller(VerificationCaller):
    name = "exploding"
    is_live = False

    async def verify(self, contract):
        raise CallError("the carrier dropped the call")


@pytest.mark.asyncio
async def test_a_call_that_fails_leaves_the_record_and_the_queue_untouched(store, settings, monkeypatch):
    before = hours(store)
    workflow = VerificationWorkflow(store, settings)
    monkeypatch.setattr(workflow, "build_caller", lambda *args, **kwargs: ExplodingCaller())
    with pytest.raises(CallError):
        await workflow.run("task_food")
    assert hours(store) == before
    task = store.get_task("task_food")
    assert task["status"] == "queued"
    assert not any(item["service_id"] == "svc_food" for item in store.decisions())
    assert store.verify_audit_chain()
    failed = [run for run in store.call_runs_for_task("task_food")]
    assert failed and failed[0]["status"] == "failed"


class LyingCaller(VerificationCaller):
    """A caller that reports a confirmed change the transcript does not contain."""

    name = "lying"
    is_live = False

    async def verify(self, contract):
        return build_evidence(
            contract,
            turns=normalize_turns(
                turns(
                    ("bot", "This is an automated assistant about your opening hours."),
                    ("user", "Sorry, I really cannot help with that."),
                )
            ),
            caller=self.name,
            outcome=CallOutcome.COMPLETED,
            caller_result={"structured_result": {"schedule": "WE 10:00-13:00"}},
        )


@pytest.mark.asyncio
async def test_a_caller_that_asserts_an_unsupported_change_cannot_publish_it(store, settings, monkeypatch):
    """The single most important test in the repository.

    The caller says the hours changed and says it confirmed them. The transcript
    contains no such exchange. The record does not move, and the claim reaches a
    person with the reason attached.
    """
    before = hours(store)
    workflow = VerificationWorkflow(store, settings)
    monkeypatch.setattr(workflow, "build_caller", lambda *args, **kwargs: LyingCaller())
    result = await workflow.run("task_food")
    assert result["authority"] == "REVIEW"
    assert hours(store) == before
    pending = [item for item in store.decisions() if item["service_id"] == "svc_food"]
    assert pending[0]["confidence"] == 0.0
    assert "transcript" in pending[0]["evidence"]["note"]


@pytest.mark.asyncio
async def test_a_curator_approval_writes_through_the_same_validators(store, settings):
    await run(store, settings, scenario="program_closed")
    pending = next(item for item in store.decisions() if item["service_id"] == "svc_food")
    store.resolve_decision(pending["id"], "approve", "usr_judge", None, "confirmed by email")
    assert store.service("svc_food")["status"] == "inactive"
    assert store.verify_audit_chain()


@pytest.mark.asyncio
async def test_a_curator_edit_is_refused_when_it_is_malformed(store, settings):
    await run(store, settings, scenario="uncertain_volunteer")
    pending = next(item for item in store.decisions() if item["service_id"] == "svc_food")
    with pytest.raises(ValueError):
        store.resolve_decision(pending["id"], "edit", "usr_judge", "Wednesday mornings", "")
    assert hours(store) == "WE 09:00-12:00"


@pytest.mark.asyncio
async def test_the_pilot_line_is_unreachable_once_the_deployment_is_live(store, settings):
    live = settings.model_copy(update={"caller_mode": "calle"})
    workflow = VerificationWorkflow(store, live)
    caller = workflow.build_caller("call_1", pilot_scenario="hours_changed")
    assert not isinstance(caller, PilotLineCaller)
    assert caller.is_live


@pytest.mark.asyncio
async def test_a_live_call_to_a_number_off_the_allowlist_never_reaches_calle(store, settings):
    """No plan is created, no token is used, no telephone rings."""
    live = settings.model_copy(update={"caller_mode": "calle", "call_allowlist": "+15550109999"})
    workflow = VerificationWorkflow(store, live)
    with pytest.raises(ValueError, match="allowlist"):
        await workflow.run("task_food")
    assert store.get_task("task_food")["status"] == "queued"
    refusals = [
        event for event in store.audit_events() if event["event_type"] == "call.refused"
    ]
    assert refusals
