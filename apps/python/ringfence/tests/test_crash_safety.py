"""End-to-end crash-safety: CaseStore backed by CaseLedger, exercised
through the real webhook handlers -- not just the ledger in isolation
(see test_ledger.py for that).
"""

from pathlib import Path

from ringfence.ledger import CaseLedger
from ringfence.verify_call import PREVIEWED, SecurityEventLog
from ringfence.webhook import CaseStore, handle_get, handle_submit

_ON_FILE = "+14155550101"


def _case_payload(**overrides) -> dict:
    payload = dict(
        case_id="case_crash_001",
        account_holder_name="Pat Rivera",
        on_file_phone=_ON_FILE,
        claimed_transaction_amount="4500.00",
        claimed_recipient="Jordan Rivera",
        claimed_payment_method="wire",
        request_supplied_callback_number=None,
    )
    payload.update(overrides)
    return payload


class _FakeCalls:
    def __init__(self):
        self.create_and_wait_calls = 0

    def create_and_wait(self, **kwargs):
        self.create_and_wait_calls += 1
        return {"id": f"call_fake_{self.create_and_wait_calls}"}

    def get(self, call_id: str):
        return {
            "id": call_id, "status": "completed", "task_completed": True,
            "structured_result": {
                "secrecy_demand_present": False, "urgency_pressure_present": False,
                "relationship_explained": True, "irreversible_payment_demanded": False,
                "explicit_hold_requested": False,
            },
            "recipients": [{"attempts": [{
                "started_at": "2026-09-10T00:00:00Z", "completed_at": "2026-09-10T00:01:00Z",
                "transcript_turns": [{"speaker": "bot", "text": "hi"}],
            }]}],
        }

    def list_events(self, call_id: str):
        return {"data": []}


class _FakeClient:
    def __init__(self):
        self.calls = _FakeCalls()


def test_dry_run_case_survives_a_simulated_process_restart(tmp_path: Path):
    ledger_path = tmp_path / "ledger.jsonl"
    security_log = SecurityEventLog(tmp_path / "security_events.jsonl")

    store_before_restart = CaseStore(CaseLedger(ledger_path))
    status, payload = handle_submit(
        store_before_restart, _case_payload(), live=False, security_log=security_log, client_factory=None
    )
    assert status == 201
    assert payload["status"] == PREVIEWED

    # Simulate a restart: a brand new CaseStore/process, same ledger file on disk.
    store_after_restart = CaseStore(CaseLedger(ledger_path))
    status, fetched = handle_get(store_after_restart, "case_crash_001")
    assert status == 200
    assert fetched["case_id"] == "case_crash_001"
    assert fetched["status"] == PREVIEWED


def test_a_case_already_dialed_before_a_restart_is_never_redialed_after(tmp_path: Path):
    ledger_path = tmp_path / "ledger.jsonl"
    security_log = SecurityEventLog(tmp_path / "security_events.jsonl")
    fake_client = _FakeClient()

    store_before_restart = CaseStore(CaseLedger(ledger_path))
    status1, payload1 = handle_submit(
        store_before_restart, _case_payload(), live=True, security_log=security_log,
        client_factory=lambda: fake_client,
    )
    assert status1 == 201
    assert payload1["disposition"] == "ADVISE_ALLOW"
    assert fake_client.calls.create_and_wait_calls == 1

    class _ClientThatMustNotBeCalledAgain:
        class _Calls:
            def create_and_wait(self, **kwargs):
                raise AssertionError("a case already resolved before the restart must never be re-dialed")

        calls = _Calls()

    # Simulate a restart with a fresh, empty in-memory store -- only the
    # ledger on disk carries the fact that this case was already handled.
    store_after_restart = CaseStore(CaseLedger(ledger_path))
    status2, payload2 = handle_submit(
        store_after_restart, _case_payload(), live=True, security_log=security_log,
        client_factory=lambda: _ClientThatMustNotBeCalledAgain(),
    )
    assert status2 == 200  # returned the existing, ledger-restored record
    assert payload2["disposition"] == "ADVISE_ALLOW"
    assert payload2["call_id"] == payload1["call_id"]


def test_a_crash_mid_write_loses_at_most_the_single_in_flight_write(tmp_path: Path):
    ledger_path = tmp_path / "ledger.jsonl"
    security_log = SecurityEventLog(tmp_path / "security_events.jsonl")

    store = CaseStore(CaseLedger(ledger_path))
    handle_submit(store, _case_payload(case_id="case_a"), live=False, security_log=security_log, client_factory=None)
    handle_submit(store, _case_payload(case_id="case_b"), live=False, security_log=security_log, client_factory=None)

    # Simulate the process dying mid-append while starting a third case.
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write('{"event": "create", "case_id": "case_c", "record": {"case_id": "case_c", "stat')

    recovered_store = CaseStore(CaseLedger(ledger_path))
    _, case_a = handle_get(recovered_store, "case_a")
    _, case_b = handle_get(recovered_store, "case_b")
    status_c, _ = handle_get(recovered_store, "case_c")

    assert case_a["case_id"] == "case_a"
    assert case_b["case_id"] == "case_b"
    assert status_c == 404  # the truncated write for case_c never committed -- correctly absent, not corrupted
