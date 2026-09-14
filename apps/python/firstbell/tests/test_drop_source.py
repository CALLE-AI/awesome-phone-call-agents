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
    # Said explicitly, because reading is no longer what records. The rule this
    # test is about is unchanged: once calls have gone out, that content is
    # refused.
    source.placed_calls_from()

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
    first = DropSource(tmp_path, now=time.time())
    assert len(list(first.items())) == 2
    first.placed_calls_from()

    drop(tmp_path, "tuesday.csv")          # same bytes, new name
    with pytest.raises(SourceError):
        DropSource(tmp_path, now=time.time()).items()


def test_a_genuinely_new_export_is_read_after_an_old_one(tmp_path):
    """The ledger must not become a wall. Different rows are different work."""
    drop(tmp_path, "monday.csv")
    monday = DropSource(tmp_path, now=time.time())
    assert len(list(monday.items())) == 2
    monday.placed_calls_from()

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
    read = DropSource(tmp_path, now=time.time())
    list(read.items())
    read.placed_calls_from()
    ledger = tmp_path / DropSource.LEDGER
    assert ledger.exists()

    source = DropSource(tmp_path, pattern="*", now=time.time())
    assert source.newest().name != DropSource.LEDGER


def test_the_ledger_says_what_deleting_a_line_does(tmp_path):
    """It is a file a person will edit under pressure, so it explains itself."""
    drop(tmp_path)
    read = DropSource(tmp_path, now=time.time())
    list(read.items())
    read.placed_calls_from()
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


def test_reading_an_export_is_not_placing_calls_from_it(tmp_path):
    """The ledger says calls were placed. Reading a file places none.

    `items()` recorded the digest, and `items()` runs long before anything is dialled: ahead
    of the `--yes-i-mean-it` confirmation, ahead of the missing-key refusal, ahead of the
    credential-origin refusal, ahead of the call ceiling, and on every offline run. So a
    district that typed `--live` without the confirmation, or that ran the file once to look
    at it, was told on the next attempt that every family in it had already been telephoned.

    The sibling test above fixed half of this and its own docstring names the other half:
    the ledger is written "only once there is something to place calls from", which is not
    the same as once calls have been placed. Recording is now something the caller does
    after the run, and the caller only does it when the account was billed for a call.
    """
    drop(tmp_path, "nightly.csv")
    source = DropSource(tmp_path, now=time.time())
    assert len(list(source.items())) == 2
    assert not (tmp_path / DropSource.LEDGER).exists(), (
        "reading the export wrote the ledger, so any refusal after this point strands the "
        "day's work under a message asserting the families were called")

    # And a second read of the same file still works, because nothing has been dialled.
    assert len(list(DropSource(tmp_path, now=time.time()).items())) == 2


def test_the_ledger_is_written_when_the_caller_says_calls_were_placed(tmp_path):
    """The other half of the rule. Recording has to still happen, or the guard is gone."""
    drop(tmp_path, "nightly.csv")
    source = DropSource(tmp_path, now=time.time())
    items = list(source.items())
    assert items
    source.placed_calls_from()

    ledger = tmp_path / DropSource.LEDGER
    assert ledger.is_file(), "nothing recorded the export a run has just telephoned"
    assert "nightly.csv" in ledger.read_text(encoding="utf-8")
    with pytest.raises(SourceError) as refused:
        DropSource(tmp_path, now=time.time()).items()
    assert "already been called from" in str(refused.value)


def test_recording_without_reading_first_is_refused(tmp_path):
    """A guard against the fix going wrong in the other direction.

    `placed_calls_from()` writes the digest of the file this source chose. If it is called
    before `items()` there is no chosen file, and the honest answer is to say so rather than
    to pick the newest export again and record whatever is there now, which on a drop
    directory that has received the next export in the meantime is the wrong file.
    """
    drop(tmp_path, "nightly.csv")
    source = DropSource(tmp_path, now=time.time())
    with pytest.raises(SourceError) as refused:
        source.placed_calls_from()
    assert "has not read an export" in str(refused.value)
    assert not (tmp_path / DropSource.LEDGER).exists()


# ---- the caller's half of the rule --------------------------------------------------------


def test_only_a_run_that_reached_the_network_and_placed_a_call_records_the_export():
    """The table, because the branch it guards cannot be reached without a real telephone.

    Recording used to happen inside `items()`, so this decision did not exist. Now that it
    does, it is the whole of the fix and it lives where it can be checked rather than in a
    condition that only a production run walks through.
    """
    from firstbell.cli import records_as_called_from as rule

    assert rule(reached_production=True, calls_placed=1) is True
    assert rule(reached_production=True, calls_placed=0) is False, (
        "a wave that held every row for a person telephoned nobody, and its export is the "
        "work those held rows still need")
    assert rule(reached_production=False, calls_placed=8) is False, (
        "a run against the bundled double answers on 127.0.0.1 and rings no house, so a "
        "district rehearsing on it would burn the export it is about to work from")
    assert rule(reached_production=False, calls_placed=0) is False


def test_a_live_run_against_the_double_does_not_burn_the_export(tmp_path, monkeypatch):
    """The rehearsal case, end to end through the CLI.

    `--live --yes-i-mean-it` against the bundled double is the run the README tells a
    district to do before the real one. It places calls, it writes a receipt, and it must
    leave the drop directory ready for the morning.
    """
    import socket

    from calle_double.server import serve
    from firstbell.cli import main

    drop(tmp_path, "nightly.csv")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = serve(port=port)
    try:
        monkeypatch.setenv("CALLE_API_KEY", "iams_test_anything")
        monkeypatch.setenv("CALLE_BASE_URL", f"http://127.0.0.1:{port}")
        assert main(["--work-drop", str(tmp_path), "--live", "--yes-i-mean-it"]) == 0
    finally:
        server.shutdown()

    assert not (tmp_path / DropSource.LEDGER).exists(), (
        "a rehearsal against the double recorded the export as telephoned, so the real run "
        "in the morning would be refused")
