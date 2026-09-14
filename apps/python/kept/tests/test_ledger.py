from __future__ import annotations

import json
from pathlib import Path

import pytest
from tests.conftest import at

from kept.ledger import Ledger, LedgerIntegrityError


def _ledger(tmp_path: Path) -> Ledger:
    ledger = Ledger(tmp_path / "ledger.jsonl")
    ledger.append(event_type="call_placed", payload={"invoice_id": "INV-1"}, at=at("2026-08-24"))
    ledger.append(event_type="call_placed", payload={"invoice_id": "INV-2"}, at=at("2026-08-25"))
    return ledger


def test_entries_chain_to_their_predecessor(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    entries = ledger.read()

    assert [entry.seq for entry in entries] == [1, 2]
    assert entries[1].prev == entries[0].hash
    ledger.verify()


def test_a_rewritten_payload_breaks_verification(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    lines = ledger.path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[0])
    tampered["payload"] = {"invoice_id": "INV-CHANGED"}
    lines[0] = json.dumps(tampered, sort_keys=True, separators=(",", ":"))
    ledger.path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    with pytest.raises(LedgerIntegrityError):
        Ledger(ledger.path).verify()


def test_a_removed_entry_breaks_verification(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    lines = ledger.path.read_text(encoding="utf-8").splitlines()
    ledger.path.write_text(lines[1] + "\n", encoding="utf-8")

    with pytest.raises(LedgerIntegrityError):
        Ledger(ledger.path).verify()


def test_reading_by_type_returns_only_that_type(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.append(event_type="promise_recorded", payload={"id": "PRM-1"}, at=at("2026-08-26"))

    assert [p["id"] for p in ledger.of_type("promise_recorded")] == ["PRM-1"]
    assert len(list(ledger.of_type("call_placed"))) == 2


def test_an_empty_ledger_reads_as_empty_rather_than_failing(tmp_path: Path) -> None:
    assert Ledger(tmp_path / "missing.jsonl").read() == []
