"""Safety properties, asserted rather than documented.

The medical boundary, the phone-number masking, and the whitelist on what the
caller may say are all testable claims. These are the tests that make them so.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from rehab_adherence.calle import FixturePort, redact
from rehab_adherence.decide import decide
from rehab_adherence.goal import build_task, reference
from rehab_adherence.model import CourseFile, InputError, mask_phone
from rehab_adherence.report import render, write_jsonl
from rehab_adherence.workflow import build_call_arguments, masked_call_arguments, plan, run

TODAY = date(2026, 8, 11)
HERE = Path(__file__).resolve().parent.parent
EXAMPLE = HERE / "examples" / "course.example.json"
RESPONSES = HERE / "examples" / "responses.example.json"


@pytest.fixture(scope="module")
def raw() -> dict:
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def course_file(raw: dict) -> CourseFile:
    return CourseFile.parse(raw)


# --- what the caller is allowed to say -----------------------------------------


def test_unknown_clinical_fields_cannot_reach_the_caller(raw: dict) -> None:
    """The goal is built from a whitelist of validated fields. Adding clinical
    content to the course file must not change a single character of the task."""
    patient_id = "p_rosa"
    baseline = CourseFile.parse(raw)
    decision = decide(
        next(p for p in baseline.patients if p.id == patient_id),
        baseline.course,
        baseline.policy,
        TODAY,
    )
    before = build_task(
        baseline.clinic, baseline.course, next(p for p in baseline.patients if p.id == patient_id), decision
    )

    poisoned = json.loads(json.dumps(raw))
    poisoned["course"]["diagnosis"] = "grade II medial meniscus tear"
    poisoned["course"]["clinical_note"] = "advise 20 degrees more flexion before loading"
    for patient in poisoned["patients"]:
        patient["medication"] = "ibuprofen 400mg three times daily"
        patient["prognosis"] = "expect full range of motion by week eight"

    after_file = CourseFile.parse(poisoned)
    after = build_task(
        after_file.clinic, after_file.course, next(p for p in after_file.patients if p.id == patient_id), decision
    )

    assert before == after
    for leak in ("meniscus", "flexion", "ibuprofen", "400mg", "prognosis", "range of motion"):
        assert leak not in after


def test_every_task_carries_the_clinical_boundary(course_file: CourseFile) -> None:
    tasks = [
        build_task(course_file.clinic, course_file.course, patient, decision)
        for decision, _ in plan(course_file, TODAY)
        if decision.will_call
        for patient in [next(p for p in course_file.patients if p.id == decision.patient_id)]
    ]
    assert tasks, "the example course must exercise at least one call"
    for task in tasks:
        assert "must not give or discuss any medical" in task
        assert "a clinician will call them back" in task
        assert "If the person asks to stop being called, agree immediately" in task


def test_no_task_asks_how_the_patient_feels(course_file: CourseFile) -> None:
    """"What is stopping you attending" is logistics. "How is your pain" is
    assessment, and must not exist anywhere in the goal text."""
    forbidden = ("how are you feeling", "how is your pain", "is the pain", "how is your recovery", "rate your pain")
    for decision, _ in plan(course_file, TODAY):
        if not decision.will_call:
            continue
        patient = next(p for p in course_file.patients if p.id == decision.patient_id)
        task = build_task(course_file.clinic, course_file.course, patient, decision).lower()
        for phrase in forbidden:
            assert phrase not in task


def test_disclosure_offers_an_out_of_band_check(course_file: CourseFile) -> None:
    """A recipient who suspects a scam is behaving correctly. The caller must not
    argue; it must hand over a checkable reference and the clinic's own number."""
    patient = next(p for p in course_file.patients if p.id == "p_ivy")
    decision = decide(patient, course_file.course, course_file.policy, TODAY)
    task = build_task(course_file.clinic, course_file.course, patient, decision)
    assert "automated assistant" in task
    assert "hang up" in task
    assert course_file.clinic.public_callback_number in task
    from rehab_adherence.goal import spoken_reference
    code = reference(course_file.clinic, course_file.course, patient)
    assert spoken_reference(code) in task, "the spoken form is what the caller says"


def test_reference_is_stable_and_carries_no_identity(course_file: CourseFile) -> None:
    patient = next(p for p in course_file.patients if p.id == "p_ivy")
    code = reference(course_file.clinic, course_file.course, patient)
    assert code == reference(course_file.clinic, course_file.course, patient)
    assert patient.first_name.lower() not in code.lower()
    assert patient.phone_e164 not in code


# --- phone numbers --------------------------------------------------------------


def test_mask_keeps_only_the_ends() -> None:
    assert mask_phone("+15550101001") == "+15*******01"
    assert "5550101" not in mask_phone("+15550101001")


def test_preview_never_prints_a_full_number(course_file: CourseFile) -> None:
    for decision, _ in plan(course_file, TODAY):
        if not decision.will_call:
            continue
        rendered = json.dumps(masked_call_arguments(course_file, decision.patient_id, decision))
        patient = next(p for p in course_file.patients if p.id == decision.patient_id)
        assert patient.phone_e164 not in rendered
        assert course_file.clinic.public_callback_number not in rendered


def test_preview_masks_the_callback_without_changing_the_private_task(course_file: CourseFile) -> None:
    decision = next(decision for decision, _ in plan(course_file, TODAY) if decision.will_call)
    private = build_call_arguments(course_file, decision.patient_id, decision)
    preview = masked_call_arguments(course_file, decision.patient_id, decision)
    assert course_file.clinic.public_callback_number in private["task"]
    assert course_file.clinic.public_callback_number not in preview["task"]
    assert "[phone-redacted]" in preview["task"]
    assert build_call_arguments(course_file, decision.patient_id, decision) == private
    assert preview["result_schema"] == private["result_schema"]
    assert preview["idempotency_key"] == private["idempotency_key"]


def test_live_arguments_do_carry_the_real_number(course_file: CourseFile) -> None:
    """The masked form is for display. The provider must receive E.164, or no call
    can be placed — this test exists so masking is never applied to the wire."""
    decision = decide(
        next(p for p in course_file.patients if p.id == "p_ivy"), course_file.course, course_file.policy, TODAY
    )
    arguments = build_call_arguments(course_file, "p_ivy", decision)
    assert arguments["recipients"][0]["phones"] == ["+15550101001"]


def test_redact_strips_phone_shaped_provider_text() -> None:
    assert "5550101001" not in redact("call me back on +1 555 010 1001 tomorrow")
    assert redact({"a": ["+15550101001"]}) == {"a": ["[phone-redacted]"]}


def test_ledger_contains_no_full_numbers(course_file: CourseFile, tmp_path: Path) -> None:
    responses = json.loads(RESPONSES.read_text(encoding="utf-8"))
    rows = run(course_file, TODAY, FixturePort(responses))
    output = tmp_path / "ledger.jsonl"
    write_jsonl(output, rows)
    written = output.read_text(encoding="utf-8")
    for patient in course_file.patients:
        assert patient.phone_e164 not in written


# --- input validation refuses to guess ------------------------------------------


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda d: d["patients"][0].pop("consent_to_automated_contact"), id="consent-missing"),
        pytest.param(lambda d: d["clinic"].__setitem__("public_callback_number", "555-0100"), id="callback-not-e164"),
        pytest.param(lambda d: d["patients"][0]["sessions"][0].__setitem__("status", "probably-came"), id="bad-status"),
        pytest.param(lambda d: d["course"].__setitem__("offered_slots", "thursday"), id="slots-not-a-list"),
        pytest.param(lambda d: d["patients"].clear(), id="no-patients"),
        pytest.param(
            lambda d: d["patients"][3]["contact_log"][0].pop("promised_date"), id="promise-without-a-date"
        ),
    ],
)
def test_bad_input_is_rejected_not_guessed(raw: dict, mutate) -> None:
    broken = json.loads(json.dumps(raw))
    mutate(broken)
    with pytest.raises(InputError):
        CourseFile.parse(broken)


def test_non_e164_patient_phone_blocks_rather_than_crashes(raw: dict) -> None:
    """A bad number must be a named blocker, not an exception, so the rest of the
    course still runs."""
    edited = json.loads(json.dumps(raw))
    edited["patients"][0]["phone_e164"] = "+1555"
    course_file = CourseFile.parse(edited)
    decision = decide(course_file.patients[0], course_file.course, course_file.policy, TODAY)
    assert "phone_not_e164" in decision.blockers


# --- the fixture path places no calls -------------------------------------------


def test_fixture_run_places_no_call(course_file: CourseFile) -> None:
    responses = json.loads(RESPONSES.read_text(encoding="utf-8"))
    rows = run(course_file, TODAY, FixturePort(responses))
    assert rows, "the run must produce a row per patient"
    assert all(row.simulated is not False for row in rows)
    assert all(row.call_id is None for row in rows)


def test_render_shows_the_no_call_banner(course_file: CourseFile) -> None:
    responses = json.loads(RESPONSES.read_text(encoding="utf-8"))
    rows = run(course_file, TODAY, FixturePort(responses))
    text = render(rows, banner="FIXTURE RUN -- SIMULATED, NO CALL PLACED", course_id="x", today="2026-08-11")
    assert "NO CALL PLACED" in text
    assert "ESCALATED TO CLINICIAN" in text, "Rosa's symptom must be visible in the report"


def test_an_ambiguous_outcome_stops_the_run(course_file: CourseFile) -> None:
    """A create or poll that raised may still have placed a call — the request can
    reach the provider and the response be lost.

    The first version recorded called=False and moved to the next patient, which
    is how the same person gets dialled twice. An ambiguous outcome now retains
    "unknown", keeps called true, escalates, and stops the run.
    """
    class Exploding:
        def __init__(self) -> None:
            self.calls = 0

        def place(self, arguments, *, patient_id):
            self.calls += 1
            if patient_id == "p_ivy":
                raise RuntimeError("connection reset after POST /v1/calls")
            return {"status": "VOICEMAIL", "structured_result": None, "call_id": None,
                    "simulated": True}

    port = Exploding()
    rows = run(course_file, TODAY, port)

    ambiguous = [r for r in rows if r.outcome == "unknown_possibly_placed"]
    assert len(ambiguous) == 1
    row = ambiguous[0]
    assert row.called is True, "the call may have happened; do not record it as not placed"
    assert row.escalate_to_clinician is True
    assert "reconcile" in (row.recommendation or "").lower()
    assert port.calls == 1, "the run must stop, not dial the next patient"


def test_an_ambiguous_outcome_does_not_leak_the_raw_error(course_file: CourseFile) -> None:
    """Provider errors quote the request back, so a raw exception can carry the
    recipient's number or the API key into the ledger."""
    class Leaky:
        @staticmethod
        def place(arguments, *, patient_id):
            raise RuntimeError(
                "400 from api.heycall-e.com: recipient +15550101001 rejected "
                "(key iams_live_abcdefgh12345678)"
            )

    rows = run(course_file, TODAY, Leaky())
    note = next(r.note for r in rows if r.outcome == "unknown_possibly_placed")
    assert "5550101001" not in note
    assert "iams_live_abcdefgh12345678" not in note
    assert "[phone-redacted]" in note and "[secret-redacted]" in note


def test_an_api_key_is_only_sent_to_an_approved_origin() -> None:
    """--base-url is operator input. Pointing it elsewhere would hand a live
    credential to an arbitrary host."""
    from rehab_adherence.calle import check_base_url

    assert check_base_url("https://api.heycall-e.com") == "https://api.heycall-e.com"
    for bad in (
        "http://api.heycall-e.com",
        "https://evil.example.com",
        "https://user:pass@api.heycall-e.com",
        "https://api.heycall-e.com/path",
        "https://api.heycall-e.com?x=1",
        "api.heycall-e.com",
        "https://api.heycall-e.com.evil.example",
    ):
        with pytest.raises(ValueError):
            check_base_url(bad)


def test_e164_validation_is_ascii_only() -> None:
    """\\d matches Arabic-Indic and Devanagari digits. A non-ASCII number would
    pass validation here and be rejected or misdialled by the provider."""
    from rehab_adherence.model import E164

    assert E164.fullmatch("+15550101001")
    assert not E164.fullmatch("+١٥٥٥٠١٠١٠٠١")
    assert not E164.fullmatch("+١٢٣٤٥٦٧٨٩")


def test_transcript_read_from_the_documented_api_path() -> None:
    """The turns live at recipients[].attempts[].transcript_turns[].

    This test exists because the first implementation read a top-level
    "transcript" key that the API never returns: every fixture passed and every
    real call would have come back empty. Shape per
    https://docs.heycall-e.com/api-reference/calls
    """
    from rehab_adherence.calle import normalize_transcript

    payload = {
        "status": "completed",
        "recipients": [
            {
                "attempts": [
                    {
                        "transcript_turns": [
                            {"offset_seconds": 0, "speaker": "bot",
                             "text": "  Ring us on +1 555 010 1000  "},
                            {"offset_seconds": 64, "speaker": "user", "text": "ok"},
                            {"offset_seconds": 70, "speaker": "unknown", "text": "joining"},
                            {"offset_seconds": 75, "speaker": "bot", "text": "   "},
                            "not a dict",
                        ]
                    }
                ]
            }
        ],
    }
    turns = normalize_transcript(payload)
    assert [t["speaker"] for t in turns] == ["BOT", "USER", "OTHER"]
    assert "5550101000" not in turns[0]["text"], "phone-shaped text must be redacted"
    assert turns[1]["ts"] == "00:01:04", "offset_seconds becomes a clock stamp"


def test_a_top_level_transcript_key_is_not_read() -> None:
    """Guards the exact bug: a payload with the old shape must yield nothing,
    so a fixture in the wrong shape fails loudly instead of passing quietly."""
    from rehab_adherence.calle import normalize_transcript

    assert normalize_transcript(
        {"transcript": [{"speaker": "BOT", "text": "hello", "ts": "00:00:00"}]}
    ) == []


def test_confidence_is_an_object_not_a_float() -> None:
    from rehab_adherence.calle import confidence_score

    assert confidence_score({"score": 0.92, "label": "high"}) == 0.92
    assert confidence_score(0.75) == 0.75, "a bare number is still tolerated"
    assert confidence_score(None) is None
    assert confidence_score({"label": "high"}) is None


def test_structured_result_falls_back_to_the_recipient() -> None:
    """Both levels exist. An aggregate at task level must not shadow the
    recipient result that actually carries our schema's fields."""
    from rehab_adherence.calle import RESULT_KEYS, structured_result

    ours = {"reached_patient": "yes", "attendance_intent": "will_attend"}
    payload = {
        "structured_result": {"completed_count": 1},
        "recipients": [{"structured_result": ours}],
    }
    assert structured_result(payload, RESULT_KEYS) == ours
    assert structured_result({"structured_result": ours}, RESULT_KEYS) == ours


def test_transcript_render_shows_the_refusal(course_file: CourseFile) -> None:
    """Rosa raises a symptom. The rendered call must show the refusal and the
    escalation, because that is the shot the demo is built around."""
    from rehab_adherence.report import render_transcript

    responses = json.loads(RESPONSES.read_text(encoding="utf-8"))
    rows = run(course_file, TODAY, FixturePort(responses))
    rosa = next(row for row in rows if row.patient_id == "p_rosa")

    text = render_transcript(rosa)
    assert "agent" in text and "patient" in text
    assert "not able to advise" in text
    assert "ESCALATED TO CLINICIAN" in text
    assert rosa.masked_phone in text
    for patient in course_file.patients:
        assert patient.phone_e164 not in text


def test_transcript_render_handles_a_call_with_no_transcript(course_file: CourseFile) -> None:
    from rehab_adherence.report import render_transcript

    responses = json.loads(RESPONSES.read_text(encoding="utf-8"))
    rows = run(course_file, TODAY, FixturePort(responses))
    wu = next(row for row in rows if row.patient_id == "p_wu")
    assert "no transcript returned" in render_transcript(wu)


def test_call_id_is_checkpointed_before_polling(tmp_path: Path) -> None:
    """The call is placed and billed before the poll starts. If the poll is
    interrupted, the id must already be on disk or the result is unrecoverable.

    Regression for a real incident: a live call connected, the poll did not
    complete, and nothing was written because the ledger was only saved at the
    end of the run. The call could not be recovered.
    """
    from rehab_adherence.calle import LivePort

    checkpoint = tmp_path / "ids.callids"

    class Interrupted(LivePort):
        def __init__(self) -> None:  # skip the SDK import entirely
            self._timeout_seconds = 1
            self._checkpoint = checkpoint
            self._replay_after_seconds = 120.0

            class _Calls:
                @staticmethod
                def create(**_kwargs):
                    return {"id": "call_abc123"}

                @staticmethod
                def wait_for_result(*_a, **_k):
                    raise KeyboardInterrupt("operator stopped the poll")

            class _Client:
                calls = _Calls()

            self._client = _Client()

    with pytest.raises(KeyboardInterrupt):
        Interrupted().place({"task": "x"}, patient_id="p_ivy")

    assert checkpoint.exists(), "the id must survive an interrupted poll"
    assert "call_abc123" in checkpoint.read_text()
    assert "p_ivy" in checkpoint.read_text()


def test_reference_is_speakable_over_a_phone() -> None:
    """Regression from a real call. The reference was RCR-708A4D and the caller
    read it out as "capitalized R, capitalized C, capitalized R, dash, seven,
    zero, eight, capitalized A, four, capitalized D" — fifteen seconds nobody
    could write down."""
    from rehab_adherence.goal import reference, spoken_reference
    from rehab_adherence.model import CourseFile

    course_file = CourseFile.parse(json.loads(EXAMPLE.read_text(encoding="utf-8")))
    for patient in course_file.patients:
        code = reference(course_file.clinic, course_file.course, patient)
        assert code.isdigit(), "letters get spelled out with case names"
        assert len(code) == 6
        assert "0" not in code and "1" not in code, "oh/one confusion when spoken"
        assert spoken_reference(code) == f"{code[:2]} {code[2:4]} {code[4:]}"


def test_a_slot_taken_by_an_unconfirmed_person_is_not_a_booking(course_file: CourseFile) -> None:
    """Regression from a real call. The caller asked for the patient, never got a
    clear confirmation, and still took a booking. CALL-E reported
    reached_patient="unknown" alongside a chosen slot.

    Recording that as booked puts an unverified person's word in the record.
    Discarding it loses a real slot. It goes to a human instead.
    """
    from rehab_adherence.decide import interpret

    reading = interpret(
        "completed",
        {
            "reached_patient": "unknown",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "will_attend",
            "chosen_slot_id": "s2",
            "barrier": "none",
            "symptom_volunteered": "no",
            "evidence_summary": "The person said OK and chose Tuesday.",
        },
        course_file.course,
    )
    assert reading.outcome == "identity_unconfirmed"
    assert reading.escalate_to_clinician is True
    assert reading.promised_date is None, "an unverified booking must not become a date"


def test_unknown_identity_alone_is_not_a_no_answer(course_file: CourseFile) -> None:
    """Only an explicit "no" means the patient was not reached. "unknown" with a
    real conversation behind it must not be collapsed into no_answer, which is
    what discarded a completed booking on the first live call."""
    from rehab_adherence.decide import interpret

    reading = interpret(
        "completed",
        {
            "reached_patient": "unknown",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "cannot_attend",
            "chosen_slot_id": "none",
            "barrier": "transport",
            "symptom_volunteered": "no",
            "evidence_summary": "No transport.",
        },
        course_file.course,
    )
    assert reading.outcome == "cannot_attend", "unknown is not no"


def test_terminal_status_is_reread_when_the_result_is_not_yet_finalised() -> None:
    """Regression from a real call: wait_for_result returned status "completed"
    with structured_result still null, while a read moments later had the full
    post-call summary. Reporting the first read recorded a booking as no_answer.
    """
    from rehab_adherence.calle import LivePort

    finalised = {
        "status": "completed",
        "structured_result": {"reached_patient": "yes", "attendance_intent": "will_attend"},
        "recipients": [],
    }

    class Racing(LivePort):
        def __init__(self) -> None:
            self._timeout_seconds = 1
            self._checkpoint = None
            self._settle_seconds = 0.0
            self._replay_after_seconds = 120.0
            self.get_calls = 0
            outer = self

            class _Calls:
                @staticmethod
                def create(**_k):
                    return {"id": "call_x"}

                @staticmethod
                def wait_for_result(*_a, **_k):
                    return {"status": "completed", "structured_result": None, "recipients": []}

                @staticmethod
                def get(_call_id):
                    outer.get_calls += 1
                    return finalised

            class _Client:
                calls = _Calls()

            self._client = _Client()

    port = Racing()
    result = port.place({"task": "x"}, patient_id="p_ivy")
    assert port.get_calls == 1, "must re-read once when the result is still null"
    assert result["structured_result"]["attendance_intent"] == "will_attend"


def test_idempotency_key_changes_when_the_request_changes(raw: dict) -> None:
    """Regression from a real run. The key was derived only from course, patient,
    action and attempt count. Editing the patient's name changed what the
    recipient would hear but not the key, so CALL-E rejected the request with
    "Idempotency key was reused with a different request" and no call was placed.

    Replaying an unchanged request must still dedupe.
    """
    from rehab_adherence.decide import decide
    from rehab_adherence.goal import build_task, idempotency_key

    def key_for(document: dict) -> str:
        course_file = CourseFile.parse(document)
        patient = course_file.patients[0]
        decision = decide(patient, course_file.course, course_file.policy, TODAY)
        task = build_task(course_file.clinic, course_file.course, patient, decision)
        return idempotency_key(course_file.course, patient, decision, task)

    baseline = key_for(raw)
    assert key_for(json.loads(json.dumps(raw))) == baseline, "an unchanged request must dedupe"

    renamed = json.loads(json.dumps(raw))
    renamed["patients"][0]["first_name"] = "Someone Else"
    assert key_for(renamed) != baseline, "a different spoken name is a different request"

    reslotted = json.loads(json.dumps(raw))
    reslotted["course"]["offered_slots"][0]["label"] = "Friday 21 August, 4:00pm"
    assert key_for(reslotted) != baseline, "different offered times are a different request"


def test_voicemail_is_told_nothing_clinical(course_file: CourseFile) -> None:
    """Regression from a real call. It went to voicemail and the caller
    volunteered "about arranging attendance after one missed session", which tells
    anyone who plays the message back that this person is a cardiac rehab patient
    who has been missing appointments.

    A voicemail is not a private channel. Name, clinic, callback number.
    """
    for decision, _ in plan(course_file, TODAY):
        if not decision.will_call:
            continue
        patient = next(p for p in course_file.patients if p.id == decision.patient_id)
        task = build_task(course_file.clinic, course_file.course, patient, decision)
        assert "If you reach voicemail" in task
        assert "do not explain why you are calling" in task
        for forbidden in ("missed sessions, or health", "the programme"):
            assert forbidden in task, "the voicemail rule must name what is off limits"


def test_voicemail_is_detected_when_the_status_says_completed(course_file: CourseFile) -> None:
    """CALL-E reported a voicemail as status "completed" with reached_patient
    "no". Reading status alone recorded it as no_answer, losing the distinction
    between "a message was left" and "nothing was communicated"."""
    from rehab_adherence.decide import interpret

    reading = interpret(
        "completed",
        {
            "reached_patient": "no",
            "continued_after_ai_disclosure": "unknown",
            "attendance_intent": "unknown",
            "chosen_slot_id": "none",
            "barrier": "unknown",
            "symptom_volunteered": "no",
            "evidence_summary": "Voicemail said he was on the phone and asked the caller to leave a message.",
        },
        course_file.course,
        evidence=[
            "The call reached a voicemail message saying the recipient was on another call.",
            "A short message was left, but no live conversation occurred.",
        ],
    )
    assert reading.outcome == "voicemail", "a voicemail is not a plain no_answer"


def test_a_genuine_no_answer_is_still_a_no_answer(course_file: CourseFile) -> None:
    """The voicemail heuristic reads free text, so it must not swallow every
    unreached call."""
    from rehab_adherence.decide import interpret

    reading = interpret(
        "completed",
        {
            "reached_patient": "no",
            "continued_after_ai_disclosure": "unknown",
            "attendance_intent": "unknown",
            "chosen_slot_id": "none",
            "barrier": "unknown",
            "symptom_volunteered": "no",
            "evidence_summary": "Someone else answered and hung up.",
        },
        course_file.course,
        evidence=["The call was answered briefly and ended."],
    )
    assert reading.outcome == "no_answer"


# --- the concession ladder ------------------------------------------------------


def test_only_authorised_offers_reach_the_caller(raw: dict) -> None:
    """The ladder is a whitelist. The caller is told exactly what it may offer,
    and a remedy the clinic never granted must not appear in the goal text."""
    course_file = CourseFile.parse(raw)
    for decision, _ in plan(course_file, TODAY):
        if not decision.will_call:
            continue
        patient = next(p for p in course_file.patients if p.id == decision.patient_id)
        task = build_task(course_file.clinic, course_file.course, patient, decision)
        if "You may offer only the following" not in task:
            continue
        for concession in course_file.course.concessions:
            assert concession.offer in task
        assert "do not invent an offer" in task
        assert "Offer nothing that is not on that list" in task


def test_an_unauthorised_concession_is_not_recorded(course_file: CourseFile) -> None:
    """If the caller reports spending something the clinic never granted, the
    ledger must not accept it. The ledger is the clinic's account of what it
    spent; an invented entry would corrupt it."""
    from rehab_adherence.decide import interpret

    reading = interpret(
        "completed",
        {
            "reached_patient": "yes",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "will_attend",
            "chosen_slot_id": "s1",
            "barrier": "cost",
            "concession_offered": "free_parking_for_a_year",
            "concession_accepted": "yes",
            "symptom_volunteered": "no",
            "evidence_summary": "Offered free parking.",
        },
        course_file.course,
    )
    assert reading.outcome == "promised_return"
    assert reading.concession_spent is None, "an ungranted offer must not enter the record"


def test_the_tier_actually_spent_is_recorded(course_file: CourseFile) -> None:
    """The clinic needs to know what keeping this patient cost, not just that it
    worked."""
    from rehab_adherence.decide import interpret

    reading = interpret(
        "completed",
        {
            "reached_patient": "yes",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "will_attend",
            "chosen_slot_id": "s2",
            "barrier": "transport",
            "concession_offered": "taxi_voucher",
            "concession_accepted": "yes",
            "symptom_volunteered": "no",
            "evidence_summary": "Took the voucher.",
        },
        course_file.course,
    )
    assert reading.concession_spent == "taxi_voucher"
    assert "tier 2" in reading.note


def test_a_discharge_call_never_negotiates(course_file: CourseFile) -> None:
    """Someone who has said they are finished must not be bargained with. Only
    the two rebooking actions carry the ladder."""
    from rehab_adherence.decide import decide

    kai = next(p for p in course_file.patients if p.id == "p_kai")
    decision = decide(kai, course_file.course, course_file.policy, TODAY)
    assert decision.action == "call_confirm_discharge"
    task = build_task(course_file.clinic, course_file.course, kai, decision)
    assert "You may offer only the following" not in task
    for concession in course_file.course.concessions:
        assert concession.offer not in task


def test_a_concession_referencing_an_unknown_barrier_is_rejected(raw: dict) -> None:
    """Nothing is guessed. A `when` the schema cannot express is a configuration
    error, not something to silently ignore."""
    broken = json.loads(json.dumps(raw))
    broken["course"]["concessions"] = [
        {"id": "x", "tier": 1, "offer": "something", "when": ["whenever_they_like"]}
    ]
    with pytest.raises(InputError):
        CourseFile.parse(broken)


# --- the recommendation ---------------------------------------------------------


def test_recommendations_are_logistics_never_clinical() -> None:
    """A next step a receptionist can act on. "Arrange transport" is logistics;
    "review their symptoms" is assessment and must not appear."""
    from rehab_adherence.decide import recommend

    outcomes = [
        "promised_return", "cannot_attend", "voicemail", "no_answer", "undecided",
        "symptom_reported", "refused_contact", "stopped_feels_better",
        "identity_unconfirmed",
    ]
    forbidden = ("diagnos", "symptoms are", "treatment", "medication", "dosage", "prognos")
    seen = set()
    for trajectory in ("first_slip", "early_slip", "disengaging", "broken_promise", "lapsed"):
        for outcome in outcomes:
            for barrier in (None, "transport", "cost", "work_or_childcare"):
                text = recommend(trajectory, outcome, barrier, None)
                seen.add(text)
                assert text and isinstance(text, str)
                for word in forbidden:
                    assert word not in text.lower(), f"clinical language in: {text}"
    assert len(seen) > 5, "the recommendation must actually vary with the situation"


def test_a_volunteered_symptom_recommends_a_clinician_and_no_rebooking() -> None:
    from rehab_adherence.decide import recommend

    text = recommend("disengaging", "symptom_reported", "health_concern", None)
    assert "clinician" in text
    assert "do not rebook" in text


def test_the_ledger_keeps_the_note_the_call_produced(course_file: CourseFile, tmp_path: Path) -> None:
    """CALL-E writes a one-line summary of what was actually said. Extracting the
    barrier from it and then discarding the sentence leaves a clinician with a
    category and no words behind it."""
    responses = json.loads(RESPONSES.read_text(encoding="utf-8"))
    rows = run(course_file, TODAY, FixturePort(responses))
    omar = next(r for r in rows if r.patient_id == "p_omar")
    assert omar.evidence_summary, "the call's own note must survive into the ledger"
    assert "taxi voucher" in omar.evidence_summary

    output = tmp_path / "l.jsonl"
    write_jsonl(output, rows)
    written = output.read_text(encoding="utf-8")
    assert "taxi voucher" in written
    for patient in course_file.patients:
        assert patient.phone_e164 not in written, "notes must not reintroduce a number"


def test_a_replayed_call_is_reported_as_such(tmp_path: Path) -> None:
    """Regression from a real run. Re-running an unchanged plan produced the same
    idempotency key, so CALL-E returned a call placed twenty minutes earlier —
    and the run printed it as a fresh, successful call. Nobody's phone rang.

    Believing a patient was called when they were not is not a cosmetic fault.
    """
    from rehab_adherence.calle import LivePort

    class Replaying(LivePort):
        def __init__(self, created_at: str) -> None:
            self._timeout_seconds = 1
            self._checkpoint = None
            self._settle_seconds = 0.0
            self._replay_after_seconds = 120.0

            class _Calls:
                @staticmethod
                def create(**_k):
                    return {"id": "call_old", "created_at": created_at}

                @staticmethod
                def wait_for_result(*_a, **_k):
                    return {
                        "status": "completed",
                        "structured_result": {"reached_patient": "yes"},
                        "recipients": [],
                    }

            class _Client:
                calls = _Calls()

            self._client = _Client()

    stale = Replaying("2020-01-01T00:00:00Z").place({"task": "x"}, patient_id="p")
    assert stale["replayed"] is True
    assert stale["replayed_from"] == "2020-01-01T00:00:00Z"

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    assert Replaying(now).place({"task": "x"}, patient_id="p")["replayed"] is False


def test_a_missing_created_at_never_fabricates_a_replay_warning() -> None:
    """Unknown age reads as zero. A provider that stops returning created_at must
    not turn every call into a false warning."""
    from rehab_adherence.calle import _age_seconds

    assert _age_seconds(None) == 0.0
    assert _age_seconds("not a timestamp") == 0.0
    assert _age_seconds("2020-01-01T00:00:00Z") > 1_000_000


def test_the_caller_is_told_an_offer_is_not_a_time(course_file: CourseFile) -> None:
    """Live call, 9 Sep: the patient accepted a taxi voucher and the caller booked
    a Thursday they had explicitly not agreed to. Two separate agreements."""
    for decision, _ in plan(course_file, TODAY):
        if not decision.will_call:
            continue
        patient = next(p for p in course_file.patients if p.id == decision.patient_id)
        task = build_task(course_file.clinic, course_file.course, patient, decision)
        if "You may offer only the following" not in task:
            continue
        assert "Accepting an offer is not accepting a time" in task
        assert "Settle the offer first" in task


def test_every_call_can_handle_someone_changing_their_mind(course_file: CourseFile) -> None:
    """Same call: they said "no, sorry, no no no" mid-confirmation and the caller
    thanked them and rang off. People retract. Every script must allow it."""
    for decision, _ in plan(course_file, TODAY):
        if not decision.will_call:
            continue
        patient = next(p for p in course_file.patients if p.id == decision.patient_id)
        task = build_task(course_file.clinic, course_file.course, patient, decision)
        assert "take something back or change their mind" in task
        assert "never end the call while they are still objecting" in task
