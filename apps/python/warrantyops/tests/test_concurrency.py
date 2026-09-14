"""F3: concurrent processes, one ledger file, exactly one call.

The duplicate-call control is the reservation inside a ``BEGIN IMMEDIATE``
transaction — so the proof of it has to be real operating-system processes
racing one SQLite file, not threads inside one interpreter sharing mocks.
N processes launch the same scenario against the same ``--ledger-db``; the
assertions afterwards are about the world, not about any process's report:

* exactly one process placed a call (the others were suppressed at the
  attempt-ledger gate);
* the ledger holds one row for the key, in state ``COMPLETED``, with the
  vendor call id attached;
* the audit chain records exactly one ``RESERVED`` transition and verifies
  clean.

Runs on every platform the suite runs on; workers are fresh interpreters,
which is the same start method everywhere (``spawn`` semantics by
construction).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from warrantyops.ledger import AttemptState, SqliteAttemptLedger

APP_ROOT = Path(__file__).resolve().parents[1]
SCENARIO = "case_a_useful_resolution"
WORKERS = 6


def spawn_workers(tmp_path: Path, count: int) -> list[dict]:
    ledger_db = tmp_path / "race-ledger.sqlite"
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(APP_ROOT) + os.pathsep + environment.get("PYTHONPATH", "")
    processes = [
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "warrantyops",
                "--scenario",
                SCENARIO,
                "--ledger-db",
                str(ledger_db),
            ],
            cwd=str(APP_ROOT),
            env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
        )
        for _ in range(count)
    ]
    reports = []
    for process in processes:
        stdout, stderr = process.communicate(timeout=120)
        assert process.returncode == 0, stderr
        reports.append(json.loads(stdout))
    return reports


def test_concurrent_processes_place_exactly_one_call(tmp_path):
    reports = spawn_workers(tmp_path, WORKERS)

    winners = [r for r in reports if not r.get("refused")]
    suppressed = [r for r in reports if r.get("refused")]
    assert len(winners) == 1, f"{len(winners)} processes believed they placed the call"
    assert len(suppressed) == WORKERS - 1

    # The fake provider replays the scenario once (the winner) and never
    # places a real call (everyone — that counter is zero by construction).
    assert winners[0]["provider_replays"] == 1
    for report in suppressed:
        assert report["provider_replays"] == 0
        assert report["gate"] == "ATTEMPT_LEDGER"
        assert report["reasons"] == ["DUPLICATE_CALL_SUPPRESSED"]
    assert all(report["real_calls_placed"] == 0 for report in reports)


def test_the_ledger_after_the_race_holds_one_settled_attempt(tmp_path):
    spawn_workers(tmp_path, WORKERS)
    ledger = SqliteAttemptLedger(tmp_path / "race-ledger.sqlite")

    rows = ledger.rows()
    assert len(rows) == 1
    row = rows[0]
    assert row["state"] == AttemptState.COMPLETED.value
    assert row["call_id"], "the winner's vendor call id was never persisted"


def test_the_audit_chain_after_the_race_has_one_reservation_and_verifies(tmp_path):
    spawn_workers(tmp_path, WORKERS)
    ledger = SqliteAttemptLedger(tmp_path / "race-ledger.sqlite")

    events = ledger.audit_events()
    reservations = [e for e in events if e.reason == "reserved"]
    assert len(reservations) == 1, "more than one process reserved the key"
    assert len([e for e in events if e.reason == "call_id_persisted"]) == 1
    assert len([e for e in events if e.reason == "provider_returned_terminal"]) == 1
    assert ledger.audit_problems() == []
    assert ledger.replay_projection() == {reservations[0].idempotency_key: "COMPLETED"}


def test_a_sequential_rerun_is_also_suppressed(tmp_path):
    spawn_workers(tmp_path, WORKERS)
    late = spawn_workers(tmp_path, 1)[0]
    assert late["refused"]
    assert late["gate"] == "ATTEMPT_LEDGER"
    assert late["reasons"] == ["DUPLICATE_CALL_SUPPRESSED"]
