"""Regressions for the aggregation. Each one guards a way the summary could lie."""

from __future__ import annotations

import json
import pathlib

import pytest

from aggregate import (
    Answer,
    Bucket,
    NumberRejected,
    Participant,
    Stance,
    Status,
    apply_catch_up,
    classify,
    load_fixture,
    main,
    mask,
    merge_opinions,
    merge_schedule,
    pending_for_catch_up,
    render_opinions,
    render_schedule,
)

HERE = pathlib.Path(__file__).parent
SCHEDULE = HERE / "example-schedule.json"
OPINIONS = HERE / "example-opinions.json"


def people(count: int = 4) -> list[Participant]:
    names = ["Ana", "Ben", "Cleo", "Dara", "Emil", "Fay"]
    return [
        Participant(id=names[i].lower(), name=names[i], phone=f"+1555010010{i + 1}")
        for i in range(count)
    ]


# -- the denominator ---------------------------------------------------------------------


def test_basis_names_answered_over_invited():
    persons = people(4)
    answers = {
        "ana": Answer("ana", Status.COMPLETED),
        "ben": Answer("ben", Status.NO_ANSWER),
        "cleo": Answer("cleo", Status.DECLINED),
    }
    coverage = classify(persons, answers)
    assert coverage.basis == "1 answered / 4 invited"
    assert coverage.is_complete is False


def test_unreached_are_never_counted_as_indifferent():
    """The people who did not answer must not silently join any group."""
    persons = people(3)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, choice="A"),
        "ben": Answer("ben", Status.NO_ANSWER),
        "cleo": Answer("cleo", Status.BUSY),
    }
    coverage, result = merge_opinions(persons, answers)

    assert sum(result.tally.values()) == 1
    assert result.abstentions == []  # not answering is not abstaining
    assert len(coverage.by_bucket[Bucket.UNREACHED]) == 2
    assert "not counted as indifferent" in coverage.caveat


def test_incomplete_coverage_always_carries_a_caveat():
    persons = people(2)
    coverage = classify(persons, {"ana": Answer("ana", Status.COMPLETED)})
    assert coverage.caveat is not None
    assert "1 pending" in coverage.caveat


def test_complete_coverage_carries_no_caveat():
    persons = people(2)
    answers = {p.id: Answer(p.id, Status.COMPLETED) for p in persons}
    coverage = classify(persons, answers)
    assert coverage.is_complete is True
    assert coverage.caveat is None


# -- statuses stay apart -----------------------------------------------------------------


def test_no_answer_busy_and_declined_do_not_collapse_into_one_group():
    assert Status.NO_ANSWER.bucket is Bucket.UNREACHED
    assert Status.BUSY.bucket is Bucket.UNREACHED
    assert Status.DECLINED.bucket is Bucket.REFUSED
    assert Status.NOT_CALLED.bucket is Bucket.PENDING
    assert Status.UNKNOWN.bucket is Bucket.UNKNOWN
    # Refused and unreached mean different things for a follow-up.
    assert Status.DECLINED.bucket is not Status.NO_ANSWER.bucket


def test_an_uninterpretable_call_lands_in_unknown_not_in_unreached():
    persons = people(1)
    coverage = classify(persons, {"ana": Answer("ana", Status.UNKNOWN)})
    assert coverage.by_bucket[Bucket.UNKNOWN] and not coverage.by_bucket[Bucket.UNREACHED]


# -- silence is not a no -----------------------------------------------------------------


def test_silence_about_a_slot_is_unknown_not_a_refusal():
    persons = people(2)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, stances={"Mon": Stance.WORKS}),
        "ben": Answer("ben", Status.COMPLETED, stances={}),  # answered, said nothing
    }
    _, rows = merge_schedule(["Mon"], persons, answers)
    row = rows[0]

    assert row.works == ["Ana"]
    assert row.cannot == []
    assert row.silent == ["Ben"]


def test_a_slot_nobody_objected_to_is_not_a_slot_that_works_for_everyone():
    """The trap: no 'cannot' does not mean consent."""
    persons = people(2)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, stances={"Mon": Stance.WORKS}),
        "ben": Answer("ben", Status.COMPLETED, stances={}),
    }
    _, rows = merge_schedule(["Mon"], persons, answers)
    assert rows[0].cannot == []
    assert rows[0].works_for_everyone_who_answered is False


def test_a_slot_everyone_confirmed_does_work():
    persons = people(2)
    answers = {
        p.id: Answer(p.id, Status.COMPLETED, stances={"Mon": Stance.WORKS}) for p in persons
    }
    _, rows = merge_schedule(["Mon"], persons, answers)
    assert rows[0].works_for_everyone_who_answered is True


# -- ties --------------------------------------------------------------------------------


def test_a_tie_stays_a_tie():
    persons = people(4)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, choice="A"),
        "ben": Answer("ben", Status.COMPLETED, choice="B"),
        "cleo": Answer("cleo", Status.COMPLETED, choice="A"),
        "dara": Answer("dara", Status.COMPLETED, choice="B"),
    }
    _, result = merge_opinions(persons, answers)

    assert result.is_tie is True
    assert result.leaders == ["A", "B"]


def test_a_clear_lead_is_reported_as_one():
    persons = people(3)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, choice="A"),
        "ben": Answer("ben", Status.COMPLETED, choice="A"),
        "cleo": Answer("cleo", Status.COMPLETED, choice="B"),
    }
    _, result = merge_opinions(persons, answers)
    assert result.is_tie is False
    assert result.leaders == ["A"]


def test_abstention_is_recorded_and_not_turned_into_a_vote():
    persons = people(2)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, choice="A"),
        "ben": Answer("ben", Status.COMPLETED, abstained=True),
    }
    _, result = merge_opinions(persons, answers)
    assert result.tally == {"A": 1}
    assert result.abstentions == ["Ben"]


# -- conditions and reasons survive ------------------------------------------------------


def test_conditions_and_reasons_are_kept_with_the_raw_line():
    persons = people(1)
    answers = {
        "ana": Answer(
            "ana",
            Status.COMPLETED,
            raw="Green Table, but only with the vegan option.",
            choice="Green Table",
            conditions=("only with the vegan option",),
            reason="The spring event went well.",
        )
    }
    _, result = merge_opinions(persons, answers)

    assert result.conditions == [
        {"who": "Ana", "condition": "only with the vegan option"}
    ]
    assert result.reasons[0]["reason"] == "The spring event went well."
    assert result.reasons[0]["raw"].startswith("Green Table, but only")


def test_the_raw_answer_travels_beside_the_interpretation():
    _, _, _, persons, answers = load_fixture(OPINIONS)
    _, result = merge_opinions(persons, answers)
    text = render_opinions("q", *merge_opinions(persons, answers))
    assert "raw:" in text
    assert any(item["raw"] for item in result.reasons)


# -- catch-up ----------------------------------------------------------------------------


def test_catch_up_targets_only_pending_and_unreached():
    persons = people(4)
    answers = {
        "ana": Answer("ana", Status.COMPLETED),
        "ben": Answer("ben", Status.DECLINED),
        "cleo": Answer("cleo", Status.NO_ANSWER),
        # dara was never called
    }
    targets = [p.id for p in pending_for_catch_up(persons, answers)]
    assert sorted(targets) == ["cleo", "dara"]
    assert "ana" not in targets  # already answered
    assert "ben" not in targets  # refusing is an answer


def test_catch_up_does_not_overwrite_an_existing_answer():
    persons = people(2)
    answers = {
        "ana": Answer("ana", Status.COMPLETED, choice="A"),
        "ben": Answer("ben", Status.NO_ANSWER),
    }
    allowed = pending_for_catch_up(persons, answers)
    fresh = {
        "ana": Answer("ana", Status.COMPLETED, choice="CHANGED"),
        "ben": Answer("ben", Status.COMPLETED, choice="B"),
    }
    merged = apply_catch_up(answers, fresh, allowed)

    assert merged["ana"].choice == "A"
    assert merged["ben"].choice == "B"


# -- numbers -----------------------------------------------------------------------------


def test_invalid_number_is_refused_before_processing():
    with pytest.raises(NumberRejected):
        Participant("x", "Bad", "0170 1234567")


def test_no_full_number_appears_in_either_output():
    for path, renderer, merger in (
        (SCHEDULE, "schedule", merge_schedule),
        (OPINIONS, "opinion", merge_opinions),
    ):
        _, question, slots, persons, answers = load_fixture(path)
        if renderer == "schedule":
            coverage, payload = merge_schedule(slots, persons, answers)
            text = render_schedule(question, coverage, payload)
            structured = json.dumps(
                {"c": coverage.to_dict(), "s": [r.to_dict() for r in payload]}
            )
        else:
            coverage, payload = merge_opinions(persons, answers)
            text = render_opinions(question, coverage, payload)
            structured = json.dumps({"c": coverage.to_dict(), "r": payload.to_dict()})

        for person in persons:
            assert person.phone not in text + structured, person.phone
        assert mask(persons[0].phone) in structured


# -- the shipped fixtures ----------------------------------------------------------------


def test_schedule_fixture_tells_the_intended_story():
    _, _, slots, persons, answers = load_fixture(SCHEDULE)
    coverage, rows = merge_schedule(slots, persons, answers)
    by_slot = {r.slot: r for r in rows}

    assert coverage.basis == "4 answered / 6 invited"
    # Tuesday: everyone who answered confirmed it.
    assert by_slot["Tue 19:00"].works_for_everyone_who_answered is True
    # Wednesday: nobody objected, but Cleo never mentioned it. Not a match.
    assert by_slot["Wed 19:00"].cannot == []
    assert by_slot["Wed 19:00"].silent == ["Cleo"]
    assert by_slot["Wed 19:00"].works_for_everyone_who_answered is False
    # Thursday: one refusal, the rest silent.
    assert by_slot["Thu 19:00"].cannot == ["Ana"]


def test_opinion_fixture_ends_in_an_unbroken_tie():
    _, _, _, persons, answers = load_fixture(OPINIONS)
    coverage, result = merge_opinions(persons, answers)

    assert coverage.basis == "5 answered / 6 invited"
    assert result.tally == {"Green Table": 2, "Hearth and Co": 2}
    assert result.is_tie is True
    assert result.abstentions == ["Emil"]
    assert len(result.conditions) == 2


def test_cli_schedule_marks_the_run_and_names_the_basis(capsys):
    assert main(["--fixture", str(SCHEDULE)]) == 0
    out = capsys.readouterr().out
    assert "NO CALL PLACED" in out
    assert "4 answered / 6 invited" in out
    assert "silent (unknown, not a no)" in out


def test_cli_opinions_reports_the_tie_without_breaking_it(capsys):
    assert main(["--fixture", str(OPINIONS)]) == 0
    out = capsys.readouterr().out
    assert "Tie between" in out
    assert "It is not broken here." in out


def test_cli_json_output_is_valid_and_marked(capsys):
    assert main(["--fixture", str(SCHEDULE), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "fixture / simulated / no-call"
    assert payload["coverage"]["complete"] is False
