import os
import tempfile

from mobilize.core.ledger import Ledger


def test_record_and_replay():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "ledger.jsonl")
        ledger = Ledger(path)
        ledger.record_dispatch("mob_1", "c1", "call_1")
        ledger.record_dispatch("mob_1", "c2", "call_2")
        ledger.record_result("mob_1", "c1", "call_1", {"outcome": "firm_yes"})

        assert ledger.already_dispatched("mob_1", "c1") == "call_1"
        assert ledger.already_dispatched("mob_1", "c3") is None

        in_flight = ledger.in_flight("mob_1")
        assert in_flight == {"c2": "call_2"}

        results = ledger.completed_results("mob_1")
        assert len(results) == 1
        assert results[0]["outcome"] == "firm_yes"


def test_idempotency_key_stable():
    with tempfile.TemporaryDirectory() as tmp:
        ledger = Ledger(os.path.join(tmp, "l.jsonl"))
        k1 = ledger.idempotency_key("mob_a", "cand_1")
        k2 = ledger.idempotency_key("mob_a", "cand_1")
        assert k1 == k2
        assert ledger.idempotency_key("mob_a", "cand_2") != k1


def test_replay_isolates_by_mobilization_id():
    with tempfile.TemporaryDirectory() as tmp:
        ledger = Ledger(os.path.join(tmp, "l.jsonl"))
        ledger.record_dispatch("mob_1", "c1", "call_1")
        ledger.record_dispatch("mob_2", "c1", "call_99")

        assert ledger.already_dispatched("mob_1", "c1") == "call_1"
        assert ledger.already_dispatched("mob_2", "c1") == "call_99"


def test_crash_recovery_no_duplicate_dispatch_after_restart():
    """Simulates a process crash: ledger is reopened fresh (new Ledger
    instance, same file) mid-mobilization, and the caller must be able to
    tell which candidates were already dispatched without re-dialing them."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "l.jsonl")
        ledger_before_crash = Ledger(path)
        for i in range(5):
            ledger_before_crash.record_dispatch("mob_x", f"c{i}", f"call_{i}")
        ledger_before_crash.record_result("mob_x", "c0", "call_0", {"outcome": "firm_yes"})
        ledger_before_crash.record_result("mob_x", "c1", "call_1", {"outcome": "no"})
        # c2, c3, c4 dispatched but never got a result before the crash.

        ledger_after_restart = Ledger(path)
        in_flight = ledger_after_restart.in_flight("mob_x")
        assert set(in_flight.keys()) == {"c2", "c3", "c4"}

        for i in range(5):
            assert ledger_after_restart.already_dispatched("mob_x", f"c{i}") == f"call_{i}"

        results = ledger_after_restart.completed_results("mob_x")
        assert len(results) == 2
