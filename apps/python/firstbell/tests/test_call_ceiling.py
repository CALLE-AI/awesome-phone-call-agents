"""A live run stops and names the number before it phones more families than it was told to.

`--yes-i-mean-it` is granted before the work file has been counted, so on its own it
confirms an intention and not an amount. The idempotency key covers the second run of a day
and cannot cover the first, because every row is a different child and so every row gets a
different key.

The case this guards is not an attacker. It is a morning where the office exports the wrong
view from its student system and gets every enrolled pupil instead of the day's absentees.

Every test here runs through the real `--live` branch against the bundled double over real
HTTP, which is the pattern `test_a_live_run_against_a_double_says_so_in_the_receipt` already
uses. That matters more than it looks. An earlier version of this file pointed the base URL
at a closed port and treated any exception as evidence the ceiling had let the run past. A
run that failed for some entirely different reason would have passed those tests just as
well, so they could not have failed for the right reason. Here a run that clears the ceiling
has to finish and return 0.

The ceiling is moved rather than the work file resized. `DEFAULT_CALL_CEILING` is fifty and
`examples/absences.csv` is nowhere near it, so a test that built a file of the shipped size
would spend real seconds in the live branch, which polls every two seconds by design.
"""
from __future__ import annotations

import socket

import pytest

from firstbell import cli
from firstbell.cli import main

WORK = "examples/absences.csv"


@pytest.fixture()
def double_over_http(monkeypatch):
    """A live run wired to the bundled double, on a port nothing else holds.

    The base URL is pointed at the double for every test in this file, including the ones
    that expect a refusal. If the ceiling ever stopped stopping a run, the run would reach a
    local double rather than a production endpoint, and a test suite should not be one
    ordering mistake away from dialling anything real.
    """
    from calle_double.server import serve

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = serve(port=port)
    monkeypatch.setenv("CALLE_API_KEY", "iams_test_ceiling")
    monkeypatch.setenv("CALLE_BASE_URL", f"http://127.0.0.1:{port}")
    try:
        yield
    finally:
        server.shutdown()


def _live(*extra: str) -> list[str]:
    return ["--work-file", WORK, "--live", "--yes-i-mean-it", *extra]


def test_a_live_run_over_the_ceiling_places_no_calls(monkeypatch, double_over_http):
    """The refusal happens before the dispatcher exists, and it says how big the run was.

    `--limit 3` against a ceiling of two is a refusal, and the number in the message has to
    be three. If it said the file's whole length instead, the count would be happening
    before the truncation, and there would be no way to take a few rows out of a large file.
    """
    monkeypatch.setattr(cli, "DEFAULT_CALL_CEILING", 2)

    with pytest.raises(SystemExit) as caught:
        main(_live("--limit", "3"))

    message = caught.value.code
    assert isinstance(message, str), f"the run exited with {message!r}, not a refusal"
    assert "3 families" in message, (
        "the refusal does not name how many families the run had reached, which is the "
        f"only thing that tells the operator the size of what they nearly did: {message!r}"
    )
    assert "nothing has been dialled" in message.lower()
    assert "--max-calls 3" in message, (
        "the refusal does not tell the operator how to proceed on purpose, so the only "
        f"obvious way out is to remove the guard: {message!r}"
    )


def test_a_live_run_at_the_ceiling_is_not_refused(monkeypatch, double_over_http):
    """The boundary is `more than`, not `at`.

    An off-by-one here refuses the exact size the operator was told is allowed, and their
    fix for that is to raise the ceiling past what they actually meant.
    """
    monkeypatch.setattr(cli, "DEFAULT_CALL_CEILING", 2)

    assert main(_live("--limit", "2")) == 0, (
        "a run of exactly the ceiling did not complete"
    )


def test_raising_the_ceiling_on_purpose_lets_the_run_through(monkeypatch, double_over_http):
    """`--max-calls` is the deliberate act, and it has to be stated as a number."""
    monkeypatch.setattr(cli, "DEFAULT_CALL_CEILING", 2)

    assert main(_live("--limit", "3", "--max-calls", "3")) == 0, (
        "--max-calls 3 did not clear a run of three rows"
    )


def test_the_ceiling_counts_calls_not_rows(tmp_path, monkeypatch, double_over_http):
    """A row that will never be dialled must not count towards a ceiling on dialling.

    The dispatcher refuses two kinds of row before any call is placed: a family that never
    consented, and one the telephone cannot reach. Both come back SKIPPED and neither costs
    anything. A ceiling counted on rows would refuse a run that was going to spend nothing,
    and worse, the refusal would name a number of families nobody was going to phone.

    This is also the drift gate on that arithmetic, and it was not one. Its own docstring
    said that if the dispatcher grew a third reason to skip a row then this would fail, and
    the dispatcher had four reasons the whole time: a row held because another absence on
    the same telephone number is already being called, and a dated consent record that does
    not cover this call. Neither appears in the file below, so the gate passed over a
    refusal that named twice the families it was going to phone. A test whose fixture only
    contains the cases the code already handles cannot notice the ones it does not.

    The count now comes from `dial_refusal`, which is the dispatcher's own gate chain and
    not a copy of two of its four branches. `test_the_ceiling_and_the_dispatcher_cannot_
    disagree` below is the gate that this stays true.
    """
    work = tmp_path / "mixed.csv"
    work.write_text(
        # +91555 is the reserved prefix this repository uses for India, so none of these can
        # ring anybody. The trailing block is 9xxxxxx rather than 0xxxxxx so it cannot
        # collide with the twelve numbers the demo scenario binds outcomes to.
        "id,phones,locale,region,consent,voice,student_name\n"
        "S-8001,+915559000001,en-IN,IN,yes,yes,One\n"
        "S-8002,+915559000002,en-IN,IN,no,yes,Two\n"       # never consented
        "S-8003,+915559000003,en-IN,IN,yes,no,Three\n"     # not reachable by voice
        "S-8004,+915559000004,en-IN,IN,yes,yes,Four\n",
        encoding="utf-8", newline="\n",
    )
    monkeypatch.setattr(cli, "DEFAULT_CALL_CEILING", 1)

    with pytest.raises(SystemExit) as caught:
        main(["--work-file", str(work), "--live", "--yes-i-mean-it"])

    message = caught.value.code
    assert "2 families" in message, (
        "four rows, of which one has no consent and one cannot be reached by voice, so two "
        f"calls would be placed and the refusal has to say two: {message!r}"
    )


def test_the_offline_run_is_not_capped(monkeypatch):
    """A ceiling on the offline run would be a ceiling on a demonstration.

    Nothing is phoned and nothing is billed, so there is no spend to protect. This is also
    the run a reviewer executes, and a reviewer meeting a spend guard on a run that spends
    nothing would reasonably conclude the guard is decorative.
    """
    monkeypatch.setattr(cli, "DEFAULT_CALL_CEILING", 1)

    assert main(["--work-file", WORK]) == 0, (
        "the offline run was stopped by something, and it phones nobody"
    )


def test_the_ceiling_and_the_dispatcher_cannot_disagree(tmp_path, monkeypatch,
                                                        double_over_http):
    """The refusal's number, against the number of calls the same file really places.

    Measured rather than reasoned about: the file goes through a live run against the double
    with the ceiling raised, and the calls the transport saw are compared with the count the
    refusal printed when the ceiling was low. A shared predicate is what makes them agree;
    this is what proves they do.

    The four rows here are the four reasons the dispatcher skips one, plus two it dials. The
    siblings share a telephone number, so the second of them is held rather than dialled,
    and that is the case the old gate had no row for.
    """
    work = tmp_path / "every-reason.csv"
    work.write_text(
        "id,phones,locale,region,consent,voice,student_name\n"
        "S-9001,+915559100001,en-IN,IN,yes,yes,One\n"
        "S-9002,+915559100002,en-IN,IN,no,yes,Two\n"          # never consented
        "S-9003,+915559100003,en-IN,IN,yes,no,Three\n"        # no voice channel
        "S-9004,+915559100004,en-IN,IN,yes,yes,Four\n"
        "S-9005,+915559100004,en-IN,IN,yes,yes,Five\n",       # same number as S-9004
        encoding="utf-8", newline="\n",
    )

    monkeypatch.setattr(cli, "DEFAULT_CALL_CEILING", 1)
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", str(work), "--live", "--yes-i-mean-it"])
    refused = str(caught.value.code)

    assert "2 families" in refused, (
        "five rows: one without consent, one with no voice channel, and one held because a "
        "sibling on the same number is already being called. Two calls, so the refusal has "
        f"to say two: {refused!r}"
    )
    assert "--max-calls 2" in refused, (
        "the number the refusal tells an operator to pass has to be the number of calls, or "
        "following the instruction raises the ceiling to the wrong place"
    )
