"""Reading whatever the overnight job left, and refusing the two ways that goes wrong.

An operations reviewer said the CSV requirement was the thing that would end a pilot: "nobody
hand-uploads a CSV every morning at scale". They were right, and the fix is not an adapter
against one vendor's private API, because that would ship as a code path nobody in this tree
can run. Every system of record in this market can be scheduled to write a nightly export to
a share. So the source reads the drop.

Taking the person out of the morning takes out the person who would have noticed. Both of the
remaining failures end with a family telephoned about something untrue, so the tests here are
mostly about refusals. `now` is injected so a stale file is placed at a known age rather than
waited for.
"""
from __future__ import annotations

import time

import pytest

from dispatch.sources import DropSource, SourceError

HEAD = "id,phones,locale,consent,pupil\n"
ROWS = "A-1,+15551230001,en-US,yes,Ada\nA-2,+15551230002,ta-IN,yes,Ravi\n"


def drop(tmp_path, name="absences-2026-09-07.csv", body=HEAD + ROWS, age_hours=0.5):
    f = tmp_path / name
    f.write_text(body, encoding="utf-8", newline="")
    when = time.time() - age_hours * 3600
    import os
    os.utime(f, (when, when))
    return f


def test_the_newest_export_in_the_drop_is_the_one_read(tmp_path):
    """Newest by modification time, not by filename.

    A district's export names are its own. Sorting them is guessing at somebody else's
    convention, and the one convention every filesystem agrees on is when the file was
    written.
    """
    drop(tmp_path, "absences-2026-09-05.csv", HEAD + "A-9,+15559990009,en-US,yes,Old\n",
         age_hours=48)
    newest = drop(tmp_path, "aaa-earlier-in-the-alphabet.csv", age_hours=0.5)

    source = DropSource(tmp_path, now=time.time())
    assert source.newest() == newest
    assert [i.id for i in source.items()] == ["A-1", "A-2"]


def test_a_stale_export_is_refused_and_the_refusal_says_how_stale(tmp_path):
    """The failure that calls the families of children who are in school.

    The overnight job did not run. Yesterday's file is still there. Reading it telephones
    every family in it to ask why their child is absent today, and their child is at a desk.
    That is worse than placing no calls at all, so it is a refusal rather than a warning.
    """
    drop(tmp_path, age_hours=30)
    with pytest.raises(SourceError) as refused:
        DropSource(tmp_path, now=time.time()).items()
    message = str(refused.value)
    assert "30.0 hours" in message, "the refusal has to say how old, or nobody can judge it"
    assert "18.0" in message, "and what the limit was"
    assert "in school today" in message, (
        "the refusal has to say what would have happened, because an operator under time "
        "pressure will otherwise raise the window to make the error go away"
    )


def test_the_stale_line_moves_because_a_districts_schedule_is_not_ours(tmp_path):
    """An overnight job at 02:00 and one at 06:00 are different agreements."""
    drop(tmp_path, age_hours=30)
    items = list(DropSource(tmp_path, max_age_hours=36, now=time.time()).items())
    assert len(items) == 2


def test_the_stale_line_cannot_be_removed(tmp_path):
    """Moving the window is a decision. Removing it is not on offer.

    A window of zero refuses everything, which is the safe direction, and a window large
    enough to be no window is a number an operator has to type and can be asked about.
    There is no flag that turns the check off.
    """
    drop(tmp_path, age_hours=0.01)
    with pytest.raises(SourceError):
        DropSource(tmp_path, max_age_hours=0, now=time.time()).items()


def test_an_export_already_called_from_is_refused(tmp_path):
    """The failure that telephones every family twice.

    The dispatcher derives idempotency keys from the work item, so CALL-E would collapse a
    genuine re-read. That is a backstop for a mistake rather than a licence to make it: a
    district watching the same call attempted twice does not care which layer stopped it.
    """
    drop(tmp_path)
    source = DropSource(tmp_path, now=time.time())
    assert len(list(source.items())) == 2

    again = DropSource(tmp_path, now=time.time())
    with pytest.raises(SourceError) as refused:
        again.items()
    assert "already been called from" in str(refused.value)


def test_it_is_the_content_that_was_called_from_and_not_the_name(tmp_path):
    """The safe question is "have I called these people", not "have I read this name".

    An export job that writes the same rows under a new date stamp every run is a normal
    thing for a job to do wrong, and the filename would let it through.
    """
    drop(tmp_path, "monday.csv")
    assert len(list(DropSource(tmp_path, now=time.time()).items())) == 2

    drop(tmp_path, "tuesday.csv")          # same bytes, new name
    with pytest.raises(SourceError):
        DropSource(tmp_path, now=time.time()).items()


def test_a_genuinely_new_export_is_read_after_an_old_one(tmp_path):
    """The ledger must not become a wall. Different rows are different work."""
    drop(tmp_path, "monday.csv")
    assert len(list(DropSource(tmp_path, now=time.time()).items())) == 2

    drop(tmp_path, "tuesday.csv", HEAD + "B-1,+15551230003,en-US,yes,Sam\n")
    assert [i.id for i in DropSource(tmp_path, now=time.time()).items()] == ["B-1"]


def test_a_file_that_fails_validation_is_not_recorded_as_called_from(tmp_path):
    """Otherwise a broken export strands the operator.

    They fix the file, put it back, and this refuses the corrected copy for having been
    seen. So the rows are read to a list first, and the ledger is written only once there is
    something to place calls from.
    """
    drop(tmp_path, "broken.csv", HEAD + "A-1,+15551230001\n")
    with pytest.raises(SourceError):
        DropSource(tmp_path, now=time.time()).items()
    assert not (tmp_path / DropSource.LEDGER).exists(), (
        "a file that placed no calls was recorded as having placed them"
    )

    drop(tmp_path, "broken.csv", HEAD + ROWS)
    assert len(list(DropSource(tmp_path, now=time.time()).items())) == 2


def test_an_empty_drop_is_reported_rather_than_read_as_a_quiet_day(tmp_path):
    """A day with no absences and a job that did not run look identical from here."""
    with pytest.raises(SourceError) as refused:
        DropSource(tmp_path, now=time.time()).items()
    assert "no file matching" in str(refused.value)


def test_the_ledger_is_not_mistaken_for_an_export(tmp_path):
    """It lives in the directory it guards, so the glob has to skip it."""
    drop(tmp_path)
    list(DropSource(tmp_path, now=time.time()).items())
    ledger = tmp_path / DropSource.LEDGER
    assert ledger.exists()

    source = DropSource(tmp_path, pattern="*", now=time.time())
    assert source.newest().name != DropSource.LEDGER


def test_the_ledger_says_what_deleting_a_line_does(tmp_path):
    """It is a file a person will edit under pressure, so it explains itself."""
    drop(tmp_path)
    list(DropSource(tmp_path, now=time.time()).items())
    text = (tmp_path / DropSource.LEDGER).read_text(encoding="utf-8")
    assert text.startswith("#")
    assert "telephoned again" in text, (
        "the header has to say what removing a line permits, because that is the whole "
        "consequence and the person editing it is in a hurry"
    )
    assert "absences-2026-09-07.csv" in text, "and which file each line was"


def test_pointing_it_at_a_file_rather_than_a_drop_says_so(tmp_path):
    """The likeliest first mistake, so the refusal is about that mistake."""
    f = drop(tmp_path)
    with pytest.raises(SourceError) as refused:
        DropSource(f, now=time.time()).items()
    assert "not a directory" in str(refused.value)
