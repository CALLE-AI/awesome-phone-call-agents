"""Tests for the judge-facing command.

The behaviours locked here are the ones that would embarrass us if they broke: the
default never dials, a money figure never appears without a source, live mode never
starts by accident, and no raw phone number ever reaches the receipt.
"""

from __future__ import annotations

import json
import re

import pytest

from firstbell.cli import main

WORK = "examples/absences.csv"


def test_the_default_run_needs_no_account_and_places_no_call(capsys):
    assert main(["--work-file", WORK]) == 0
    out = capsys.readouterr().out
    assert "OFFLINE" in out
    assert "no telephone call was placed" in out


def test_the_demo_run_shows_all_three_outcomes(capsys):
    """A run where everything succeeds hides the outcome the product exists for."""
    main(["--work-file", WORK])
    out = capsys.readouterr().out
    assert "resolved             4" in out
    assert "undetermined         1" in out
    assert "failed               1" in out
    assert "skipped, no consent  1" in out
    assert "3 case(s) need a person" in out


def test_the_demo_run_also_shows_an_answer_that_is_not_ours_to_close(capsys):
    """The fourth outcome the run has to be able to show, on the second axis.

    S-1047 comes back schema-valid, so every check the dispatcher makes passes and the
    old code printed `ok` beside it. What the answer says is that a parent has just
    learned a child who left for school is not there. The row has to read differently,
    it has to be in the human queue, and it has to be at the top of it.
    """
    main(["--work-file", WORK])
    out = capsys.readouterr().out

    assert "[SAFEG] S-1047" in out, "an escalated row must not print the closed marker"
    assert "of those, escalated  1" in out
    assert "1 of those cases is safeguarding" in out
    assert "within 30 minutes" in out

    # Top of the queue, above the two ordinary callbacks, and flagged.
    queue = out[out.index("case(s) need a person"):]
    assert queue.index("S-1047") < queue.index("S-1044") < queue.index("S-1046")
    assert "!! S-1047" in queue


def test_an_escalated_answer_is_not_counted_as_work_taken_off_the_desk(capsys):
    """The rate must fall when the app finds something, not rise.

    `resolution_rate` divided every schema-valid answer by every attempt, so escalating a
    case improved the headline. Four answers over six attempts is 67%; three of them are
    closed, and 50% is the number this run is entitled to print.
    """
    main(["--work-file", WORK])
    out = capsys.readouterr().out
    assert "resolution rate      50%" in out
    assert "closed, not merely answered" in out


def test_it_is_deterministic(capsys):
    main(["--work-file", WORK])
    first = capsys.readouterr().out
    main(["--work-file", WORK])
    assert capsys.readouterr().out == first


def test_a_money_figure_requires_a_source():
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", WORK, "--funding-rate", "12.5"])
    assert "without a citation" in str(caught.value)


def test_a_sourced_rate_is_computed_from_resolved_only(capsys):
    main(["--work-file", WORK, "--funding-rate", "10",
          "--funding-jurisdiction", "Example", "--funding-source", "Example Dept",
          "--funding-url", "https://example.org/x"])
    out = capsys.readouterr().out
    # 3 resolved x 10. The undetermined and failed rows recover nothing, because the
    # record is still open and a person still has to work it.
    assert "$30.00" in out
    assert "3 resolved x $10.00" in out
    assert "https://example.org/x" in out


def test_live_refuses_to_start_without_an_explicit_confirmation():
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", WORK, "--live"])
    assert "--yes-i-mean-it" in str(caught.value)


def test_live_refuses_without_an_api_key(monkeypatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", WORK, "--live", "--yes-i-mean-it"])
    assert "CALLE_API_KEY" in str(caught.value)


def test_the_receipt_records_the_mode_and_masks_every_number(tmp_path):
    receipt = tmp_path / "receipt.json"
    main(["--work-file", WORK, "--receipt", str(receipt)])
    data = json.loads(receipt.read_text(encoding="utf-8"))

    assert data["mode"] == "offline", "a receipt that hid the mode would be worthless"
    assert data["counts"]["resolved"] == 4
    unmasked = [m for m in re.findall(r"\+\d{8,15}", json.dumps(data)) if "*" not in m]
    assert unmasked == [], f"raw numbers reached the receipt: {unmasked}"


def test_a_number_inside_a_result_field_is_masked_in_the_receipt(tmp_path):
    """The flag governs the transcript. It has never governed the result.

    `--include-transcript` is off here, which is the default and the state the README
    describes as safe. `free_text_note` is part of `RESULT_SCHEMA`, so it is free text a
    parent supplied, and `_write_receipt` writes the whole `structured_result` with no
    flag in front of it. A parent who reads out another number puts one there.
    """
    from argparse import Namespace
    from types import SimpleNamespace

    from dispatch.models import DispatchReport, ItemResult, Resolution, WorkItem
    from firstbell.cli import RunMode, _write_receipt

    # Reserved, like every other number in this tree: a number written into a test to
    # prove it gets masked would otherwise be a number that could ring somebody.
    spoken = "+915550000099"
    item = WorkItem(id="S-9", phones=("+915550000001",), locale="ta-IN")
    report = DispatchReport(results=[ItemResult(
        item=item, resolution=Resolution.RESOLVED, call_id="call_1",
        structured_result={
            "reason_category": "illness",
            "free_text_note": f"Ring her father instead, his number is {spoken}.",
        },
        reason="schema-valid answer received", attempts_made=1,
        numbers_tried=("+915550000001",), placed_by_this_run=True,
    )])
    summary = SimpleNamespace(resolution_rate=1.0, calls_placed=1, calls_dialled=1, rate=None,
                              funding_recovered=None)
    receipt = tmp_path / "receipt.json"
    _write_receipt(receipt, report=report, mode=RunMode(live=False), summary=summary,
                   args=Namespace(work_file=WORK, concurrency=1, include_transcript=False))

    written = receipt.read_text(encoding="utf-8")
    assert spoken not in written, (
        "a number a parent said reached the receipt with --include-transcript off"
    )


def test_a_work_file_without_consent_is_refused(tmp_path, capsys):
    path = tmp_path / "bad.csv"
    path.write_text("id,phones\nS-1,+915550000001\n", encoding="utf-8")
    assert main(["--work-file", str(path)]) == 2
    assert "consent" in capsys.readouterr().err


def test_the_ai_disclosure_opens_every_task():
    from firstbell import AI_DISCLOSURE, build_task
    from dispatch import WorkItem

    task = build_task(WorkItem(id="S-1", phones=("+915550000001",),
                               context={"student_name": "Anitha"}))
    assert task.startswith(AI_DISCLOSURE)
    assert "AI assistant, not a person" in task
    # The remit is narrow on purpose.
    assert "Do not give advice" in task
    assert "member of staff will call back" in task


# -- what "live" is allowed to mean -----------------------------------------

def test_the_word_live_is_reserved_for_the_host_that_can_ring_a_phone():
    """--live is not evidence. The base URL is.

    The SDK takes a base_url, so the real client over real HTTP can still be talking to a
    double. If the receipt called that "live", the receipt would be manufacturing evidence
    of a phone call that never happened.
    """
    from firstbell.cli import PRODUCTION_HOST, RunMode

    offline = RunMode(live=False)
    double = RunMode(live=True, base_url="http://127.0.0.1:8787")
    real = RunMode(live=True, base_url=f"https://{PRODUCTION_HOST}")

    assert (offline.label, double.label, real.label) == (
        "offline", "live-nonproduction", "live")
    assert [m.reached_production for m in (offline, double, real)] == [False, False, True]
    assert "No phone will ring" in double.banner()
    assert "real credits" in real.banner()
    # A near miss must not pass for the real thing.
    assert not RunMode(True, "https://api.heycall-e.com.example.net").reached_production


def test_a_live_run_against_a_double_says_so_in_the_receipt(tmp_path, monkeypatch):
    """End to end through the --live branch, so that branch is not dead code."""
    import socket
    from calle_double.server import serve

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = serve(port=port)
    receipt = tmp_path / "live.json"
    try:
        monkeypatch.setenv("CALLE_API_KEY", "iams_test_anything")
        monkeypatch.setenv("CALLE_BASE_URL", f"http://127.0.0.1:{port}")
        assert main(["--work-file", WORK, "--live", "--yes-i-mean-it",
                     "--limit", "2", "--receipt", str(receipt)]) == 0
    finally:
        server.shutdown()

    data = json.loads(receipt.read_text(encoding="utf-8"))
    assert data["mode"] == "live-nonproduction"
    assert data["reached_production_api"] is False
    assert data["api_base_url"] == f"http://127.0.0.1:{port}"
    assert len(data["items"]) == 2, "the live branch really did run the pipeline"


def test_the_transcript_stays_out_of_the_receipt_unless_it_is_asked_for(tmp_path):
    """What a parent said is private by default.

    The repository's pull-request checklist forbids committing private transcripts, and a
    default that quietly wrote them would put every user one `--receipt` away from
    breaking it.
    """
    without = tmp_path / "a.json"
    main(["--work-file", WORK, "--receipt", str(without)])
    plain = json.loads(without.read_text(encoding="utf-8"))
    assert plain["transcript_included"] is False
    assert all("transcript" not in item for item in plain["items"])
    assert "kaaichal" not in json.dumps(plain).lower(), "spoken words leaked into a receipt"

    withit = tmp_path / "b.json"
    main(["--work-file", WORK, "--receipt", str(withit), "--include-transcript"])
    full = json.loads(withit.read_text(encoding="utf-8"))
    assert full["transcript_included"] is True
    spoken = [t for item in full["items"] for t in item.get("transcript", ())]
    assert any(turn["speaker"] == "user" for turn in spoken)
    assert "kaaichal" in json.dumps(full).lower(), "asked for the transcript and got none"
    # Consent is not retroactive: a number is still masked either way.
    unmasked = [m for m in re.findall(r"\+\d{8,15}", json.dumps(full)) if "*" not in m]
    assert unmasked == []


def test_the_receipt_records_whether_this_run_actually_placed_the_call(tmp_path):
    """Evidence has to carry the thing the summary is computed from.

    The field existed on the result and was left out of the receipt, so a reader auditing
    a run could see "calls placed 2" and had nothing to check it against.
    """
    receipt = tmp_path / "r.json"
    main(["--work-file", WORK, "--receipt", str(receipt)])
    data = json.loads(receipt.read_text(encoding="utf-8"))
    dialled = [i for i in data["items"] if i["resolution"] != "skipped"]
    assert all("placed_by_this_run" in i for i in dialled)
    assert all(i["placed_by_this_run"] is True for i in dialled), (
        "a fresh offline run placed every call it made"
    )


def test_the_receipt_separates_targeting_the_api_from_reaching_it(tmp_path):
    """Mutation 18 found this hole: the dispatcher property was tested, the receipt was not.

    A receipt is the artefact a reader keeps. Testing the value inside the process while
    leaving the written field unprotected means the rule can be correct everywhere except
    the one place anybody looks.
    """
    from types import SimpleNamespace

    from firstbell.cli import RunMode, _write_receipt
    from firstbell.domain import summarise
    from dispatch.models import DispatchReport

    production = RunMode(live=True, base_url="https://api.heycall-e.com")
    out = tmp_path / "r.json"

    args = SimpleNamespace(include_transcript=False, work_file=tmp_path / "w.csv",
                           concurrency=1)

    def payload(api_responded):
        _write_receipt(out, report=DispatchReport(), mode=production,
                       summary=summarise([]), args=args, api_responded=api_responded)
        return json.loads(out.read_text(encoding="utf-8"))

    # Targeting is knowable from configuration in every case.
    for answered in (True, False, None):
        assert payload(answered)["production_api_targeted"] is True

    # Reaching is not. Nothing answered means nothing was reached, however it was configured.
    assert payload(True)["reached_production_api"] is True
    assert payload(False)["reached_production_api"] is False
    assert payload(None)["reached_production_api"] is None


def test_the_safeguarding_window_says_whose_it_is(capsys):
    """Thirty minutes is one district's mandate, and the report has to say so.

    Somebody reading the code asked for the window to be configurable, which is
    right: districts sit under different obligations. The risk in granting it is the
    opposite of the one it fixes. A report that prints a number with no provenance lets a
    reader take this project's default for their own policy, so the sentence names which
    it is and the JSON carries the same answer as a boolean.
    """
    assert main(["--work-file", WORK]) == 0
    default = capsys.readouterr().out
    assert "within 30 minutes (this project's default, which no district has agreed to)" \
        in default

    assert main(["--work-file", WORK, "--safeguarding-minutes", "15"]) == 0
    chosen = capsys.readouterr().out
    assert "within 15 minutes (the window you passed on the command line)" in chosen

    # `--json` still prints the offline banner first, on purpose: a reader piping this
    # somewhere is entitled to see that no telephone rang. The document starts at the
    # first brace.
    def body(text):
        return json.loads(text[text.index("{"):])

    assert main(["--work-file", WORK, "--json"]) == 0
    payload = body(capsys.readouterr().out)
    assert payload["safeguarding_minutes"] == 30
    assert payload["safeguarding_minutes_is_default"] is True

    assert main(["--work-file", WORK, "--safeguarding-minutes", "45", "--json"]) == 0
    payload = body(capsys.readouterr().out)
    assert payload["safeguarding_minutes"] == 45
    assert payload["safeguarding_minutes_is_default"] is False


def _report_with_an_unaccountable_call():
    """One call CALL-E accepted, whose every poll came back 503.

    This is the path that fills `not_recallable` without setting `cancelled`, which is
    the combination that used to print the id nowhere.
    """
    from calle import CalleAPIError

    from dispatch import RetryPolicy, WaveDispatcher, WorkItem

    class calls:
        @staticmethod
        def create(**kwargs):
            return {"id": "call_BILLED_7788", "status": "queued"}

        @staticmethod
        def get(call_id):
            raise CalleAPIError(code="service_unavailable",
                                message="upstream is unavailable", status_code=503)

    class Client:
        pass

    Client.calls = calls
    dispatcher = WaveDispatcher(
        Client(), task_builder=lambda i: "x",
        result_schema={"type": "object", "required": ["reason"],
                       "properties": {"reason": {"type": "string"}}},
        poll_interval_seconds=0, sleep=lambda _s: None,
        retry=RetryPolicy(max_attempts=2),
    )
    return dispatcher.run([WorkItem(id="S-1", phones=("+915550000001",))])


def test_a_call_the_run_cannot_account_for_has_its_id_printed(capsys):
    """The id of a placed, billable, unreadable call has to reach a reader.

    `scheduler._handle` keeps such a call in `_in_flight` and says in a comment that the
    report's `not_recallable` list "is already printed, so a reader sees the id rather
    than a wrong verdict". It was printed only when the run was cancelled, and a poll
    failure cancels nothing, so on the path that happens by itself the id appeared in no
    line of output: not the row, not the summary, not `--json`. `--receipt` had it, and
    `--receipt` is off by default.
    """
    from firstbell import cli
    from firstbell.domain import summarise

    report = _report_with_an_unaccountable_call()
    assert report.not_recallable == ["call_BILLED_7788"], "the path did not reproduce"
    assert report.cancelled is False, "the path did not reproduce: a cancel would mask it"

    cli._print_human(report, summarise(report.results, live=True, rate=None, staff=None), 30)
    out = capsys.readouterr().out
    assert "call_BILLED_7788" in out, (
        "a call this run placed and cannot account for has its id printed nowhere, so "
        "nobody can chase it with the vendor")
    # On the same line, not merely somewhere in the output. `S-1` also appears in the row
    # list and in the queue at the bottom, so an `in out` assertion passed while the
    # block named a call id with no row beside it.
    named = [line for line in out.splitlines() if "call_BILLED_7788" in line and "S-1" in line]
    assert named, (
        "the block names the call id without saying which family it was for. "
        "Output was: " + out)

    # And the totals it does not appear in have to say so, because CALL-E may bill it
    # while the attempt list it would be counted from was never read back.
    assert "count as 0 in every number below" in out
    assert "attempts placed      0" in out, (
        "the run prints zero calls placed for a call the vendor accepted; the caveat "
        "above is the only thing that makes that honest")


def test_the_summary_line_names_an_unaccountable_call_without_a_cancel():
    report = _report_with_an_unaccountable_call()
    assert "call_BILLED_7788" in report.summary()


def test_the_json_output_carries_what_the_run_left_behind(capsys):
    """`--json` carried counts and money and nothing about how the run ended."""
    assert main(["--work-file", WORK, "--json"]) == 0
    text = capsys.readouterr().out
    payload = json.loads(text[text.index("{"):])
    assert payload["cancelled"] is False
    assert payload["not_recallable"] == []
    assert payload["fatal_error"] is None


def test_calling_families_again_needs_a_reason_on_the_record(capsys):
    """A second call to the same family in one morning is not a silent operation."""
    for label in ["", "   "]:
        assert main(["--work-file", WORK, "--again", label]) == 2
        assert "--again needs a label" in capsys.readouterr().err


def test_the_correction_label_is_normalised_and_recorded(tmp_path):
    """`Locale Fix` and `locale-fix` are one correction, so they cannot be two keys.

    Case and spacing would otherwise let the same fix run twice, and the second run of it
    would dial every family a third time.
    """
    receipt = tmp_path / "run.json"
    assert main(["--work-file", WORK, "--again", "  Locale Fix ",
                 "--receipt", str(receipt)]) == 0
    assert json.loads(receipt.read_text(encoding="utf-8"))["called_again_as"] == "locale-fix"

    plain = tmp_path / "plain.json"
    assert main(["--work-file", WORK, "--receipt", str(plain)]) == 0
    assert json.loads(plain.read_text(encoding="utf-8"))["called_again_as"] is None, (
        "an ordinary run must not look like a correction")


def test_a_row_refused_for_a_reused_key_is_told_how_to_be_called_again(capsys):
    """CALL-E's own sentence is accurate and tells an operator nothing to do.

    `idempotency_conflict` is permanent, so the row is FAILED with no retry and no call.
    In practice it has one cause: the file was corrected and re-run the same day. The
    refusal is right; printing it without the way out left a family unreachable until
    tomorrow in a language they do not speak.
    """
    from dispatch import DispatchReport, ItemResult, Resolution, WorkItem
    from firstbell import cli
    from firstbell.domain import summarise

    report = DispatchReport(results=[
        ItemResult(item=WorkItem(id="S-1", phones=("+915550000001",)),
                   resolution=Resolution.FAILED, failure_code="idempotency_conflict",
                   reason="This Idempotency-Key was already used with a different "
                          "request body."),
    ])
    cli._print_human(report, summarise(report.results, live=True, rate=None, staff=None), 30)
    out = capsys.readouterr().out
    assert "already called today with different details" in out
    assert "--again locale-fix" in out, "the refusal has to carry the way out of it"
    assert "S-1" in out


def test_the_correction_label_reaches_the_idempotency_key(monkeypatch):
    """The label has to change the key, which is the only thing that makes it work.

    Every other test here proves the mechanism or the message. This one proves the wire
    between them: without it, `--again` could be accepted, normalised, printed and written
    to the receipt while the run still sent the key that CALL-E refuses.
    """
    from firstbell import cli

    seen = []
    real = cli.default_idempotency_key

    def spy(prefix, day):
        seen.append(prefix)
        return real(prefix, day)

    monkeypatch.setattr(cli, "default_idempotency_key", spy)

    assert main(["--work-file", WORK]) == 0
    assert seen == ["attendance"], "an ordinary run must not carry a correction"

    seen.clear()
    assert main(["--work-file", WORK, "--again", "Locale Fix"]) == 0
    assert seen == ["attendance-locale-fix"], (
        "the label was accepted and did not reach the key, so the corrected run would be "
        "refused exactly as the uncorrected one was")
