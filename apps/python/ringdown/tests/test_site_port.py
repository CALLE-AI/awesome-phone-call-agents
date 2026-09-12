from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from ringdown.audit import (
    append_record,
    attempt_record,
    chain_checks,
    intent_record,
    notified_record,
    verdict_record,
    verification_record,
)
from ringdown.canonical import canonical_json
from ringdown.escalate import LadderResult
from tests.data import EXAMPLES, LADDER, an_attempt

SITE = EXAMPLES.parents[3] / "docs"
PORT = SITE / "ledger.js"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    not PORT.exists() or NODE is None,
    reason="docs/ stays out of the upstream checkout, and the port needs node to run",
)

READER = """
import {{ readFileSync }} from "node:fs";
import {{ chainChecks, parseLedger }} from "{port}";

const records = parseLedger(readFileSync(process.argv[2], "utf8"));
const checks = await chainChecks(records);
console.log(JSON.stringify(checks.map((check) => [check.ok, check.label])));
"""


@pytest.fixture(scope="module")
def reader(tmp_path_factory) -> Path:
    script = tmp_path_factory.mktemp("port") / "read.mjs"
    script.write_text(READER.format(port=PORT.as_uri()))
    return script


def in_the_browser(reader: Path, ledger: Path) -> list[list]:
    done = subprocess.run(
        [NODE, str(reader), str(ledger)], capture_output=True, text=True, check=True
    )
    return json.loads(done.stdout)


def rewrite(ledger: Path, records: list[dict]) -> None:
    ledger.write_text("\n".join(canonical_json(record) for record in records) + "\n")


def records_in(ledger: Path) -> list[dict]:
    return [json.loads(line) for line in ledger.read_text().splitlines()]


def a_run(ledger: Path, *, verdict: str = "unacknowledged") -> None:
    attempt = an_attempt()
    append_record(ledger, intent_record("inc-1", attempt.attempt_id, attempt.key, LADDER[0]))
    append_record(ledger, attempt_record(attempt, "inc-1"))
    append_record(ledger, verdict_record("inc-1", LadderResult(verdict, (attempt,))))
    append_record(
        ledger,
        verification_record(
            "inc-1", [(True, "one held")], rest_host="rest.example", mcp_host="mcp.example"
        ),
    )


def a_clean_run(ledger: Path) -> None:
    a_run(ledger)


def a_note_that_never_arrived(ledger: Path) -> None:
    a_run(ledger)
    append_record(
        ledger,
        notified_record("inc-1", host="api.pagerduty.com", delivered=False, detail="http 403"),
    )


def an_announced_call_with_no_attempt(ledger: Path) -> None:
    a_run(ledger)
    append_record(ledger, intent_record("inc-1", "inc-1/secondary/1", "rd-key-2", LADDER[1]))


def a_verdict_that_does_not_follow(ledger: Path) -> None:
    a_run(ledger)
    records = records_in(ledger)
    records[2]["verdict"] = "acknowledged"
    rewrite(ledger, records)


def check_counts_that_are_not_numbers(ledger: Path) -> None:
    a_run(ledger)
    records = records_in(ledger)
    records[3]["verified"] = False
    records[3]["total"] = "3"
    rewrite(ledger, records)


def a_schema_from_the_future(ledger: Path) -> None:
    a_run(ledger)
    records = records_in(ledger)
    records[2]["schema"] = 99
    rewrite(ledger, records)


LEDGERS = [
    a_clean_run,
    a_note_that_never_arrived,
    an_announced_call_with_no_attempt,
    a_verdict_that_does_not_follow,
    check_counts_that_are_not_numbers,
    a_schema_from_the_future,
]


@pytest.mark.parametrize("build", LEDGERS, ids=[build.__name__ for build in LEDGERS])
def test_the_browser_port_reaches_the_same_checks_as_audit_chain_checks(reader, tmp_path, build):
    ledger = tmp_path / "ledger.jsonl"
    build(ledger)

    here = [[ok, label] for ok, label in chain_checks(ledger)]
    there = in_the_browser(reader, ledger)

    assert there == here, (
        "docs/ledger.js has drifted from audit.chain_checks. The site claims to be a port of it, "
        "and the seals only catch a drift in the digest, never a missing family of checks."
    )
