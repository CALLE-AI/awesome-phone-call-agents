"""Regressions for the survey. Each one guards a way the study could flatter itself."""

from __future__ import annotations

import json
import pathlib

import pytest

from survey import (
    Disposition,
    Drawn,
    Entry,
    EthicsViolation,
    Interview,
    LOCKED_ETHICS,
    NumberRejected,
    Record,
    Report,
    Response,
    build_report,
    check_topic,
    collect_answers,
    draw_sample,
    load_study,
    main,
    mask,
    merge_ethics,
    render,
    run_fieldwork,
    withdraw,
)

STUDY = pathlib.Path(__file__).parent / "example-study.json"


def frame(size: int = 20) -> list[Entry]:
    return [
        Entry(id=f"r{i:02d}", phone=f"+1555010{1000 + i}", stratum="rural")
        for i in range(1, size + 1)
    ]


def record(person: str, disposition: Disposition, **kw) -> Record:
    drawn = Drawn(entry=Entry(person, "+15550101001"), window=kw.pop("window", "Sat 10-14"))
    interview = Interview(person_id=person, disposition=disposition, **kw)
    return Record(drawn=drawn, interview=interview)


# -- the sample is reproducible ----------------------------------------------------------


def test_the_same_seed_draws_the_same_people_and_windows():
    """A sample nobody else can redraw cannot be checked by anybody."""
    first = draw_sample(frame(), 8, seed=4242)
    second = draw_sample(frame(), 8, seed=4242)

    assert [d.entry.id for d in first] == [d.entry.id for d in second]
    assert [d.window for d in first] == [d.window for d in second]


def test_a_different_seed_draws_a_different_sample():
    a = [d.entry.id for d in draw_sample(frame(), 8, seed=1)]
    b = [d.entry.id for d in draw_sample(frame(), 8, seed=2)]
    assert a != b


def test_contact_windows_are_spread_rather_than_all_at_once():
    """Calling everyone at eleven samples the people who are home at eleven."""
    windows = {d.window for d in draw_sample(frame(), 12, seed=20260803)}
    assert len(windows) > 1


def test_drawing_more_than_the_frame_holds_is_refused():
    with pytest.raises(ValueError):
        draw_sample(frame(5), 6, seed=1)


def test_nobody_is_drawn_twice():
    ids = [d.entry.id for d in draw_sample(frame(), 20, seed=7)]
    assert len(ids) == len(set(ids))


def test_a_person_appearing_twice_in_a_sample_is_refused():
    entry = Entry("r01", "+15550101001")
    duplicated = [Drawn(entry, "Sat 10-14"), Drawn(entry, "Sat 10-14")]
    with pytest.raises(RuntimeError, match="contacted once"):
        run_fieldwork(duplicated, {})


# -- locked ethics -----------------------------------------------------------------------


@pytest.mark.parametrize("locked", sorted(LOCKED_ETHICS))
def test_a_study_cannot_redefine_a_locked_rule(locked):
    """A consent requirement that configuration can switch off is not a requirement."""
    with pytest.raises(EthicsViolation, match="locked"):
        merge_ethics({locked: "actually, never mind"})


def test_a_study_may_add_rules_of_its_own():
    merged = merge_ethics({"state_duration": "Say how long it takes."})
    assert "state_duration" in merged
    assert set(LOCKED_ETHICS) <= set(merged)


def test_no_answers_may_be_recorded_without_consent():
    with pytest.raises(EthicsViolation, match="without consent"):
        Interview(
            person_id="r01",
            disposition=Disposition.COMPLETED,
            consent_given=False,
            responses=[Response("Q", raw="something", category="x")],
        )


def test_a_refusal_carries_no_answers_at_all():
    interview = Interview(
        person_id="r01", disposition=Disposition.CONSENT_REFUSED, consent_given=False
    )
    assert interview.responses == []


@pytest.mark.parametrize(
    "subject",
    [
        "Medication adherence in rural districts",
        "Attitudes towards a pending lawsuit",
        "Household debt and credit use",
        "Emergency response times",
    ],
)
def test_high_risk_subjects_are_refused_not_handled(subject):
    with pytest.raises(EthicsViolation, match="high-risk"):
        check_topic(subject)


def test_an_ordinary_subject_passes():
    check_topic("Public transport in rural districts")


def test_a_high_risk_question_is_refused_even_under_a_benign_subject():
    """A benign subject is no licence: every single question is screened too."""
    with pytest.raises(EthicsViolation, match="question touches a high-risk"):
        Response(
            question="Which medication do you take every day?",
            raw="I would rather not say.",
        )


def test_a_fixture_with_a_high_risk_question_is_refused_by_the_cli(tmp_path, capsys):
    bad = tmp_path / "benign-subject-risky-question.json"
    bad.write_text(
        json.dumps(
            {
                "subject": "Public transport in rural districts",
                "seed": 1,
                "sample_size": 1,
                "frame": [{"id": "r01", "phone": "+15550101001"}],
                "fieldwork": {
                    "r01": {
                        "disposition": "completed",
                        "consent_given": True,
                        "responses": [
                            {
                                "question": "How is your household debt developing?",
                                "raw": "Fine, I suppose.",
                            }
                        ],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    assert main(["--fixture", str(bad)]) == 2
    assert "high-risk" in capsys.readouterr().err


def test_broke_off_partial_answers_are_deleted_not_kept():
    """The documented rule: a break-off keeps no partial answers."""
    interview = Interview(
        person_id="r13",
        disposition=Disposition.BROKE_OFF,
        consent_given=True,
        responses=[Response("Q1", raw="Half an answer before hanging up.")],
    )
    assert interview.responses == []


def test_broke_off_answers_reach_no_output():
    rec = record(
        "r13",
        Disposition.BROKE_OFF,
        consent_given=True,
        responses=[Response("Q1", raw="Half an answer.", category="half")],
    )
    assert collect_answers([rec]) == []
    report = build_report("s", 1, [rec])
    assert report.dispositions == {"broke_off": 1}


# -- coding stays checkable --------------------------------------------------------------


def test_a_category_without_the_words_it_came_from_is_refused():
    """An unfalsifiable code is worse than no code."""
    with pytest.raises(EthicsViolation, match="cannot be checked"):
        Response(question="Q", raw="   ", category="satisfied")


def test_raw_and_category_travel_together():
    rec = record(
        "r01",
        Disposition.COMPLETED,
        consent_given=True,
        responses=[Response("How often?", raw="About once a week.", category="weekly")],
    )
    rows = collect_answers([rec])
    assert rows[0]["raw"] == "About once a week."
    assert rows[0]["category"] == "weekly"


def test_a_raw_answer_may_stand_without_a_category():
    """Uncoded is honest. Coded-without-source is not."""
    response = Response(question="Q", raw="Something nobody has coded yet.")
    assert response.category is None


# -- the denominator ---------------------------------------------------------------------


def test_yield_is_measured_against_included_drawn_not_against_reached():
    records = [
        record("a", Disposition.COMPLETED, consent_given=True),
        record("b", Disposition.CONSENT_REFUSED),
        record("c", Disposition.NO_ANSWER),
        record("d", Disposition.NO_ANSWER),
    ]
    report = build_report("s", 1, records)

    assert report.included_drawn == 4
    assert report.reached == 2
    assert report.completion_yield == pytest.approx(0.25)
    assert report.flattering_yield == pytest.approx(0.5)
    assert report.completion_yield != report.flattering_yield


def test_the_report_states_which_denominator_it_used():
    report = build_report("s", 1, [record("a", Disposition.COMPLETED, consent_given=True)])
    assert report.to_dict()["completion_yield_basis"] == "completed / included drawn"
    assert "not_the_result" in json.dumps(report.to_dict())


def test_non_response_is_broken_out_by_window():
    records = [
        record("a", Disposition.COMPLETED, consent_given=True, window="Mon-Fri 09-12"),
        record("b", Disposition.NO_ANSWER, window="Mon-Fri 09-12"),
        record("c", Disposition.NO_ANSWER, window="Sat 10-14"),
    ]
    report = build_report("s", 1, records)
    assert report.by_window["Mon-Fri 09-12"]["no_answer"] == 1
    assert report.by_window["Sat 10-14"]["no_answer"] == 1


def test_dispositions_stay_distinct():
    records = [
        record("a", Disposition.CONSENT_REFUSED),
        record("b", Disposition.BROKE_OFF, consent_given=True),
        record("c", Disposition.NO_ANSWER),
        record("d", Disposition.BUSY),
        record("e", Disposition.INELIGIBLE, consent_given=True),
    ]
    report = build_report("s", 1, records)
    assert report.dispositions == {
        "consent_refused": 1,
        "broke_off": 1,
        "no_answer": 1,
        "busy": 1,
        "ineligible": 1,
    }


def test_an_empty_denominator_does_not_divide_by_zero():
    assert Report("s", 1, 0, 0, {}, {}).completion_yield == 0.0
    assert Report("s", 1, 0, 0, {}, {}).flattering_yield == 0.0


# -- withdrawal --------------------------------------------------------------------------


def test_withdrawal_removes_the_identifier_the_number_and_the_answers():
    rec = record(
        "r01",
        Disposition.COMPLETED,
        consent_given=True,
        responses=[Response("Q", raw="Rarely.", category="rarely")],
    )
    withdraw(rec)

    assert rec.person_id == "<withdrawn>"
    assert rec.phone_masked == ""
    assert rec.interview is None
    assert collect_answers([rec]) == []


def test_withdrawal_deletes_the_data_not_only_the_view():
    """A withdrawal is a deletion, not a flag: after it, the id and phone are gone
    from `Record.drawn` and the interview -- person id, note, answers -- is gone
    from memory, not merely hidden from the rendered output."""
    rec = record(
        "r01",
        Disposition.COMPLETED,
        consent_given=True,
        responses=[Response("Q", raw="Rarely.", category="rarely")],
        note="Asked to be removed the next day.",
    )
    withdraw(rec)

    assert rec.withdrawn is True
    assert rec.drawn is None
    assert rec.interview is None


def test_a_withdrawn_record_leaves_every_denominator():
    """Not a flag on a row that stays. The person asked to leave the data."""
    records = [
        record("a", Disposition.COMPLETED, consent_given=True),
        record("b", Disposition.COMPLETED, consent_given=True),
        record("c", Disposition.NO_ANSWER),
    ]
    withdraw(records[1])
    report = build_report("s", 1, records)

    assert report.drawn == 3
    assert report.withdrawn == 1
    assert report.included_drawn == 2
    assert report.completed == 1  # the withdrawn completion no longer counts
    assert report.completion_yield == pytest.approx(0.5)


def test_a_withdrawn_person_appears_in_no_output():
    _, seed, size, ethics, entries, fieldwork = load_study(STUDY)
    records = run_fieldwork(draw_sample(entries, size, seed), fieldwork)
    withdrawn = [r for r in records if r.withdrawn]
    assert withdrawn, "the shipped study contains a withdrawal"

    report = build_report("s", seed, records)
    text = render(report, collect_answers(records), ethics) + json.dumps(report.to_dict())
    assert "r03" not in text
    assert "+15550101003" not in text


# -- numbers -----------------------------------------------------------------------------


def test_invalid_number_is_refused_before_processing():
    with pytest.raises(NumberRejected):
        Entry("r01", "0170 1234567")


def test_no_full_number_appears_in_any_output():
    _, seed, size, ethics, entries, fieldwork = load_study(STUDY)
    sample = draw_sample(entries, size, seed)
    records = run_fieldwork(sample, fieldwork)
    report = build_report("s", seed, records)

    text = render(report, collect_answers(records), ethics) + json.dumps(report.to_dict())
    for entry in entries:
        assert entry.phone not in text, entry.phone


def test_mask_keeps_prefix_and_two_digits():
    assert mask("+15550101005") == "+15*******05"


# -- the shipped study -------------------------------------------------------------------


def test_the_shipped_study_reports_the_honest_yield():
    _, seed, size, _, entries, fieldwork = load_study(STUDY)
    records = run_fieldwork(draw_sample(entries, size, seed), fieldwork)
    report = build_report("s", seed, records)

    assert report.drawn == 12
    assert report.withdrawn == 1
    assert report.included_drawn == 11
    assert report.completed == 4
    assert report.completion_yield == pytest.approx(4 / 11)
    assert report.flattering_yield == pytest.approx(4 / 7)


def test_cli_runs_without_network_and_marks_the_run(capsys):
    assert main(["--fixture", str(STUDY)]) == 0
    out = capsys.readouterr().out
    assert "NO CALL PLACED" in out
    assert "4 of 11 included drawn" in out
    assert "not the result" in out


def test_cli_json_carries_the_locked_rules_and_the_basis(capsys):
    assert main(["--fixture", str(STUDY), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert payload["completion_yield_basis"] == "completed / included drawn"
    assert set(LOCKED_ETHICS) <= set(payload["ethics"])
    assert payload["included_drawn"] == 11


def test_a_study_on_a_high_risk_subject_is_refused_by_the_cli(tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text(
        json.dumps(
            {
                "subject": "Medication adherence",
                "seed": 1,
                "sample_size": 1,
                "frame": [{"id": "r01", "phone": "+15550101001"}],
            }
        ),
        encoding="utf-8",
    )
    assert main(["--fixture", str(bad)]) == 2
    assert "high-risk" in capsys.readouterr().err
