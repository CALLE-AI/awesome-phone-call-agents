"""The ladder, the packet, and the release gate.

The last three tests in this file are the ones that matter most: they are structural, not
behavioural, and they exist because "there is no code path that dials 911" cannot be proved by
calling functions and watching what they do. They read the module's own source.
"""
from __future__ import annotations

import ast
import inspect
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.domain.state import (
    CheckOutcome,
    EscalationLevel,
    EscalationStatus,
    IllegalTransition,
)
from app.models import CheckCall, Escalation, HandoffPacket
from app.orchestrator import escalate
from app.orchestrator.escalate import (
    ReleaseRefused,
    advance,
    build_handoff_packet,
    is_released,
    last_successful_contact,
    last_words,
    next_rung,
    open_escalation,
    record_attempt,
    release,
    require_released,
    starting_rung,
)


@pytest.fixture()
def session():  # noqa: ANN201
    """A private engine with only app.models' tables.

    Deliberately not conftest's `db` fixture: that goes through `app.db.init_db`, which is another
    agent's file and mid-port. These tests exercise the ladder, not the schema bootstrap.
    """
    import app.models  # noqa: F401  (register tables on the shared metadata)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    engine.dispose()


def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


NOW = _naive(datetime.now(UTC))


class Nbr:
    """A roster row's worth of Walter, duck-typed so these tests do not need a Neighbour table."""

    def __init__(self, **over):  # noqa: ANN003
        self.id = "nbr_walter"
        self.name = "Walter Diaz"
        self.phone = "+15550142"
        self.address = "4412 W Cambridge Ave"
        self.unit = "B"
        self.access_notes = "side gate, dog in yard"
        self.age_band = "75_plus"
        self.lives_alone = True
        self.conditions = ["copd", "oxygen_dependent"]
        self.power_dependent = True
        self.power_backup_hours = 2.0
        self.cooling = "swamp_cooler"
        self.heating = "none"
        self.mobility = "cane_walker"
        self.has_transport = False
        self.preferred_language = "en-US"
        self.contact_name = "Marisol Diaz"
        self.contact_phone = "+15550188"
        self.contact_relation = "daughter"
        self.notes = ""
        self.__dict__.update(over)


HAZARD = {
    "id": "haz_1", "kind": "power_outage", "headline": "Power outage — 6h estimate",
    "area": "Maryvale, Phoenix", "severity": "warning", "starts_at": "", "ends_at": "",
    "facts": {"outage_eta_h": 6}, "source": "APS", "declared_by": "Elena Ruiz",
}


def call(*, at: datetime = NOW, **over):  # noqa: ANN001, ANN201
    base = dict(sweep_id="swp_1", hazard_id="haz_1", neighbour_id="nbr_walter", provider="mock",
                idempotency_key=f"k{over.get('attempt', 1)}-{over.get('callee', 'neighbour')}",
                task="check on Walter", status="NO_ANSWER", started_at=at, completed_at=at)
    base.update(over)
    return CheckCall(**base)


# ------------------------------------------------------------------------------- opening the ladder
def test_safe_opens_nothing(session: Session) -> None:
    assert open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(),
                           outcome=CheckOutcome.SAFE, reason="fine") is None


@pytest.mark.parametrize("outcome", [CheckOutcome.UNREACHABLE, CheckOutcome.URGENT,
                                     CheckOutcome.NEEDS_HELP, CheckOutcome.HELP_DECLINED])
def test_every_non_safe_outcome_opens_an_escalation(session: Session, outcome: CheckOutcome) -> None:
    """Including HELP_DECLINED — their refusal is theirs to make, and it still stays on the board —
    and especially UNREACHABLE, which is the neighbour nobody would otherwise have chased."""
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(), outcome=outcome,
                          reason="because", trigger_call_id="call_1")
    assert esc is not None
    assert esc.outcome == outcome.value
    assert EscalationStatus(esc.status) is EscalationStatus.OPEN
    assert EscalationLevel(esc.level) is EscalationLevel.EMERGENCY_CONTACT
    assert esc.rungs[-1]["action"] == "entered" and esc.rungs[-1]["call_id"] == "call_1"


def test_no_contact_on_file_starts_at_the_captain_and_says_why(session: Session) -> None:
    """A skipped rung is written down as skipped. A captain on a doorstep will ask whether we rang
    the daughter, and "there is no daughter" is a different answer from "she didn't pick up"."""
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(contact_phone=""),
                          outcome=CheckOutcome.UNREACHABLE)
    assert EscalationLevel(esc.level) is EscalationLevel.BLOCK_CAPTAIN
    skipped = esc.rungs[0]
    assert skipped["level"] == EscalationLevel.EMERGENCY_CONTACT.value
    assert skipped["action"] == "skipped"
    assert "Marisol Diaz is on file with no phone number" in skipped["result"]


def test_a_name_with_no_number_is_not_a_rung() -> None:
    assert starting_rung(Nbr(contact_phone="  ")) is EscalationLevel.BLOCK_CAPTAIN
    assert starting_rung(Nbr()) is EscalationLevel.EMERGENCY_CONTACT
    # dicts work too: the runner may hold a serialised roster row
    assert starting_rung({"contact_phone": "+15550188"}) is EscalationLevel.EMERGENCY_CONTACT


# ------------------------------------------------------------------------------- climbing
def test_the_ladder_has_exactly_three_rungs_in_one_order() -> None:
    assert next_rung(EscalationLevel.EMERGENCY_CONTACT) is EscalationLevel.BLOCK_CAPTAIN
    assert next_rung(EscalationLevel.BLOCK_CAPTAIN) is EscalationLevel.RESPONDER
    assert next_rung(EscalationLevel.RESPONDER) is None


def test_the_whole_climb_is_auditable(session: Session) -> None:
    nbr = Nbr()
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=nbr,
                          outcome=CheckOutcome.UNREACHABLE, reason="no answer, 3 attempts")
    record_attempt(session, esc, action="called", result="daughter did not answer either", call_id="call_2")
    advance(session, esc, neighbour=nbr, reason="emergency contact unreachable")
    assert EscalationLevel(esc.level) is EscalationLevel.BLOCK_CAPTAIN
    record_attempt(session, esc, action="notified", result="captain paged")
    advance(session, esc, neighbour=nbr, reason="captain cannot get there")

    assert EscalationLevel(esc.level) is EscalationLevel.RESPONDER
    assert EscalationStatus(esc.status) is EscalationStatus.AWAITING_AUTHORISATION
    trail = [(r["level"], r["action"]) for r in esc.rungs]
    assert trail == [
        ("EMERGENCY_CONTACT", "entered"),
        ("EMERGENCY_CONTACT", "called"),
        ("BLOCK_CAPTAIN", "entered"),
        ("BLOCK_CAPTAIN", "notified"),
        ("RESPONDER", "entered"),
    ]


def test_leaving_a_rung_nobody_worked_is_recorded_as_skipped(session: Session) -> None:
    """The model's default level is EMERGENCY_CONTACT, so an escalation created anywhere else can be
    sitting on a rung there was never anybody to try."""
    esc = Escalation(sweep_id="s", hazard_id="h", neighbour_id="n", outcome=CheckOutcome.URGENT.value)
    session.add(esc)
    advance(session, esc, neighbour=Nbr(contact_phone=""))
    assert esc.rungs[0]["action"] == "skipped"
    assert "no emergency contact on file" in esc.rungs[0]["result"]
    assert EscalationLevel(esc.level) is EscalationLevel.BLOCK_CAPTAIN


def test_reaching_a_contact_is_not_the_same_as_the_neighbour_being_safe(session: Session) -> None:
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(), outcome=CheckOutcome.URGENT)
    record_attempt(session, esc, action="called", result="daughter is driving over now", reached=True)
    assert EscalationStatus(esc.status) is EscalationStatus.CONTACT_REACHED
    assert esc.resolved_at is None  # only resolve() closes a neighbour out


def test_advance_at_the_top_does_not_invent_a_fourth_rung(session: Session) -> None:
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(), outcome=CheckOutcome.URGENT)
    esc.level = EscalationLevel.RESPONDER
    esc.status = EscalationStatus.AWAITING_AUTHORISATION
    advance(session, esc, neighbour=Nbr())
    assert EscalationLevel(esc.level) is EscalationLevel.RESPONDER
    assert esc.rungs[-1]["result"] == "already at the top of the ladder"


def test_status_changes_go_through_the_state_machine(session: Session) -> None:
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(), outcome=CheckOutcome.URGENT)
    escalate.resolve(session, esc, resolved_by="Elena Ruiz", note="son took her to the cooling centre")
    assert EscalationStatus(esc.status) is EscalationStatus.RESOLVED
    with pytest.raises(IllegalTransition):
        advance(session, esc, neighbour=Nbr())  # RESOLVED is terminal; the ladder cannot restart it
    with pytest.raises(ReleaseRefused):
        escalate.resolve(session, esc, resolved_by="   ")


def test_rungs_survive_a_commit(session: Session) -> None:
    """`Escalation.rungs` is a plain Column(JSON) with no MutableList: an in-place `.append()` never
    marks the attribute dirty and the audit trail is silently dropped on commit. Every mutation in
    escalate.py rebinds the list, and this test is what proves it — an in-memory assert would pass
    either way."""
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=Nbr(), outcome=CheckOutcome.UNREACHABLE)
    session.commit()  # the row exists before the next rung is written: an in-place append is lost HERE
    record_attempt(session, esc, action="called", result="no answer from the daughter")
    session.commit()
    advance(session, esc, neighbour=Nbr())
    session.commit()
    esc_id = esc.id
    session.expunge_all()

    reloaded = session.get(Escalation, esc_id)
    assert [r["action"] for r in reloaded.rungs] == ["entered", "called", "entered"]
    assert EscalationLevel(reloaded.level) is EscalationLevel.BLOCK_CAPTAIN


# ------------------------------------------------------------------------------- the packet
def _walter_packet(session: Session, **over):  # noqa: ANN001, ANN201
    nbr = Nbr(**over.pop("neighbour", {}))
    esc = open_escalation(session, sweep_id="swp_1", hazard_id="haz_1", neighbour=nbr,
                          outcome=CheckOutcome.UNREACHABLE, reason="three calls, no answer")
    advance(session, esc, neighbour=nbr)
    advance(session, esc, neighbour=nbr)
    calls = over.pop("calls", None)
    if calls is None:
        calls = [
            call(attempt=1, status="COMPLETED", at=NOW - timedelta(hours=5),
                 structured_result={"reached_intended_person": "yes", "alarming_quote": "",
                                    "concerns": ["the machine's been beeping"]},
                 transcript=[{"speaker": "bot", "text": "How are you doing?"},
                             {"speaker": "user", "text": "The machine's been beeping since lunchtime."}],
                 summary="Walter reported his concentrator beeping.", outcome="NEEDS_HELP"),
            call(attempt=2, at=NOW - timedelta(minutes=40), outcome="UNREACHABLE"),
            call(attempt=3, at=NOW - timedelta(minutes=4), outcome="UNREACHABLE"),
            call(attempt=1, callee="emergency_contact", at=NOW - timedelta(minutes=2), outcome="UNREACHABLE"),
        ]
    packet = build_handoff_packet(session, escalation=esc, neighbour=nbr, hazard=HAZARD, calls=calls,
                                 concerns=over.pop("concerns", ["oxygen concentrator on wall power, 2h of battery"]))
    return esc, packet


def test_the_first_sentence_carries_the_address_and_the_medical_fact(session: Session) -> None:
    """Composed for someone reading it out loud at 11pm who may be interrupted after one line."""
    _, packet = _walter_packet(session)
    first = packet.spoken_script.split("\n")[0]
    assert "4412 W Cambridge Ave" in first and "unit B" in first
    assert "Walter Diaz" in first
    assert "medical equipment" in first and "2 hours of battery backup" in first


def test_the_packet_carries_what_a_responder_asks_for(session: Session) -> None:
    _, packet = _walter_packet(session)
    script = packet.spoken_script
    assert "Power outage" in script and "Maryvale" in script
    assert "side gate, dog in yard" in script
    assert "Lives alone." in script
    assert "oxygen concentrator on wall power, 2h of battery" in script
    assert packet.neighbour_snapshot["conditions"] == ["copd", "oxygen_dependent"]
    assert packet.hazard_snapshot["kind"] == "power_outage"


def test_no_battery_backup_is_stated_as_such(session: Session) -> None:
    _, packet = _walter_packet(session, neighbour={"power_backup_hours": 0.0})
    assert "NO battery backup" in packet.spoken_script


def test_last_contact_is_the_last_time_we_spoke_to_them_not_the_last_dial(session: Session) -> None:
    """'Last heard from at 4:05' and 'last dialled four minutes ago' are different facts, and the
    second is worthless to somebody deciding whether to force a door."""
    _, packet = _walter_packet(session)
    assert packet.last_contact_at == NOW - timedelta(hours=5)
    assert len(packet.attempts_summary) == 4
    # the ladder reuses CheckCall, so the call to the daughter is in the attempt list too
    assert [a["callee"] for a in packet.attempts_summary].count("emergency_contact") == 1
    assert [a["reached"] for a in packet.attempts_summary] == [True, False, False, False]


def test_last_words_are_verbatim_and_never_the_summary(session: Session) -> None:
    _, packet = _walter_packet(session)
    assert packet.last_words == "The machine's been beeping since lunchtime."
    assert "Walter reported" not in packet.spoken_script  # CALL-E's paraphrase must not be quoted as his
    assert f'"{packet.last_words}"' in packet.spoken_script


def test_the_alarming_quote_wins_over_the_last_transcript_turn() -> None:
    c = call(status="COMPLETED", structured_result={"reached_intended_person": "yes",
                                                    "alarming_quote": "I can't get out of this chair."},
             transcript=[{"speaker": "user", "text": "Alright then, bye now."}])
    assert last_words([c]) == "I can't get out of this chair."


def test_no_transcript_and_no_quote_leaves_last_words_empty() -> None:
    assert last_words([call(status="NO_ANSWER")]) == ""
    assert last_successful_contact([call(status="NO_ANSWER")]) is None
    # a bot-only transcript is not their voice
    assert last_words([call(status="COMPLETED", transcript=[{"speaker": "bot", "text": "Leaving a message."}])]) == ""


def test_never_reached_today_is_said_plainly(session: Session) -> None:
    _, packet = _walter_packet(session, calls=[call(attempt=1), call(attempt=2)])
    assert packet.last_contact_at is None
    assert "Never reached today: 2 call attempts, no answer." in packet.spoken_script


def test_the_packet_promises_nobody_has_been_sent(session: Session) -> None:
    """Nothing in BuddyE has dispatched anything, and the page must not let a reader assume it did."""
    _, packet = _walter_packet(session)
    text = packet.spoken_script + " " + packet.recommended_action
    assert "nobody has been sent" in packet.spoken_script.lower()
    assert "No emergency service has been contacted by the system" in packet.spoken_script
    for word in ("dispatched", "en route", "on their way", "units responding", "we have called 911"):
        assert word not in text.lower()
    assert packet.recommended_action.startswith("Request an in-person welfare check")


# ------------------------------------------------------------------------------- the release gate
def test_a_prepared_packet_has_told_nobody_anything(session: Session) -> None:
    esc, packet = _walter_packet(session)
    assert packet.released_at is None
    assert packet.released_by == ""
    assert not is_released(packet)
    assert EscalationStatus(esc.status) is EscalationStatus.AWAITING_AUTHORISATION
    with pytest.raises(ReleaseRefused, match="has not been released"):
        require_released(packet)


@pytest.mark.parametrize("name", ["", "   ", "\t\n", "123", "-", "system", "AUTOMATION", "buddye",
                                  "service account", "bot", "unknown", "n/a"])
def test_release_without_a_named_human_raises(session: Session, name: str) -> None:
    esc, packet = _walter_packet(session)
    with pytest.raises(ReleaseRefused):
        release(session, packet, escalation=esc, released_by=name)
    assert packet.released_at is None
    assert EscalationStatus(esc.status) is EscalationStatus.AWAITING_AUTHORISATION


def test_release_needs_an_escalation_that_actually_reached_the_responder_rung(session: Session) -> None:
    nbr = Nbr()
    esc = open_escalation(session, sweep_id="s", hazard_id="h", neighbour=nbr, outcome=CheckOutcome.URGENT)
    packet = HandoffPacket(escalation_id=esc.id, neighbour_id="n", hazard_id="h")
    with pytest.raises(ReleaseRefused, match="AWAITING_AUTHORISATION"):
        release(session, packet, escalation=esc, released_by="Elena Ruiz")
    assert packet.released_at is None


def test_release_by_a_named_human_is_the_one_path_through(session: Session) -> None:
    esc, packet = _walter_packet(session)
    released = release(session, packet, escalation=esc, released_by="  Elena   Ruiz ",
                       note="called 911 myself and read them the script")
    assert released.released_by == "Elena Ruiz"  # normalised, and stored as a person
    assert released.released_at is not None
    assert is_released(released) and require_released(released) is released
    assert EscalationStatus(esc.status) is EscalationStatus.RELEASED
    assert esc.rungs[-1]["action"] == "released" and "Elena Ruiz" in esc.rungs[-1]["result"]

    session.commit()
    packet_id = packet.id
    session.expunge_all()
    reloaded = session.get(HandoffPacket, packet_id)
    assert reloaded.released_by == "Elena Ruiz" and reloaded.released_at is not None


def test_a_packet_cannot_be_released_twice(session: Session) -> None:
    esc, packet = _walter_packet(session)
    release(session, packet, escalation=esc, released_by="Elena Ruiz")
    with pytest.raises(ReleaseRefused, match="already released"):
        release(session, packet, escalation=esc, released_by="Someone Else")
    assert packet.released_by == "Elena Ruiz"


# ------------------------------------------------------------------------------- structural proofs
#
# These three read escalate.py's source. Behaviour tests can show that the functions we call do the
# right thing; only the source can show that there is no other function to call.
def _module_ast() -> ast.Module:
    return ast.parse(inspect.getsource(escalate))


def test_released_at_is_assigned_in_exactly_one_function() -> None:
    """The safety property, stated structurally: `prepared -> sent` happens in release() or nowhere."""
    tree = _module_ast()
    assigners: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for sub in ast.walk(node):
            targets = (list(sub.targets) if isinstance(sub, ast.Assign)
                       else [sub.target] if isinstance(sub, (ast.AugAssign, ast.AnnAssign)) else [])
            for t in targets:
                if isinstance(t, ast.Attribute) and t.attr == "released_at":
                    assigners.append(node.name)
    assert assigners == ["release"], f"released_at is assigned outside release(): {assigners}"


def test_escalate_cannot_place_a_call_at_all() -> None:
    """Not "it does not dial 911" — it has no way to dial anything. The module imports no call
    provider and no HTTP client, so no future edit can reach one without also changing this test."""
    imported: set[str] = set()
    for node in ast.walk(_module_ast()):
        if isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
        elif isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
    # Asserted as the property, not as an exact import list: a future `from app.obs import ...` for a
    # log line must not turn the safety test into a false alarm that someone then deletes.
    banned = {"httpx", "requests", "urllib", "subprocess", "socket", "smtplib", "twilio"}
    for name in imported:
        assert not name.startswith("app.calls"), f"escalate.py imports a call provider: {name}"
        assert name.split(".")[0] not in banned, f"escalate.py imports {name}"


def test_no_dialable_number_is_a_value_in_the_module() -> None:
    """"911" may appear in prose describing what BuddyE refuses to do. It may never be data."""
    tree = _module_ast()
    docs = {d for node in ast.walk(tree)
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            and (d := ast.get_docstring(node, clean=False))}
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value not in docs:
            for token in ("911", "112", "999", "+1", "tel:", "sms:"):
                assert token not in node.value, f"{token!r} is a value in escalate.py: {node.value!r}"
