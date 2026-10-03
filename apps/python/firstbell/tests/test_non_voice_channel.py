"""The families a telephone cannot reach.

This app is argued for on language access, and a voice-only tool argued for that way has a
second obligation it is easy to miss: a guardian who is deaf, hard of hearing, or has a
speech disability cannot take the call at all. Before this, the app dialled them, reached
nothing, and filed them as `failed`, which on a report reads as "nobody answered". The
family was reachable. The channel was not, and the record said the opposite.

These tests hold the four things that fix has to be true of: the row is not dialled, it is
not a failure, it goes to a person, and the column that drives it is never guessed at.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from calle_double import CalleDouble, Outcome, build_client
from dispatch import (
    CANCELLED,
    NO_CONSENT,
    NO_VOICE_CHANNEL,
    CsvSource,
    ItemResult,
    Resolution,
    SourceError,
    WaveDispatcher,
    WorkItem,
)
from firstbell.domain import summarise

SCHEMA = {
    "type": "object",
    "required": ["reason"],
    "properties": {"reason": {"type": "string"}},
}
GOOD = {"reason": "illness"}
TALK = [("bot", "Calling about this morning."), ("user", "She is unwell.")]


@pytest.fixture
def double() -> CalleDouble:
    return CalleDouble(latency_seconds=0.0)


def make(double: CalleDouble, **kwargs) -> WaveDispatcher:
    kwargs.setdefault("task_builder", lambda i: f"Ask about {i.id}.")
    kwargs.setdefault("result_schema", SCHEMA)
    kwargs.setdefault("poll_interval_seconds", 0)
    kwargs.setdefault("sleep", lambda _s: None)
    return WaveDispatcher(build_client(double), **kwargs)


def write(tmp_path, text: str):
    path = tmp_path / "work.csv"
    path.write_text(text, encoding="utf-8", newline="")
    return path


# --------------------------------------------------------------------------
# The gate
# --------------------------------------------------------------------------

def test_a_family_the_phone_cannot_reach_is_never_dialled(double):
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    report = make(double).run([
        WorkItem(id="voice", phones=("+9155500001",)),
        WorkItem(id="no-voice", phones=("+9155500002",), reachable_by_voice=False),
    ])

    by_id = {r.item.id: r for r in report.results}
    assert by_id["no-voice"].resolution is Resolution.SKIPPED
    assert by_id["no-voice"].reason == NO_VOICE_CHANNEL
    assert double.dialled == ["+9155500001"], (
        "a family recorded as unreachable by telephone was telephoned"
    )


def test_that_family_is_not_filed_as_nobody_answered(double):
    """The specific wrong record this exists to stop.

    A failure means every number was tried and none of them answered. Nothing was tried
    here, so the row is not in that count, and it is not in the denominator of the rate
    either, because a call that was never placed cannot be a call that did not work.
    """
    report = make(double).run([
        WorkItem(id="no-voice", phones=("+9155500002",), reachable_by_voice=False),
    ])
    summary = summarise(report.results)

    assert summary.failed == 0
    assert summary.skipped_no_voice == 1
    assert summary.skipped_no_consent == 0
    assert summary.resolved + summary.undetermined + summary.failed == 0


def test_that_family_lands_on_the_queue_a_person_actually_works(double):
    """A skip that leaves work behind must be visible to whoever does the work.

    An unconsented family is closed business: nobody owes them a call. This family is the
    opposite. Somebody has to reach them another way, and if the row only ever appears in
    a `skipped` total, nobody will.
    """
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    report = make(double).run([
        WorkItem(id="fine", phones=("+9155500001",)),
        WorkItem(id="no-consent", phones=("+9155500003",), consented=False),
        WorkItem(id="no-voice", phones=("+9155500002",), reachable_by_voice=False),
    ])

    queued = [r.item.id for r in report.needs_human]
    assert "no-voice" in queued
    assert "no-consent" not in queued, "nobody owes a call to a family that refused one"
    assert "fine" not in queued
    reason = next(r.reason for r in report.needs_human if r.item.id == "no-voice")
    assert "another way" in reason, (
        "the queue line has to say what the clerk is supposed to do about it"
    )


def test_consent_is_asked_before_the_channel(double):
    """Both gates shut on the same row, and only one reason can be recorded.

    Consent wins. A family that refused to be called is not owed an outreach on a
    different channel, so recording this row as work-to-do would invent an obligation
    nobody has.
    """
    report = make(double).run([
        WorkItem(id="neither", phones=("+9155500004",),
                 consented=False, reachable_by_voice=False),
    ])

    result = report.results[0]
    assert result.reason == NO_CONSENT
    assert result.needs_another_channel is False
    assert report.needs_human == []
    assert double.dialled == []


# --------------------------------------------------------------------------
# The column
# --------------------------------------------------------------------------

def test_the_csv_reads_the_column_and_leaving_it_out_changes_nothing(tmp_path):
    with_column = write(tmp_path, "id,phones,consent,voice\n"
                                  "a,+9155500001,yes,yes\n"
                                  "b,+9155500002,yes,no\n"
                                  "c,+9155500003,yes,\n")
    by_id = {i.id: i for i in CsvSource(with_column).items()}
    assert by_id["a"].reachable_by_voice is True
    assert by_id["b"].reachable_by_voice is False
    assert by_id["c"].reachable_by_voice is True, (
        "a blank cell means the office has not recorded it, and an unrecorded family is "
        "still called, because the alternative is silently not calling people"
    )

    without = (tmp_path / "old.csv")
    without.write_text("id,phones,consent\nd,+9155500004,yes\n", encoding="utf-8")
    assert all(i.reachable_by_voice for i in CsvSource(without).items())


def test_a_voice_value_nobody_recognises_is_refused_rather_than_guessed(tmp_path):
    """This column decides whether a person is telephoned.

    `consent` is required to exist for the same reason. A typo here would either dial
    somebody who cannot answer or quietly stop dialling somebody who can, and both of
    those are silent.
    """
    path = write(tmp_path, "id,phones,consent,voice\na,+9155500001,yes,maybe\n")
    with pytest.raises(SourceError) as caught:
        list(CsvSource(path).items())
    assert "voice" in str(caught.value)
    assert "line 2" in str(caught.value)


def test_the_column_does_not_leak_into_the_task_text(tmp_path):
    """`context` is interpolated into what the agent says on the call.

    A disability record belongs in the office's system, not in a sentence read aloud to
    whoever picks up.
    """
    path = write(tmp_path, "id,phones,consent,voice,student_name\n"
                           "a,+9155500001,yes,no,Anitha R\n")
    item = next(iter(CsvSource(path).items()))
    assert "voice" not in item.context
    assert item.context == {"student_name": "Anitha R"}


# --------------------------------------------------------------------------
# The counting bug this uncovered
# --------------------------------------------------------------------------

def test_a_cancelled_row_is_not_reported_as_a_consent_refusal():
    """Every skip used to be counted as `skipped_no_consent`.

    So a run cancelled halfway reported its unstarted rows as families who had refused to
    be called, which is a sentence about consent that the data never said.
    """
    rows = [
        ItemResult(item=WorkItem(id="a", phones=("+9155500001",)),
                   resolution=Resolution.SKIPPED, reason=NO_CONSENT),
        ItemResult(item=WorkItem(id="b", phones=("+9155500002",)),
                   resolution=Resolution.SKIPPED, reason=CANCELLED),
        ItemResult(item=WorkItem(id="c", phones=("+9155500003",)),
                   resolution=Resolution.SKIPPED, reason=NO_VOICE_CHANNEL,
                   needs_another_channel=True),
    ]
    summary = summarise(rows)

    assert summary.skipped_no_consent == 1
    assert summary.skipped_not_dialled == 1
    assert summary.skipped_no_voice == 1
    printed = "\n".join(summary.lines())
    assert "skipped, no consent  1" in printed
    assert "no voice channel     1" in printed
    assert "skipped, not dialled 1" in printed


def test_the_summary_stays_quiet_about_a_run_that_had_neither(double):
    """Two lines that print zero on every ordinary run are two lines of noise.

    The consent line always prints because consent is always a question. These two are
    printed only when they happened.
    """
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    report = make(double).run([WorkItem(id="a", phones=("+9155500001",))])
    printed = "\n".join(summarise(report.results).lines())

    assert "skipped, no consent" in printed
    assert "no voice channel" not in printed
    assert "skipped, not dialled" not in printed
def test_a_shipped_export_exercises_the_channel_gate(capsys):
    """The rule above was correct, tested nine ways, and fired in no run anybody could run.

    Every test in this file writes its own CSV into a temporary directory, and none of the
    four shipped work files carried a `voice` column, so a district buyer who checked all
    four found a gate that would never fire in their district either. Their objection was not
    that the code was wrong. It was that "optional" was carrying the sentence in
    `docs/the-legal-surface.md`, and that a reviewer running everything here would never see
    the refusal happen.

    So it happens in the export a district already produces, and this holds it there. A row
    deleted from that file, or the column dropped out of it, fails here rather than quietly
    returning the rule to being demonstrated by nothing.
    """
    from firstbell.cli import main

    export = Path(__file__).resolve().parent.parent / "examples" / "absences-oneroster.csv"
    assert main(["--work-file", str(export)]) == 0
    printed = capsys.readouterr().out

    assert "not reachable by a voice call" in printed, (
        "no shipped work file reaches the channel gate, so the rule in "
        "docs/the-legal-surface.md is described and never demonstrated")
    assert "no voice channel" in printed, (
        "the run holds the row back and the summary does not count it, so a reader totting "
        "up the outcomes finds a row missing")

    # Four endings in one run is the argument this file carries for a buyer: the platform
    # declining a language and the software declining a channel, side by side.
    for ending in ("schema-valid answer received",
                   "Spanish is not available",
                   "nobody answered",
                   "not reachable by a voice call"):
        assert ending in printed, (
            f"this run no longer shows {ending!r}, so it no longer shows four different "
            f"endings from one command")
