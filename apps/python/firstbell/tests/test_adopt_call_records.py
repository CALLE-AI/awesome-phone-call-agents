"""The decision layer runs over another dialler's records, and never reads a transcript.

`tools/adopt_call_records.py` is the answer to the one recommendation this entry received and
declined. A reader in the buyer's seat wanted the first screen to lead with the three
outcomes, the consent gate and the structured reason, over whichever dialler a district
already owns. That was declined at the time for a good reason: the sentence existed in act 07
as a scoping statement, no integration was built, and promoting an unbuilt capability to the
first screen would have been a claim this entry could not survive being asked about.

So it was built instead. These gates hold the two things that make it worth having.

**It cannot be a second implementation of the rule.** The value of the tool is that a district
gets the same decision the live path makes, and the way that goes wrong is a copy of the rule
drifting from the original. `decide` is checked against `file_today` and
`safeguarding_escalation` directly, over every combination the schema allows, rather than
against a table of expected answers written here. A table would be a third copy.

**A transcript is not a decision.** This is the product, not a limitation, and it is the gate
that would be easiest to lose to a well-meaning improvement. The defect this whole entry is
built around is a schema-valid answer closing a record while saying nothing, and reading a
guardian's confirmation out of free text is that defect with a better vocabulary. The test
below hands the tool a transcript in which a parent says plainly that the child is at home
with them, which is exactly the case a keyword reader would close, and requires the record to
come back undetermined and land on a person's desk.
"""
from __future__ import annotations

import itertools
import json
import re
import subprocess
import sys

import pytest
from datetime import date
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

RECORDS = APP / "examples" / "other-dialler-records.jsonl"
CSV_RECORDS = APP / "examples" / "other-dialler-records.csv"
REGISTER = APP / "examples" / "other-dialler-consent.json"
TOOL = APP / "tools" / "adopt_call_records.py"

# A transcript a keyword reader would close. Every reassuring phrase is in it.
PLAIN_TRANSCRIPT = (
    "Agent: Good morning, I am calling from the attendance office about Ravi. "
    "Parent: Oh yes, he is at home with me today, I am his mother, he had a temperature "
    "overnight so I kept him back. I am aware he is not in school. He should be in tomorrow."
)


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", cwd=str(APP))


def test_the_example_pair_exists_and_the_tool_runs_on_it():
    """A documented input path whose example does not run is documentation."""
    assert RECORDS.is_file(), f"{RECORDS.name} is gone, and the README tells a reader to run it"
    assert REGISTER.is_file(), f"{REGISTER.name} is gone, so the consent audit has nothing"
    done = _run("--records", str(RECORDS), "--consent-register", str(REGISTER),
                "--today", "2026-09-08")
    assert done.returncode == 0, f"the documented command exited {done.returncode}: {done.stdout}"
    assert "This dialled nothing." in done.stdout, (
        "the tool no longer says it dialled nothing, which is the first thing a reviewer "
        "running an unfamiliar telephony tool needs to know")


def test_the_decision_is_the_live_rule_and_not_a_copy_of_it():
    """Every result the schema allows, checked against the functions the live path calls.

    Written this way on purpose. A table of expected outcomes here would be a third copy of
    the rule, and the third copy is the one that goes stale. If `safeguarding_escalation`
    changes, this test changes with it and the tool has to follow.
    """
    from adopt_call_records import decide
    from dispatch.models import Escalation
    from firstbell.domain import RESULT_SCHEMA, safeguarding_escalation
    from replay_escalation import file_today

    properties = RESULT_SCHEMA["properties"]
    reasons = properties["reason_category"]["enum"]
    returns = properties["expected_return"]["enum"]
    confirmations = properties["parent_confirmed_aware"]["enum"]
    spoke = properties["spoke_with"]["enum"]

    checked = 0
    for reason, back, confirmed, who in itertools.product(reasons, returns, confirmations,
                                                          spoke):
        result = {"reason_category": reason, "expected_return": back,
                  "parent_confirmed_aware": confirmed, "spoke_with": who}
        got = decide({"id": "S-1", "answered": True, "result": result, "_line": 1})
        assert got["outcome"] == file_today(result, with_escalation=True), (
            f"the tool files {result} as {got['outcome']} and the live rule files it as "
            f"{file_today(result, with_escalation=True)}. A district adopting this over its "
            "own dialler would get a different answer from the one this entry documents")
        assert got["escalated"] == (
            safeguarding_escalation(result) is not Escalation.NONE), (
            f"the tool disagrees with safeguarding_escalation about {result}")
        checked += 1
    assert checked == len(reasons) * len(returns) * len(confirmations) * len(spoke)
    assert checked > 100, f"only {checked} combinations checked, so the schema has shrunk"

    # And the README has to say the same number. It said 315 for as long as the schema had
    # three values for `spoke_with`, and kept saying it after a fourth and a fifth were
    # added, because the only gate on the figure was the `> 100` above. A count in prose
    # that nothing compares against is a count that describes an older repository.
    readme = (APP / "README.md").read_text(encoding="utf-8")
    stated = re.search(r"agree across every one of the ([\d,]+) results", readme)
    assert stated, "the README no longer states the size of this sweep where this looks"
    assert int(stated.group(1).replace(",", "")) == checked, (
        f"the README says this checks {stated.group(1)} results and it checks {checked}. "
        "The schema grew and the sentence did not")


def test_a_transcript_is_never_read_to_close_a_record():
    """The product claim, and the gate easiest to lose to a helpful improvement.

    The transcript handed over here says the parent is the mother, that the child is at home
    with her, and that she is aware. A keyword reader closes it. This has to not.
    """
    from adopt_call_records import decide

    got = decide({"id": "S-9", "answered": True, "transcript": PLAIN_TRANSCRIPT, "_line": 1})
    assert got["outcome"] == "undetermined", (
        "a record carrying only a transcript was filed "
        f"{got['outcome']!r}. Reading a guardian's confirmation out of prose is the defect "
        "this software exists to catch, and a transcript is not a decision")
    assert not got["escalated"], (
        "a transcript-only record was marked as a safeguarding escalation, which claims the "
        "tool read something in it")
    assert "transcript is not a decision" in got["why"], (
        "the row goes to a person without saying why, so the person cannot tell it from a "
        "call that failed")

    # And through the command line, because the assertion above is about a function and the
    # thing a district runs is a process.
    scratch = APP / "out" / "one-transcript.jsonl"
    scratch.parent.mkdir(parents=True, exist_ok=True)
    scratch.write_text(json.dumps({"id": "S-9", "answered": True,
                                   "transcript": PLAIN_TRANSCRIPT}) + "\n",
                       encoding="utf-8", newline="\n")
    try:
        done = _run("--records", str(scratch), "--json")
        assert done.returncode == 0, done.stdout
        filed = json.loads(done.stdout)["filed"]
        assert [one["outcome"] for one in filed] == ["undetermined"], done.stdout
        assert json.loads(done.stdout)["dialled"] == 0
    finally:
        scratch.unlink(missing_ok=True)


def test_answered_has_three_states_and_absent_is_not_no():
    """Added because a mutation survived, which is the only reason worth adding a test.

    Changing `answered is False` to `answered is None` in the tool was noticed by nothing.
    The example file has a row for every outcome and no row where `answered` is simply
    absent, so the case that distinguishes the two spellings was never exercised.

    It matters twice. A record whose export omits the field but carries a full answer would
    be filed undetermined and told a person nobody picked up, which is a sentence about a
    call that did not happen. And a record that really was not answered would be judged on
    whatever result is attached to it, which is how a voicemail becomes a decision.

    Three states, the same three `answered_by_the_guardian` has, and for the same reason:
    absent is not no.
    """
    from adopt_call_records import decide

    complete = {"reason_category": "illness", "expected_return": "tomorrow",
                "parent_confirmed_aware": "yes", "spoke_with": "guardian"}

    silent = decide({"id": "S-7", "result": dict(complete), "_line": 1})
    assert silent["outcome"] == "closed", (
        f"a record with no `answered` field and a complete answer was filed "
        f"{silent['outcome']!r}. The field being absent is not the record saying nobody "
        "picked up, and the answer attached to it is the evidence")
    assert "nobody answered" not in silent["why"], (
        "a record that does not say whether it was answered is being told it was not: "
        f"{silent['why']!r}")

    refused = decide({"id": "S-7", "answered": False, "result": dict(complete), "_line": 1})
    assert refused["outcome"] == "undetermined", (
        "a call the record says nobody answered was closed on the result attached to it, "
        "which is how a voicemail becomes a guardian's confirmation")
    assert "nobody answered" in refused["why"], (
        f"the row goes to a person for the wrong stated reason: {refused['why']!r}")
    assert not refused["escalated"], (
        "a call nobody answered was marked as a safeguarding escalation")

    reached = decide({"id": "S-7", "answered": True, "result": dict(complete), "_line": 1})
    assert reached["outcome"] == "closed", (
        "an answered call with a guardian's confirmation is no longer closed, so the three "
        "states have collapsed into something else")


def test_a_field_the_schema_does_not_define_is_refused_and_not_dropped():
    """A district mapping its own export will get a field name wrong.

    Dropping it silently would file the record undetermined for a reason the reader cannot
    see, which reads exactly like a call that learned nothing. Naming the field is the
    difference between a bug in their mapping and a bug in their families' records.
    """
    from adopt_call_records import RecordError, decide

    try:
        decide({"id": "S-8", "answered": True, "_line": 4,
                "result": {"reason_category": "illness", "expected_return": "today",
                           "parent_aware": "yes"}})
    except RecordError as bad:
        assert "parent_aware" in str(bad), (
            f"the complaint does not name the field that caused it: {bad}")
        assert "parent_confirmed_aware" in str(bad), (
            "the complaint names the wrong field and not the right ones, so a reader cannot "
            f"fix their mapping from it: {bad}")
    else:
        raise AssertionError(
            "a result carrying `parent_aware` was accepted. A field this tool does not "
            "understand is not a field it may quietly ignore, because the row would be "
            "filed undetermined and read as a call that learned nothing")


def test_the_tool_says_could_not_measure_rather_than_failing():
    """The third outcome, the same one every other tool in this repository prints.

    Exit 3 and a first line a reader can act on, distinct from exit 1, which is a finding,
    and exit 2, which is argparse telling somebody who followed the documentation that they
    used it wrong.
    """
    done = _run()
    assert done.returncode == 3, (
        f"with no --records the tool exited {done.returncode} rather than 3: {done.stdout}")
    assert done.stdout.startswith("COULD-NOT-MEASURE"), done.stdout
    assert "--records" in done.stdout and "examples/" in done.stdout, (
        "the message does not name the flag or the example file, so it tells a reader that "
        f"something is missing without telling them what to do: {done.stdout}")

    missing = _run("--records", str(APP / "out" / "no-such-records.jsonl"))
    assert missing.returncode == 3, missing.stdout
    assert missing.stdout.startswith("COULD-NOT-MEASURE"), missing.stdout


def test_the_spreadsheet_and_the_jsonl_reach_the_same_decisions():
    """A district's dialler exports a CSV, so both forms exist and they have to agree.

    Parity rather than a second table of expected answers. The two readers build the same
    record shape from different files, and the only thing worth asserting is that they do:
    a district that exports one format must not get a different answer about a family from a
    district that exports the other.

    Compared over the ids the two example files share. The CSV carries one row the JSONL does
    not, which is the case a surviving mutation exposed, so the comparison is by id and not by
    position.
    """
    from adopt_call_records import decide, read_records

    lines = {one["id"]: decide(one) for one in read_records(RECORDS)}
    cells = {one["id"]: decide(one) for one in read_records(CSV_RECORDS)}
    shared = sorted(set(lines) & set(cells))
    assert len(shared) >= 6, (
        f"the two example files share {len(shared)} record(s), which is too few to be a "
        "parity check")

    for key in shared:
        assert lines[key]["outcome"] == cells[key]["outcome"], (
            f"{key} is filed {lines[key]['outcome']!r} from the JSONL and "
            f"{cells[key]['outcome']!r} from the CSV. The same call cannot have two answers "
            "because of the file it arrived in")
        assert lines[key]["why"] == cells[key]["why"], (
            f"{key} lands in the same place from both files and is given a different reason: "
            f"{lines[key]['why']!r} against {cells[key]['why']!r}")


def test_an_empty_answered_cell_is_not_read_as_no():
    """The three states again, this time through the spreadsheet reader.

    A CSV export routinely leaves a cell blank. Reading blank as "nobody picked up" would tell
    an attendance officer that a call did not happen, on a row whose own answer says it did.
    """
    from adopt_call_records import decide, read_records

    rows = {one["id"]: one for one in read_records(CSV_RECORDS)}
    assert "S-2007" in rows, (
        "the CSV example no longer carries a row with an empty `answered` cell, which is the "
        "case this checks and the case a mutation survived on")
    assert "answered" not in rows["S-2007"], (
        "an empty cell became an `answered` value rather than staying absent")
    assert decide(rows["S-2007"])["outcome"] == "closed", (
        "a row with a complete answer and a blank answered cell was not decided on its "
        "answer")

    said = {one["id"]: one for one in read_records(CSV_RECORDS)}["S-2006"]
    assert said.get("answered") is False, (
        "the spreadsheet reader no longer reads a false answered cell as false, so a call "
        "nobody picked up would be judged on the result attached to it")


def test_a_column_the_tool_cannot_read_is_refused_and_the_value_is_not_guessed():
    """Two refusals, both about a district getting its own mapping slightly wrong.

    A column nobody reads and an answered value nobody can parse are the two ways a real
    export goes wrong, and guessing at either would file records for reasons the output does
    not name.
    """
    import csv as _csv

    from adopt_call_records import RecordError, read_records

    scratch = APP / "out" / "bad-columns.csv"
    scratch.parent.mkdir(parents=True, exist_ok=True)

    def _write(rows: list[list[str]]) -> None:
        with scratch.open("w", encoding="utf-8", newline="") as handle:
            _csv.writer(handle).writerows(rows)

    try:
        _write([["id", "answered", "was_parent_aware"], ["S-1", "true", "yes"]])
        try:
            read_records(scratch)
        except RecordError as bad:
            assert "was_parent_aware" in str(bad), f"the column is not named: {bad}"
            assert "parent_confirmed_aware" in str(bad), (
                f"the complaint does not say what the readable columns are: {bad}")
        else:
            raise AssertionError("a column this tool does not read was accepted")

        _write([["id", "answered"], ["S-1", "probably"]])
        try:
            read_records(scratch)
        except RecordError as bad:
            assert "probably" in str(bad), f"the unparseable value is not quoted: {bad}"
            assert "empty" in str(bad), (
                "the complaint does not tell the reader what to do instead, which is to "
                f"leave the cell empty: {bad}")
        else:
            raise AssertionError(
                "answered='probably' was accepted. Guessing at it would decide whether a "
                "call was answered on the basis of a word nobody defined")
    finally:
        scratch.unlink(missing_ok=True)


def test_the_consent_audit_is_retrospective_and_finds_each_reason():
    """These calls already happened, so the question is which of them the register covered.

    Three findings on the example pair, each a different reason, because a register that only
    ever fails one check does not show a district what the gate does.
    """
    done = _run("--records", str(RECORDS), "--consent-register", str(REGISTER),
                "--today", "2026-09-08", "--json")
    assert done.returncode == 0, done.stdout
    findings = {one["id"]: one["why"] for one in json.loads(done.stdout)["consent_findings"]}

    assert len(findings) == 3, (
        f"the example pair produces {len(findings)} consent finding(s) rather than three: "
        f"{sorted(findings)}")
    assert "withdrawn" in findings.get("S-2004", ""), (
        "the withdrawn record is no longer found, or is found for another reason")
    assert "number" in findings.get("S-2006", ""), (
        "the record covering a number the call did not use is no longer found. Consent "
        "attaches to the number called")
    assert "neither" in findings.get("S-2005", ""), (
        "a call resting on no record at all is no longer found, which is the easiest of the "
        "three to miss because there is no record to check")


def test_a_boolean_is_counted_as_a_boolean_and_never_reported_as_a_record():
    """The tool said a call rested on a record the register covers. It rested on a boolean.

    This entry's whole position on consent is that a column saying yes is not a record, and
    the live path holds that line: `ImpactSummary` counts `dialled_on_a_record` and
    `dialled_on_a_boolean` apart and prints the second as "a column that says yes, which is
    not a record" with the schema that replaces it. `firstbell/domain.py` does that at zero
    as well, because an omitted line reads as an absence of information rather than a count.

    This tool had no representation for the case at all: a bare `consented: true` produced no
    finding and no count, and the summary sentence then inferred "rests on a record the
    register covers" from an empty findings list. The absence of a refusal is not evidence of
    a dated record, and a district's counsel is asking exactly which it was.

    So provenance is counted for every row and reported, and the strong sentence is only
    available when every row actually earned it.
    """
    from adopt_call_records import audit_consent, read_records, report

    boolean_only = [{"id": "S-1", "numbers": ["+15550000101"], "consented": True,
                     "_line": 1}]
    findings, provenance = audit_consent(boolean_only, {}, date(2026, 9, 8))
    assert provenance["boolean"] == 1, (
        "a row carrying a bare `consented: true` is not counted as resting on a boolean, so "
        "the one question a district's counsel asks has no answer in the output")
    assert provenance["record"] == 0, (
        "a bare boolean is being counted as a dated consent record, which is the claim this "
        "entry exists to refuse")

    filed = [{"id": "S-1", "outcome": "closed", "why": "x", "escalated": False,
              "had_result": True}]
    said = report(boolean_only, filed, findings, provenance)
    assert "rests on a record the register covers" not in said, (
        "the summary still claims a record for a call that rests on a boolean:\n" + said)
    assert "not a record" in said, (
        "the report counts the boolean and does not say what is wrong with it. The live path "
        f"spells it out and this has to as well:\n{said}")

    # And the good path still gets to say so, because a report that only ever finds fault is
    # one nobody believes. Every row in the example pair that is not a finding rests on a
    # dated record.
    covered = [one for one in read_records(RECORDS)
               if one.get("consent_record") in {"CR-2001", "CR-2002", "CR-2003"}]
    assert len(covered) == 3, "the example pair no longer holds three covered rows"
    from dispatch.consent import load_register

    register = load_register(json.loads(REGISTER.read_text(encoding="utf-8")), str(REGISTER))
    _, clean = audit_consent(covered, register, date(2026, 9, 8))
    assert clean["record"] == 3 and clean["boolean"] == 0 and clean["nothing"] == 0, (
        f"three rows resting on dated records are counted as {clean}")


def test_a_consent_finding_is_output_and_not_an_error_unless_asked():
    """A district running this on its own history wants the findings, not a failed command.

    Opt-in, because the same tool belongs in a pipeline where an uncovered call should stop
    something, and that is a decision for whoever runs it rather than for this file.
    """
    args = ["--records", str(RECORDS), "--consent-register", str(REGISTER),
            "--today", "2026-09-08"]
    assert _run(*args).returncode == 0, "findings changed the exit code without being asked to"
    asked = _run(*args, "--fail-on-uncovered")
    assert asked.returncode == 1, (
        f"--fail-on-uncovered exited {asked.returncode} with three findings on the record")


# ---- what another district's export actually looks like -----------------------------------
#
# Six defects a bug hunt reproduced on this file, all of the same shape: a value the tool was
# never given in an example, arriving from a system nobody here controls. The first three are
# the dangerous ones, because each produced a confident wrong answer rather than a refusal.


def test_answered_is_read_the_same_way_in_both_formats(tmp_path):
    """`"false"`, `"no"` and `0` are not somebody picking up the telephone.

    The CSV reader knew that a spreadsheet writes `no` and the JSONL reader tested
    `answered is False`, so a record exported as JSON out of a spreadsheet, which is what a
    dialler produces, was read as answered on every one of those values. It was then filed
    closed on whatever result sat beside it: a call nobody took, closed, on an answer nobody
    gave. That is the defect this entire entry is about, arriving through the other door.
    """
    from tools.adopt_call_records import decide, read_records

    for spelling in ('"false"', '"no"', '"NO"', '"unanswered"', '0'):
        path = tmp_path / "one.jsonl"
        path.write_text(
            '{"id":"A","answered":' + spelling + ',"consent_record":"C","result":'
            '{"reason_category":"illness","expected_return":"today",'
            '"parent_confirmed_aware":"yes","spoke_with":"guardian"}}\n',
            encoding="utf-8", newline="\n")
        filed = decide(read_records(path)[0])
        assert filed["outcome"] == "undetermined", (
            f"answered={spelling} was read as somebody having picked up, so a call nobody "
            f"took was filed {filed['outcome']} on a result nobody gave")


def test_a_value_answered_cannot_mean_is_refused_rather_than_guessed(tmp_path):
    """And the other half: a word this does not know is a mapping mistake, not a default."""
    from tools.adopt_call_records import RecordError, read_records

    path = tmp_path / "odd.jsonl"
    path.write_text('{"id":"A","answered":"maybe"}\n', encoding="utf-8", newline="\n")
    with pytest.raises(RecordError) as refused:
        read_records(path)
    assert "maybe" in str(refused.value)


def test_one_number_written_as_a_string_is_one_number(tmp_path):
    """`tuple(str(n) for n in "+15550000101")` is twelve numbers, one per character.

    The consent audit then told an attendance officer that the record "covers 1 number(s)
    and this row carries 12 the record does not name", which is a sentence somebody acts on
    about a family, built out of a type confusion.
    """
    from tools.adopt_call_records import read_records

    path = tmp_path / "scalar.jsonl"
    path.write_text('{"id":"A","numbers":"+15550000101"}\n'
                    '{"id":"B","numbers":15550000102}\n',
                    encoding="utf-8", newline="\n")
    got = read_records(path)
    assert got[0]["numbers"] == ["+15550000101"], got[0]["numbers"]
    assert got[1]["numbers"] == ["15550000102"], got[1]["numbers"]


def test_a_column_named_twice_is_refused_rather_than_resolved_by_position(tmp_path):
    """`csv.DictReader` keeps the last value for a repeated header and says nothing.

    The unknown-column gate could not see it either, because the header names went into a
    set. So a file carrying `parent_confirmed_aware` twice with `no` and then `yes` was
    filed closed, and the same file with the values swapped was escalated. Column order
    decided whether a child's absence was closed.
    """
    from tools.adopt_call_records import RecordError, read_records

    path = tmp_path / "twice.csv"
    path.write_text(
        "id,parent_confirmed_aware,parent_confirmed_aware,reason_category,expected_return\n"
        "D1,no,yes,illness,today\n",
        encoding="utf-8", newline="\n")
    with pytest.raises(RecordError) as refused:
        read_records(path)
    assert "more than once" in str(refused.value)


def test_a_file_that_is_not_utf8_is_a_third_outcome_and_not_an_error(tmp_path, capsys):
    """A district exporting from a Windows codepage hits this on the first accented name.

    It raised `UnicodeDecodeError` out of `read_text` and exited 1, which this tool's own
    contract reserves for a consent finding under `--fail-on-uncovered`. A script could not
    tell "one of these calls rests on nothing" from "your file is in the wrong encoding".
    """
    from tools.adopt_call_records import main

    path = tmp_path / "cp1252.jsonl"
    path.write_bytes(b'{"id":"A","transcript":"caf\xe9"}\n')
    assert main(["--records", str(path)]) == 3
    assert "COULD-NOT-MEASURE" in capsys.readouterr().out


def test_an_unusable_consent_register_is_a_third_outcome_too(tmp_path, capsys):
    """Same rule, the other input. Both failures escaped as tracebacks."""
    from tools.adopt_call_records import main

    records = tmp_path / "r.jsonl"
    records.write_text('{"id":"A"}\n', encoding="utf-8", newline="\n")

    invalid = tmp_path / "invalid.json"
    invalid.write_text('{"records": [{"id":"X"}]}', encoding="utf-8", newline="\n")
    assert main(["--records", str(records), "--consent-register", str(invalid)]) == 3
    assert "COULD-NOT-MEASURE" in capsys.readouterr().out

    truncated = tmp_path / "truncated.json"
    truncated.write_text('{"records": [', encoding="utf-8", newline="\n")
    assert main(["--records", str(records), "--consent-register", str(truncated)]) == 3
    assert "is not JSON" in capsys.readouterr().out


def test_fail_on_uncovered_counts_a_boolean_as_uncovered(tmp_path, capsys):
    """Because a column that says yes is not a consent record, which this report says itself.

    The flag's help reads "exit 1 when a call rests on no consent record". A row carrying a
    bare `consented: true` produces no refusal, so there was no finding, so it exited 0
    while the line above the exit read `on a boolean 1`. The only machine-readable answer
    disagreed with the report printed over it.
    """
    from tools.adopt_call_records import main

    path = tmp_path / "boolean.jsonl"
    path.write_text(
        '{"id":"A","answered":true,"consented":true,"result":{"reason_category":"illness",'
        '"expected_return":"today","parent_confirmed_aware":"yes",'
        '"spoke_with":"guardian"}}\n',
        encoding="utf-8", newline="\n")

    assert main(["--records", str(path)]) == 0, (
        "a boolean is output and not an error, so it must not change the exit code on its "
        "own")
    printed = capsys.readouterr().out
    assert "on a boolean" in printed

    assert main(["--records", str(path), "--fail-on-uncovered"]) == 1, (
        "the flag exited 0 on a call resting on a column, which is what it exists to catch")

    nothing = tmp_path / "nothing.jsonl"
    nothing.write_text('{"id":"B"}\n', encoding="utf-8", newline="\n")
    assert main(["--records", str(nothing), "--fail-on-uncovered"]) == 1


def test_the_queue_holds_only_rows_that_need_a_person():
    """A row printed under the queue heading is a row a clerk works.

    Two of the six records came back closed, each carrying the sentence that nothing there
    needs a person, and both were printed inside a list headed "The queue, escalations
    first". A clerk reading the queue as the morning's work reads two records that were
    already settled. The lists are split now, and this checks the split rather than the
    wording, so the headings can be reworded and the rule still holds.
    """
    done = _run("--records", str(RECORDS), "--consent-register", str(REGISTER),
                "--today", "2026-09-08")
    assert done.returncode == 0, f"the documented command exited {done.returncode}"
    lines = done.stdout.splitlines()

    opens = [i for i, one in enumerate(lines) if one.startswith("The queue,")]
    shuts = [i for i, one in enumerate(lines)
             if one.startswith("Closed, and needing nobody")]
    assert len(opens) == 1, f"the queue heading is printed {len(opens)} times, not once"
    assert len(shuts) == 1, (
        "the closed records are not printed under a heading of their own, so they are "
        "either missing from the output or back inside the queue")
    assert shuts[0] > opens[0], "the closed list is printed above the queue it is not part of"

    queue = lines[opens[0] + 1:shuts[0]]
    assert queue, "the queue heading is printed with nothing under it"
    settled = [one for one in queue if "nothing here needs a person" in one]
    assert not settled, (
        "the queue holds record(s) whose own line says nothing there needs a person: "
        + " | ".join(one.strip() for one in settled))

    after = [one for one in lines[shuts[0] + 1:] if "nothing here needs a person" in one]
    assert after, (
        "no record under the closed heading says nothing there needs a person, so the "
        "sentence this gate looks for has moved and the gate is measuring nothing")


def test_a_fixture_comment_names_only_records_the_pair_contains():
    """A comment pointing at ids that do not exist is worse than no comment.

    The register's comment named CR-2026-2004 and CR-2026-2006 while the records in it are
    CR-2004 and CR-2006, so a reviewer following the comment to see why a call comes back
    as a finding found neither id anywhere in the file. That comment is the reading path
    into the fixture, so its ids are checked against the fixture rather than proofread.
    """
    import re

    register = json.loads(REGISTER.read_text(encoding="utf-8"))
    comment = register["_comment"]
    held = {one["id"] for one in register["records"]}

    called = set()
    for line in RECORDS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        called.add(json.loads(line)["id"])

    named = set(re.findall(r"\bCR-[0-9-]+\b", comment))
    assert named, (
        "the register's comment names no record at all, so it cannot explain which call "
        "comes back as which finding")
    missing = sorted(named - held)
    assert not missing, (
        f"the register's comment names {', '.join(missing)}, which the register does not "
        f"contain. It holds {', '.join(sorted(held))}")

    students = set(re.findall(r"\bS-[0-9-]+\b", comment))
    stray = sorted(students - called)
    assert not stray, (
        f"the register's comment names {', '.join(stray)} as a call, and {RECORDS.name} "
        "has no such row, so the pair the comment describes is not the pair on disk")


def test_one_pupil_with_two_contradicting_records_is_not_filed_closed(tmp_path):
    """Two records, one pupil, opposite answers, and the closed pile took one of them.

    An export with the same id on two lines is two calls about one child, which is
    legitimate: a first attempt nobody answered and a second that got through. What is not
    legitimate is filing one of them closed while the other says a person has to ring back.
    A clerk reads the closed pile as settled, and `tools/replay_escalation.py` de-duplicates
    by call id for exactly this reason.

    So the row that needs a person is the one that counts. Both records still print, because
    hiding one of two real calls is the other way to be wrong, and the collision is named
    rather than resolved silently.
    """
    # The shape the reader takes, copied from examples/other-dialler-records.jsonl. The
    # field that decides the outcome is `spoke_with`: a guardian closes the record and a
    # child cannot, because a child has no authority to give the answer.
    records = tmp_path / "twice.jsonl"
    settled = {"id": "S-1", "numbers": ["+15550000501"], "answered": True,
               "result": {"reason_category": "illness", "expected_return": "tomorrow",
                          "parent_confirmed_aware": "yes", "spoke_with": "guardian"}}
    unsettled = {"id": "S-1", "numbers": ["+15550000501"], "answered": True,
                 "result": {"reason_category": "illness", "expected_return": "today",
                            "parent_confirmed_aware": "yes", "spoke_with": "child"}}
    records.write_text(json.dumps(settled) + "\n" + json.dumps(unsettled) + "\n",
                       encoding="utf-8")

    done = _run("--records", str(records), "--today", "2026-09-08")
    assert done.returncode == 0, f"the tool exited {done.returncode}: {done.stdout}"

    lines = done.stdout.splitlines()
    shuts = [i for i, one in enumerate(lines)
             if one.startswith("Closed, and needing nobody")]
    if shuts:
        closed = lines[shuts[0] + 1:]
        assert not [one for one in closed if "S-1" in one], (
            "S-1 has a record saying a person has to ring back and a record filed closed, "
            "and the closed pile is where a clerk stops reading:\n  "
            + "\n  ".join(one.strip() for one in closed if one.strip()))

    assert "more than once" in done.stdout, (
        "the tool files two contradicting records for one pupil without saying that is "
        f"what it did:\n{done.stdout}")


def test_a_file_with_a_header_and_no_rows_says_that_and_not_something_else(tmp_path):
    """A spreadsheet has neither blank lines nor comments, so it cannot be told it has only those.

    The message was written for the JSONL path and reached the CSV path unchanged, so a
    district whose export produced a header and nothing under it was told its file held
    "only blank or commented lines". It is the right exit code and the wrong sentence, and
    the sentence is the whole of what the district has to work from.
    """
    records = tmp_path / "header-only.csv"
    # Columns this tool reads. The first version of this fixture named a column the
    # tool refuses, so the file was rejected for its header rather than for holding no
    # rows, and this gate passed on a message about something else. It measured zero
    # against its own mutation, which is the only reason that was found.
    records.write_text("id,answered,numbers,reason_category\n", encoding="utf-8")

    done = _run("--records", str(records), "--today", "2026-09-08")
    assert done.returncode == 3, (
        f"a file with nothing to audit exited {done.returncode} rather than the "
        f"could-not-measure code: {done.stdout}")
    assert "COULD-NOT-MEASURE" in done.stdout
    assert "blank or commented" not in done.stdout, (
        f"a spreadsheet is told it holds only blank or commented lines:\n{done.stdout}")
    assert "header" in done.stdout.lower(), (
        "the message does not say the file is a header with nothing under it, and that "
        f"sentence is the whole of what the district has to work from:\n{done.stdout}")


def test_a_boolean_saying_no_is_read_even_when_a_dated_record_says_yes():
    """The audit tool must not certify a call the live path refuses.

    `dial_refusal` reads the dated record and then the boolean, and refuses if either says
    no. Its docstring gives the reason: "a record withdrawn last week sits beside a consent
    column that still says yes, and reading the weaker of two answers is how somebody who
    asked not to be called gets called." `audit_consent` returned as soon as the record
    cleared, so the column was never read. On this row the tool answered "every call rests
    on a dated record" while firstbell's own gate answered "no recorded consent".

    This is the third copy of a gate found with fewer branches than the gate it copies.
    """
    from dispatch.consent import load_register
    from dispatch.models import WorkItem, dial_refusal
    from adopt_call_records import audit_consent

    register = load_register({"records": [{
        "id": "CR-1", "student_id": "S-1", "channel": "voice", "purpose": "attendance",
        "given_at": "2026-08-01", "phones": ["+15550100301"],
    }]}, "register.json")

    row = {"id": "S-1", "consent_record": "CR-1", "consented": False,
           "numbers": ["+15550100301"]}

    live = dial_refusal(WorkItem(id="S-1", phones=("+15550100301",), consented=False,
                                 consent_record="CR-1"))
    assert live is not None, "the fixture must be a row the live path actually refuses"

    findings, provenance = audit_consent([row], register, date(2026, 9, 9))
    assert findings, (
        "the tool certified a call the dispatcher refuses. Its whole job is telling a "
        "district which of its placed calls its own paperwork authorised")
    assert provenance["record"] == 0, "this row does not rest on a record alone"


def test_uncovered_counts_each_unauthorised_row_once():
    """`len(findings) + boolean + nothing` counted every "rests on nothing" row twice.

    The `else` branch appends a finding and increments `nothing`, so the sum was
    `refused + boolean + 2 x nothing`: three uncovered calls out of two records.
    """
    from adopt_call_records import audit_consent, uncovered_count

    rows = [
        {"id": "S-1", "consented": True, "numbers": ["+15550100301"]},   # a bare boolean
        {"id": "S-2", "numbers": ["+15550100302"]},                      # nothing at all
    ]
    findings, provenance = audit_consent(rows, {}, date(2026, 9, 9))
    assert uncovered_count(findings, provenance) == 2, (
        "two rows rest on no dated record, and the count must not exceed the rows")


def test_a_row_that_is_uninformative_and_alarming_is_marked_and_named():
    """`decide` returns the outcome and the escalation separately; `report` read one.

    A result whose every required field came back unknown, from a call a child answered,
    files as `undetermined` and is also escalated. The headline counted only the outcome, so
    it printed "escalated 0" while the same run's `--json` marked the row escalated, and the
    `!!` the legend defines as "a person has to see it" was withheld from it.
    """
    from adopt_call_records import decide, report

    child = {"id": "S-CHILD", "result": {
        "reason_category": "unknown", "expected_return": "unknown", "spoke_with": "child"}}
    ordinary = {"id": "S-PLAIN", "result": {
        "reason_category": "illness", "expected_return": "tomorrow",
        "parent_confirmed_aware": "yes"}}

    filed = [decide(child), decide(ordinary)]
    marked = next(one for one in filed if one["id"] == "S-CHILD")
    assert marked["outcome"] == "undetermined" and marked["escalated"] is True, (
        "fixture must be the both-at-once row this is about")

    text = report([child, ordinary], filed, [], {"record": 0, "boolean": 0,
                                                 "nothing": 0, "refused": 0})
    assert "safeguarding signal" in text, (
        "the headline reported no escalation for a row its own --json escalates")
    child_line = next(line for line in text.splitlines() if "S-CHILD" in line)
    assert "!!" in child_line, "the marker the legend defines was withheld"
    plain_line = next(line for line in text.splitlines() if "S-PLAIN" in line)
    assert "!!" not in plain_line, "and it must still mean something"
