"""Defects found by adversarial review, each with the case that used to fail.

Every test here maps to a bug that was real in this codebase, reproduced before it was
fixed. They are grouped in one file so the fix and the evidence stay together.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from positive_contact.adjudicate import adjudicate, judge_b_transcript
from positive_contact.cli import _resolve_now, build_parser, execute_run, seed_ledger
from positive_contact.config import ConfigError, RunMode, load_settings
from positive_contact.dispatch import LiveCallBudget, dispatch_intent
from positive_contact.escalate import build_intent
from positive_contact.models import (
    Acknowledged,
    ContactType,
    DispositionKind,
    IntentState,
    LadderTarget,
)
from positive_contact.preflight import run_preflight
from positive_contact.redact import find_raw_e164, mask_e164, redact_free_text
from positive_contact.script import SCHEMA_VERSION, TASK_VERSION
from positive_contact.transports.base import CallSnapshot, TranscriptTurn
from positive_contact.transports.fixture import FixtureTransport
from tests.conftest import SCENARIOS

NOTICE = (
    "Power at the 1200 block of Elm St may be turned off starting Friday to reduce "
    "wildfire risk. Can you confirm that you heard it?"
)


def snapshot(user_text: str, *, result: dict | None = None) -> CallSnapshot:
    turns = (
        TranscriptTurn(index=0, speaker="bot", text=NOTICE, offset_seconds=0),
        TranscriptTurn(index=1, speaker="user", text=user_text, offset_seconds=7),
    )
    return CallSnapshot(
        call_id="call_test",
        status="completed",
        task_completed=True,
        confidence_score=0.95,
        confidence_label="high",
        recipient_result=result
        or {"contact_type": "live_person", "acknowledged": "yes", "needs_assistance": "none"},
        recipient_status="completed",
        transcript_turns=turns,
        metadata={},
        raw={},
    )


# -- a contracted denial was read as an acknowledgement ---------------------------
#
# NEGATION_PATTERNS held r"\bn'?t\b". The leading word boundary makes that unmatchable
# inside "didn't": the character before the "n" is a word character. Every contracted
# denial was therefore invisible to Judge B, and a turn that both denied hearing the
# notice and contained a lexicon word confirmed the contact, storing the denial as the
# supporting evidence.


@pytest.mark.parametrize(
    "denial",
    [
        "That isn't correct.",
        "I couldn't hear a word. Correct?",
        "Sorry, I didn't get any of that, is that correct?",
        "No, I haven't heard anything, is that right?",
        "I can't understand you. Yes? Hello?",
        "We weren't told anything about that. Correct?",
    ],
)
def test_a_contracted_denial_is_never_an_acknowledgement(denial):
    disposition = adjudicate(snapshot(denial), intent_id="int:test")
    assert disposition.disposition is not DispositionKind.CONFIRMED, denial


@pytest.mark.parametrize(
    "denial,plain",
    [
        ("That isn't correct.", "That is not correct."),
        ("I couldn't hear a word. Correct?", "I could not hear a word. Correct?"),
        ("I didn't get that, correct?", "I did not get that, correct?"),
    ],
)
def test_a_contraction_and_its_expansion_adjudicate_the_same(denial, plain):
    """Two ways of saying the same sentence must not reach opposite dispositions."""
    assert (
        adjudicate(snapshot(denial), intent_id="i").disposition
        is adjudicate(snapshot(plain), intent_id="i").disposition
    )


@pytest.mark.parametrize(
    "acknowledgement",
    [
        "Yes, I heard you.",
        "Yes, I heard you, but I don't have a car to get there.",
        "I want to confirm that, yes.",
        "That's correct, I got the message.",
    ],
)
def test_a_genuine_acknowledgement_still_confirms(acknowledgement):
    """The negation fix must not swallow real confirmations.

    "want" ends in "nt", so a pattern without the apostrophe would have broken these.
    """
    disposition = adjudicate(snapshot(acknowledgement), intent_id="int:test")
    assert disposition.disposition is DispositionKind.CONFIRMED, acknowledgement


# -- an answering machine could be confirmed, quoting its own greeting -------------
#
# The voicemail lexicon only covered a handful of phrasings. A greeting outside it that
# happened to contain a word from the acknowledgement lexicon ("Hi, yes, this is the
# Smith family, we're not home") was read as a live person acknowledging the notice.


@pytest.mark.parametrize(
    "greeting",
    [
        "Hi, yes, this is the Smith family. We're not home right now. Please leave your name and number.",
        "Yes, you have reached the Smith residence, nobody is here, leave a message.",
        "Yes! We can't come to the phone. We'll get back to you.",
        "Hello, yes, no one is available. Please try again later.",
        "You have reached the voicemail of this number. Please leave a message after the tone.",
        "Yes, we are not available. Record your message at the sound of the tone.",
    ],
)
def test_a_machine_greeting_is_never_confirmed(greeting):
    disposition = adjudicate(snapshot(greeting), intent_id="int:test")
    assert disposition.disposition is not DispositionKind.CONFIRMED, greeting


@pytest.mark.parametrize(
    "greeting",
    [
        "Hi, yes, this is the Smith family. We're not home right now. Please leave your name and number.",
        "Yes! We can't come to the phone. We'll get back to you.",
    ],
)
def test_judge_b_calls_those_greetings_voicemail(greeting):
    verdict = judge_b_transcript(snapshot(greeting))
    assert verdict.contact_type is ContactType.VOICEMAIL
    assert verdict.acknowledged is not Acknowledged.YES


def test_the_machine_greeting_is_never_stored_as_acknowledgement_evidence():
    greeting = "Hi, yes, this is the Smith family. We're not home. Please leave a message."
    disposition = adjudicate(snapshot(greeting), intent_id="int:test")
    for span in disposition.evidence_spans:
        assert span.source != "transcript_acknowledgement"


# -- a health fact was stored durably and rendered on the dashboard ---------------
#
# No schema field carries PHI, but a customer can say one out loud and extraction can copy
# it into `notes_for_human`, which is stored and shown to operators.


def test_a_health_fact_in_the_note_is_stripped_before_storage():
    disposition = adjudicate(
        snapshot(
            "Yes, I heard you.",
            result={
                "contact_type": "live_person",
                "acknowledged": "yes",
                "needs_assistance": "medical_question",
                "notes_for_human": "Has an oxygen concentrator and is on dialysis weekly.",
            },
        ),
        intent_id="int:test",
    )
    assert disposition.notes_for_human is not None
    for term in ("oxygen", "concentrator", "dialysis"):
        assert term not in disposition.notes_for_human.lower()
    assert "[medical detail removed]" in disposition.notes_for_human


def test_a_health_fact_spoken_in_the_transcript_is_stripped_from_the_evidence_span():
    disposition = adjudicate(
        snapshot("Yes, I heard you. I run an oxygen concentrator at night."),
        intent_id="int:test",
    )
    for span in disposition.evidence_spans:
        assert "oxygen" not in span.text.lower()
        assert "concentrator" not in span.text.lower()


@pytest.mark.parametrize(
    "term", ["oxygen", "dialysis", "ventilator", "insulin", "pacemaker", "chemotherapy"]
)
def test_health_terms_are_redacted_from_free_text(term):
    assert term not in (redact_free_text(f"The customer mentioned {term} today") or "").lower()


def test_redaction_leaves_ordinary_routing_text_alone():
    note = "Asked where the resource center is and requested a callback tomorrow."
    assert redact_free_text(note) == note


# -- a live run could dial on a rewound clock -------------------------------------
#
# `_resolve_now` branched on the CLI flag `args.mode`, but `PC_MODE=live` is a documented
# way to select live mode and leaves that flag as None. A live run then took the fixture
# branch, rewinding the clock by up to four hours: quiet hours were evaluated at the wrong
# local time and every audit row was stamped with a fabricated timestamp.


def test_a_live_run_never_uses_the_offline_demo_clock(event):
    args = build_parser().parse_args(["run"])
    assert args.mode is None  # exactly the shape PC_MODE=live produces

    resolved = _resolve_now(RunMode.LIVE, args, event)
    assert abs((resolved - datetime.now(timezone.utc)).total_seconds()) < 5
    assert resolved != event.field_visit_cutoff - timedelta(hours=4)


def test_the_offline_modes_still_get_the_reproducible_clock(event):
    args = build_parser().parse_args(["run"])
    resolved = _resolve_now(RunMode.FIXTURE, args, event)
    assert resolved <= event.field_visit_cutoff - timedelta(hours=4)


def test_a_live_run_refuses_a_clock_override(event):
    args = build_parser().parse_args(["run", "--now", "2026-09-11T08:00:00-07:00"])
    with pytest.raises(ConfigError, match="live mode"):
        _resolve_now(RunMode.LIVE, args, event)


def test_a_clock_override_without_an_offset_is_refused(event):
    """It used to be accepted, reinterpreted in the machine's timezone, then crash."""
    args = build_parser().parse_args(["run", "--now", "2026-09-11T08:00:00"])
    with pytest.raises(ConfigError, match="UTC offset"):
        _resolve_now(RunMode.FIXTURE, args, event)


def test_the_live_confirmation_cannot_be_skipped_with_yes():
    """`--yes` is for the offline modes. It must not stand in for the typed word."""
    import inspect

    from positive_contact import cli

    source = inspect.getsource(cli.cmd_run)
    live_block = source.split("MODE: LIVE")[1]
    assert "args.yes" not in live_block
    assert "PLACE" in live_block


# -- the webhook inbox stored raw phone numbers -----------------------------------
#
# A webhook body is a full call task and carries the dialled number. `record_webhook`
# stored it verbatim, putting a raw E.164 outside `contacts`.


def test_the_inbox_stores_no_raw_number(ledger):
    payload = {
        "id": "evt_1",
        "type": "call.completed",
        "data": {
            "id": "call_1",
            "status": "completed",
            "recipients": [{"phones": ["+14155550101"], "attempts": [{"phone": "+14155550101"}]}],
        },
    }
    ledger.record_webhook("evt_1", "call_1", payload)
    stored = ledger.conn.execute("SELECT payload_json FROM inbox").fetchone()["payload_json"]
    assert find_raw_e164(stored) == []
    body = json.loads(stored)
    assert body["data"]["recipients"][0]["phones"] == ["+1415•••0101"]


def test_a_quarantined_delivery_stores_no_raw_number(ledger):
    payload = {"id": "evt_2", "data": {"id": "call_2", "phones": ["+14155550102"]}}
    ledger.quarantine_webhook("evt_2", "call_2", payload, "unknown type")
    stored = ledger.conn.execute(
        "SELECT payload_json FROM inbox WHERE event_uid = 'evt_2'"
    ).fetchone()["payload_json"]
    assert find_raw_e164(stored) == []


def test_a_quarantine_cannot_overwrite_an_existing_inbox_row(ledger):
    """The event id on a quarantined delivery is unauthenticated attacker input.

    INSERT OR REPLACE let a forged request delete a real row and reset `processed_at`,
    which would make an already-handled terminal event look unhandled.
    """
    real = {"id": "evt_3", "type": "call.completed", "data": {"id": "call_3"}}
    ledger.record_webhook("evt_3", "call_3", real)
    ledger.mark_webhook_processed("evt_3")
    before = ledger.conn.execute(
        "SELECT payload_json, processed_at FROM inbox WHERE event_uid = 'evt_3'"
    ).fetchone()
    assert before["processed_at"] is not None

    ledger.quarantine_webhook("evt_3", "call_forged", {"id": "evt_3", "evil": True}, "forged")

    after = ledger.conn.execute(
        "SELECT payload_json, processed_at, quarantined FROM inbox WHERE event_uid = 'evt_3'"
    ).fetchone()
    assert after["processed_at"] == before["processed_at"], "processed_at was reset"
    assert after["payload_json"] == before["payload_json"], "the original payload was replaced"
    assert after["quarantined"] == 1
    assert ledger.count_inbox_rows() == 1


# -- preflight crashed instead of reporting a blocking issue -----------------------


def test_an_over_long_idempotency_key_is_a_blocking_issue_not_a_crash(event, policy, now):
    """`derive_idempotency_key` raises rather than returning an over-long key, so the
    caller has to catch it. It did not, which made the blocking branch unreachable."""
    huge = event.model_copy(update={"event_id": "e" * 260})
    result = run_preflight(
        event=huge,
        policy=policy,
        rows=[
            {
                "contact_id": "pc-900",
                "first_name": "Sam",
                "phone_e164": "+14155550190",
                "alt_phone_e164": "",
                "locale": "en-US",
                "tz": "America/Los_Angeles",
                "service_address_short": "9 block of Test St",
            }
        ],
        now=now,
    )
    assert not result.ok
    assert "idempotency_key_too_long" in {issue.code for issue in result.blocking}


# -- provider error text reached the append-only audit trail unredacted ------------


def test_provider_error_text_is_redacted_before_it_reaches_the_audit_trail(
    ledger, event, policy, now
):
    from positive_contact.models import Contact
    from positive_contact.transports.base import SubmitResult

    class LeakyTransport:
        def submit(self, **kwargs):
            return SubmitResult.rejected(
                "blocked: the number +14155550101 opted out, contact ops@example.com",
                "recipient_blocked",
            )

        def read(self, call_id):  # pragma: no cover
            raise AssertionError

    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id="pc-001", event_id=event.event_id, first_name="Maria",
            phone_e164="+14155550101", locale="en-US", tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )
    intent = ledger.reserve_intent(
        build_intent(
            event, "pc-001", 1, LadderTarget.PRIMARY, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )
    dispatch_intent(ledger, LeakyTransport(), event, policy, intent, now=now)

    trail = json.dumps(
        [row.model_dump(mode="json") for row in ledger.list_transitions(intent.intent_id)]
    )
    assert find_raw_e164(trail) == []
    assert "ops@example.com" not in trail


# -- a call could be dialled after the field-visit cutoff --------------------------


def test_no_call_is_dialled_after_the_cutoff(ledger, event, policy, demo_preflight):
    """A result that lands after the deadline cannot stop a truck, so it is not worth a
    call. The process may only reach a reserved step after the cutoff if it was down."""
    late = event.field_visit_cutoff + timedelta(minutes=1)
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=late, simulated_clock=False)
    assert transport.submitted_payloads == []
    assert ledger.count_calls_for_event(event.event_id) == 0


def test_the_reconcile_path_also_respects_the_cutoff(ledger, event, policy, now):
    """Replaying a key can create the call, so reconciliation dials for real too."""
    from positive_contact.dispatch import reconcile_unknown_submission
    from positive_contact.models import Contact
    from positive_contact.transports.base import SubmitResult

    class CountingTransport:
        def __init__(self):
            self.calls = 0

        def submit(self, **kwargs):
            self.calls += 1
            return SubmitResult.accepted("call_x")

        def read(self, call_id):  # pragma: no cover
            raise AssertionError

    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id="pc-001", event_id=event.event_id, first_name="Maria",
            phone_e164="+14155550101", locale="en-US", tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )
    intent = ledger.reserve_intent(
        build_intent(
            event, "pc-001", 1, LadderTarget.PRIMARY, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )
    transport = CountingTransport()
    outcome = reconcile_unknown_submission(
        ledger, transport, event, intent,
        policy=policy, now=event.field_visit_cutoff + timedelta(minutes=1),
    )
    assert outcome.action == "skipped"
    assert transport.calls == 0


# -- the --max-calls ceiling was only tested as a bare counter ---------------------


def test_the_live_ceiling_stops_the_dispatch_path_itself(ledger, demo_preflight, now):
    """Not the counter in isolation: the run must stop submitting at the ceiling."""
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    budget = LiveCallBudget(3)
    outcome = execute_run(
        ledger, transport, demo_preflight, now=now, simulated_clock=True, budget=budget
    )
    assert len(transport.submitted_payloads) == 3
    assert budget.spent == 3
    assert budget.remaining == 0
    assert any("max-calls" in line for line in outcome.log)


def test_max_calls_per_contact_is_enforced_when_the_ladder_would_go_further(
    ledger, event, demo_preflight, now
):
    """Shrink the ceiling below the ladder length and check the ceiling, not the ladder,
    is what stops it."""
    from positive_contact.policy import load_policy

    tight = load_policy({**event.policy, "max_calls_per_contact": 2})
    result = demo_preflight
    result.policy = tight
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, result)
    execute_run(ledger, transport, result, now=now, simulated_clock=True)
    # pc-008 voicemails at every step and would otherwise take all four.
    assert ledger.count_calls_for_contact("pc-008") == 2


# -- masking of short numbers -----------------------------------------------------


def test_a_short_number_is_not_almost_fully_revealed():
    """The old rule kept 4 leading and 4 trailing characters, which for an 8 character
    number is the whole thing."""
    short = "+1234567"
    masked = mask_e164(short)
    assert find_raw_e164(masked) == []
    revealed = masked.replace("•••", "")
    assert len(revealed) <= 2
