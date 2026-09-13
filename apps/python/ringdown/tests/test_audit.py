from __future__ import annotations

import json
from pathlib import Path

import pytest

from fake import scenarios
from ringdown.audit import (
    GENESIS,
    SCHEMA,
    VERDICT_RULES,
    append_record,
    attempt_record,
    chain_checks,
    head,
    intent_record,
    sealed,
    verdict_record,
    verification_record,
    verdict_v1,
)
from ringdown.calls import parse_turns, snapshot_from
from ringdown.canonical import canonical_json
from ringdown.checks import all_ok, contradicted
from ringdown.escalate import Attempt, LadderResult
from ringdown.incident import IncidentError
from ringdown.extract import extract
from tests.data import ALICE, LADDER

EXTRACTION = extract(parse_turns(scenarios.answer_ack(ALICE.name, "alice").turns))
GOLDEN = Path(__file__).resolve().parent / "golden"


def an_attempt(**overrides) -> Attempt:
    fields = {
        "rung": LADDER[0],
        "key": "rd-inc-1-primary-1-abc123def456",
        "attempt_id": "inc-1/primary/1",
        "verdict": "not_acknowledged",
        "reason": "no_answer",
        "call_id": "call_fake1",
        "snapshot": snapshot_from({"id": "call_fake1", "status": "failed"}),
        "extraction": EXTRACTION,
    }
    return Attempt(**{**fields, **overrides})


SAW_IT = [(True, "run for Alice Okafor reports no acknowledgement")]


def write_run(path, verdict="unacknowledged", attempt=None, checks=None):
    attempt = attempt or an_attempt()
    append_record(path, attempt_record(attempt, "inc-1"))
    append_record(path, verdict_record("inc-1", LadderResult(verdict, (attempt,))))
    append_record(
        path,
        verification_record(
            "inc-1", checks or SAW_IT, rest_host="rest.example", mcp_host="mcp.example"
        ),
    )


def read_lines(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def write_back(path, records) -> None:
    path.write_text("".join(canonical_json(record) + "\n" for record in records))


def test_a_run_writes_one_attempt_record_a_verdict_and_a_verification(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)

    records = read_lines(ledger)

    assert [record["type"] for record in records] == ["attempt", "verdict", "verification"]
    assert records[0]["prev"] == GENESIS
    assert records[1]["prev"] == records[0]["hash"]


def test_the_ledger_chain_verifies_end_to_end(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)

    checks = chain_checks(ledger)

    assert len(checks) == 11
    assert all_ok(checks)
    assert checks[0][1] == "record 1 links to the genesis hash"
    assert checks[-1][1] == "record 2 verdict unacknowledged follows from the recorded attempts"


def test_a_rewritten_record_with_a_recomputed_hash_still_breaks_the_chain(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    records = read_lines(ledger)
    records[1]["verdict"] = "acknowledged"
    records[1] = sealed(records[1])
    write_back(ledger, records)

    checks = dict((label, ok) for ok, label in chain_checks(ledger))

    assert checks["record 2 hash matches its content"]
    assert not checks["record 3 links to record 2"]


def test_a_rewritten_verdict_with_the_whole_chain_relinked_is_still_detected(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    records = read_lines(ledger)
    records[1]["verdict"] = "acknowledged"
    records[1] = sealed(records[1])
    records[2]["prev"] = records[1]["hash"]
    records[2] = sealed(records[2])
    write_back(ledger, records)

    checks = chain_checks(ledger)

    links_hashes_and_positions = checks[:9]
    assert all(ok for ok, _ in links_hashes_and_positions)
    assert checks[-1] == (
        False,
        "record 2 verdict acknowledged does not follow from the recorded attempts (unacknowledged)",
    )


def test_a_fabricated_verdict_with_no_attempts_underneath_does_not_follow(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    result = LadderResult("acknowledged", (an_attempt(verdict="acknowledged", extraction=EXTRACTION),))
    append_record(ledger, verdict_record("inc-1", result))

    checks = chain_checks(ledger)

    assert (
        False,
        "record 1 verdict acknowledged does not follow from the recorded attempts (unacknowledged)",
    ) in checks


def test_two_incidents_interleaved_in_one_ledger_each_derive_their_own_verdict(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    one = an_attempt(attempt_id="inc-1/primary/1")
    two = an_attempt(attempt_id="inc-2/primary/1", verdict="declined")
    append_record(ledger, attempt_record(one, "inc-1"))
    append_record(ledger, attempt_record(two, "inc-2"))
    append_record(ledger, verdict_record("inc-1", LadderResult("unacknowledged", (one,))))
    append_record(ledger, verdict_record("inc-2", LadderResult("declined", (two,))))

    checks = chain_checks(ledger)

    assert all_ok(checks)
    assert checks[-2][1] == "record 3 verdict unacknowledged follows from the recorded attempts"
    assert checks[-1][1] == "record 4 verdict declined follows from the recorded attempts"


def test_an_attempt_written_before_the_incident_field_existed_still_verifies(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    attempt = an_attempt(verdict="declined")
    older = {name: value for name, value in attempt_record(attempt, "inc-1").items()
             if name != "incident"}
    append_record(ledger, older)
    append_record(ledger, verdict_record("inc-1", LadderResult("declined", (attempt,))))

    assert all_ok(chain_checks(ledger))


def test_the_ledger_masks_phones_and_keeps_only_the_quoted_spans(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger, verdict="acknowledged", attempt=an_attempt(verdict="acknowledged", extraction=EXTRACTION))

    raw = ledger.read_text()

    assert ALICE.phone not in raw
    assert "+1********00" in raw
    assert "give me fifteen minutes" in raw
    assert "automated on-call page" not in raw


def test_the_ledger_file_is_created_private(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)

    assert ledger.stat().st_mode & 0o777 == 0o600


def test_an_unreadable_ledger_line_is_a_failed_check_not_a_crash(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    with ledger.open("a") as handle:
        handle.write("{not json\n")

    checks = chain_checks(ledger)

    assert checks == [(False, "record 4 is not readable JSON")]


def test_a_ledger_path_in_a_missing_directory_is_a_usage_error_not_a_traceback(tmp_path):
    with pytest.raises(IncidentError, match="cannot open the ledger"):
        append_record(tmp_path / "missing" / "ledger.jsonl", {"type": "note"})


def test_a_valid_json_line_that_is_not_an_object_is_a_failed_check_not_a_crash(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    with ledger.open("a") as handle:
        handle.write("42\n")

    checks = chain_checks(ledger)

    assert checks == [(False, "record 4 is not a JSON object")]


def test_appending_after_an_oversized_record_does_not_break_the_chain(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    append_record(ledger, {"type": "note", "note": "x" * 9000})
    append_record(ledger, {"type": "note", "note": "after"})

    records = read_lines(ledger)
    assert [record["seq"] for record in records] == [1, 2, 3, 4, 5]
    assert records[4]["prev"] == records[3]["hash"]


def test_a_ledger_whose_verification_was_contradicted_does_not_pass(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger, checks=[(True, "one held"), (False, "the second channel said otherwise")])

    checks = chain_checks(ledger)

    assert (False, "record 3 reports the verdict was contradicted on the second channel") in checks
    assert not all_ok(checks)


def test_a_ledger_whose_verification_went_unanswered_is_unresolved_not_tampered(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger, checks=[(True, "one held"), (None, "the second channel never answered")])

    checks = chain_checks(ledger)

    assert (None, "record 3 reports the verdict was never confirmed on the second channel") in checks
    assert not all_ok(checks) and not contradicted(checks)


def test_a_golden_ledger_from_an_earlier_build_still_verifies():
    assert all_ok(chain_checks(GOLDEN / "ledger-v1.jsonl"))


def test_a_golden_ledger_written_before_the_schema_and_position_fields_still_verifies():
    assert all_ok(chain_checks(GOLDEN / "ledger-v0.jsonl"))


def test_a_deleted_record_is_caught_even_when_the_chain_is_relinked_and_resealed(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    records = read_lines(ledger)
    del records[1]
    previous = records[0]["hash"]
    records[1] = sealed({**records[1], "prev": previous})
    write_back(ledger, records)

    checks = dict((label, ok) for ok, label in chain_checks(ledger))

    assert checks["record 2 links to record 1"]
    assert checks["record 2 hash matches its content"]
    assert not checks["record 2 carries its position in the chain"]


def test_a_ledger_written_by_a_newer_schema_is_unresolved_not_tampered(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    records = read_lines(ledger)
    records[1] = sealed({**records[1], "schema": 99})
    records[2] = sealed({**records[2], "prev": records[1]["hash"]})
    write_back(ledger, records)

    checks = chain_checks(ledger)

    assert (None, "record 2 was written by schema 99, which this build cannot read") in checks
    assert not contradicted(checks)


def test_a_truncated_tail_leaves_a_chain_that_still_verifies(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    kept = ledger.read_text().splitlines()[:1]
    ledger.write_text(kept[0] + "\n")

    assert all_ok(chain_checks(ledger))


@pytest.mark.parametrize(
    "attempts,expected",
    [
        ([], "unacknowledged"),
        (["not_acknowledged"], "unacknowledged"),
        (["not_acknowledged", "not_acknowledged"], "unacknowledged"),
        (["acknowledged"], "acknowledged"),
        (["not_acknowledged", "acknowledged"], "acknowledged"),
        (["declined"], "declined"),
        (["not_acknowledged", "declined"], "declined"),
        (["unknown"], "unknown"),
        (["not_acknowledged", "unknown"], "unknown"),
    ],
)
def test_the_rule_that_wrote_the_older_ledgers_is_frozen_by_value(attempts, expected):
    assert verdict_v1(attempts) == expected


def test_the_rule_the_ladder_runs_today_still_agrees_with_the_frozen_one():
    from ringdown.escalate import ladder_verdict

    for attempts in ([], ["not_acknowledged"], ["acknowledged"], ["declined"], ["unknown"]):
        assert ladder_verdict(attempts) == verdict_v1(attempts)


def test_every_schema_this_build_ever_wrote_can_still_be_re_derived():
    assert set(VERDICT_RULES) == set(range(1, SCHEMA + 1))


def test_appending_to_an_empty_ledger_starts_the_chain_at_genesis(tmp_path):
    ledger = tmp_path / "l.jsonl"
    ledger.write_text("")

    append_record(ledger, verdict_record("inc-1", LadderResult("unacknowledged", ())))

    first = read_lines(ledger)[0]
    assert first["prev"] == GENESIS and first["seq"] == 1


def test_a_ledger_truncated_without_its_final_newline_does_not_swallow_the_next_record(tmp_path):
    ledger = tmp_path / "l.jsonl"
    write_run(ledger)
    ledger.write_text(ledger.read_text().rstrip("\n"))

    append_record(ledger, verdict_record("inc-2", LadderResult("unacknowledged", ())))

    records = read_lines(ledger)
    assert len(records) == 4 and records[3]["seq"] == 4
    assert all_ok(chain_checks(ledger))


def test_a_blank_line_at_the_end_does_not_break_the_next_append(tmp_path):
    ledger = tmp_path / "l.jsonl"
    write_run(ledger)
    third = read_lines(ledger)[2]
    ledger.write_text(ledger.read_text() + "\n")

    append_record(ledger, verdict_record("inc-2", LadderResult("unacknowledged", ())))

    appended = json.loads(ledger.read_text().splitlines()[-1])
    assert appended["prev"] == third["hash"]
    assert not all_ok(chain_checks(ledger))


def test_appending_to_a_ledger_written_before_the_position_field_counts_instead_of_guessing(
    tmp_path,
):
    ledger = tmp_path / "l.jsonl"
    ledger.write_text((GOLDEN / "ledger-v0.jsonl").read_text())

    append_record(ledger, verdict_record("inc-2", LadderResult("unacknowledged", ())))

    assert read_lines(ledger)[-1]["seq"] == 4


def test_an_intent_with_no_attempt_is_reported_as_a_call_left_to_reconcile(tmp_path):
    ledger = tmp_path / "l.jsonl"
    append_record(ledger, intent_record("inc-1", "inc-1/primary/1", "rd-key-abc", LADDER[0]))

    orphan = [check for check in chain_checks(ledger) if "has no attempt" in check[1]]

    assert orphan == [(None, "record 1 announced rd-key-abc and has no attempt")]
    assert not contradicted(chain_checks(ledger))


def test_an_intent_whose_attempt_landed_is_not_reported_as_pending(tmp_path):
    ledger = tmp_path / "l.jsonl"
    attempt = an_attempt()
    append_record(ledger, intent_record("inc-1", attempt.attempt_id, attempt.key, LADDER[0]))
    write_run(ledger, attempt=attempt)

    assert not [check for check in chain_checks(ledger) if "has no attempt" in check[1]]


def test_the_ledger_summary_reads_the_same_records_the_appender_counted(tmp_path):
    ledger = tmp_path / "l.jsonl"
    write_run(ledger)
    third = read_lines(ledger)[2]
    ledger.write_text(ledger.read_text() + "\n")

    assert head(ledger) == (3, third["hash"])


def test_a_corrupt_last_line_makes_appending_a_usage_error_not_a_traceback(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    with ledger.open("a") as handle:
        handle.write("{not json\n")

    with pytest.raises(IncidentError, match="not readable JSON"):
        append_record(ledger, {"type": "note"})
    with pytest.raises(IncidentError, match="not readable JSON"):
        head(ledger)


def test_a_last_line_that_is_not_an_object_is_a_usage_error_not_a_traceback(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    write_run(ledger)
    with ledger.open("a") as handle:
        handle.write("42\n")

    with pytest.raises(IncidentError, match="not a JSON object"):
        append_record(ledger, {"type": "note"})
    with pytest.raises(IncidentError, match="not a JSON object"):
        head(ledger)
