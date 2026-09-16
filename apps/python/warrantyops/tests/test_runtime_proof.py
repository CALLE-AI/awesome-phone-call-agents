"""The controlled runtime-proof pathway, proven with mocked clients only.

No test here constructs a network client, reads a real environment or
places anything. The canonical synthetic case is Maya at NorthStar
Equipment chasing fictional claim W-1042 against a role-playing BlueRock
Machinery desk that answers "installation photograph" and "BR-4821".
"""

from __future__ import annotations

import json
import socket
from datetime import date, datetime, timezone

import pytest
from test_calle_adapter import (
    FakeCalleAPIError,
    FakeCalleCalls,
    FakeCalleClient,
)

from warrantyops.ledger import SqliteAttemptLedger
from warrantyops.providers.calle_client import PollingConfig
from warrantyops.runtime_proof import (
    CONFIRMATION_PHRASE,
    execute_live_call,
    mask_call_id,
    preflight_report,
    probe_auth,
)

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 4)
PY311 = (3, 11, 15)
PY39 = (3, 9, 6)
RECIPIENT = "+12025550142"
API_KEY_PLACEHOLDER = "synthetic-not-a-real-key"
CALL_ID = "call_runtime_proof_synthetic_000000111111"

ENV = {
    "CALLE_API_KEY": API_KEY_PLACEHOLDER,
    "WARRANTYOPS_TEST_RECIPIENT_E164": RECIPIENT,
    "CALLE_LIVE_CALLS_ENABLED": "1",
    "CALLE_BASE_URL": "https://api.heycall-e.com",
    "WARRANTYOPS_ARTIFACT_DIR": "/tmp/warrantyops-artifacts",
}

TRANSCRIPT_TURNS = (
    ("bot", "I am an AI assistant calling for NorthStar Equipment. May I "
            "ask about warranty claim W-1042?"),
    ("user", "I have it here. It is showing returned in our system. The "
             "installation photograph is missing."),
    ("bot", "What do you need from us to move it forward?"),
    ("user", "It requires an installation photograph before we can rework "
             "the claim."),
    ("bot", "Does this have a reference on your side?"),
    ("user", "It is case BR-4821."),
    ("bot", "Just to confirm, that is case BR dash four eight two one, correct?"),
    ("user", "Correct, case BR-4821."),
)

TERMINAL_PAYLOAD = {
    "id": CALL_ID,
    "object": "call_task",
    "status": "completed",
    "recipients": [
        {
            "id": "rcp_runtime_1",
            "phones": [RECIPIENT],
            "locale": "en-US",
            "region": "US",
            "attempts": [
                {
                    "id": "att_runtime_1",
                    "phone": RECIPIENT,
                    "status": "completed",
                    "transcript_turns": [
                        {"offset_seconds": i, "speaker": speaker, "text": text}
                        for i, (speaker, text) in enumerate(TRANSCRIPT_TURNS)
                    ],
                    "failure_code": None,
                    "failure_message": None,
                }
            ],
        }
    ],
    "structured_result": {
        "claim_status": "STATED_RETURNED",
        "claim_status_evidence_quote": "It is showing returned in our system.",
        "stated_reason": "The installation photograph is missing.",
        "required_correction": "Requires an installation photograph",
        "required_documents": ["installation photograph"],
        "stated_deadline": None,
        "escalation_path": None,
        "stated_next_action": None,
        "reference_kind": "CASE",
        "reference_heard": "BR-4821",
        "reference_readback_performed": True,
        "reference_confirmed": "BR-4821",
        "reference_confirmation_quote": "Correct, case BR-4821.",
    },
    "failure_code": None,
    "failure_message": None,
}


class CountingFactory:
    """Builds fake SDK clients and counts how often one was constructed."""

    def __init__(self, calls: FakeCalleCalls) -> None:
        self._calls = calls
        self.clients: list[FakeCalleClient] = []

    def __call__(self) -> FakeCalleClient:
        client = FakeCalleClient(self._calls)
        self.clients.append(client)
        return client


def canonical_calls(events=None) -> FakeCalleCalls:
    return FakeCalleCalls(
        created={"id": CALL_ID},
        statuses=[TERMINAL_PAYLOAD],
        events=events if events is not None else [],
    )


def no_network(monkeypatch):  # mirror of test_dry_run's fixture
    def refuse(*args, **kwargs):
        raise AssertionError("the runtime pathway attempted to open a socket")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)


def preflight(tmp_path, env=ENV, **overrides):
    options = {
        "env": env,
        "ledger_db": tmp_path / "attempts.sqlite",
        "confirm_consenting_recipient": True,
        "confirm_phrase": CONFIRMATION_PHRASE,
        "python_version_info": PY311,
        "sdk_imports": True,
        "now": NOW,
        "on": ON,
    }
    options.update(overrides)
    return preflight_report(**options)


def execute(tmp_path, env=None, calls=None, **overrides):
    # The artifact directory is always a per-test temporary directory:
    # tests must never touch the real runtime artifact directory.
    safe_env = dict(env or ENV)
    safe_env["WARRANTYOPS_ARTIFACT_DIR"] = str(tmp_path / "artifacts")
    factory = CountingFactory(calls if calls is not None else canonical_calls())
    options = {
        "env": safe_env,
        "ledger_db": tmp_path / "attempts.sqlite",
        "confirm_consenting_recipient": True,
        "confirm_phrase": CONFIRMATION_PHRASE,
        "client_factory": factory,
        "polling": PollingConfig(
            deadline_seconds=10.0,
            interval_seconds=0.0,
            clock=lambda: 0.0,
            sleeper=lambda seconds: None,
        ),
        "python_version_info": PY311,
        "sdk_imports": True,
        "now": NOW,
        "on": ON,
    }
    options.update(overrides)
    return execute_live_call(**options), factory


# --- preflight ---------------------------------------------------------------


def test_preflight_passes_every_local_check_and_touches_no_network(
    tmp_path, monkeypatch
):
    no_network(monkeypatch)
    report = preflight(tmp_path)
    assert report["ok"] is True
    assert report["network_requests"] == 0
    assert report["calls_placed"] == 0
    failed = [c["name"] for c in report["checks"] if not c["ok"]]
    assert failed == []
    assert report["recipient"] != RECIPIENT  # masked only


def test_preflight_inspects_without_reserving_the_key(tmp_path):
    preflight(tmp_path)
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    assert ledger.rows() == []  # availability checked, nothing reserved


def test_preflight_with_a_missing_api_key_refuses_without_printing_a_value(tmp_path):
    env = dict(ENV)
    del env["CALLE_API_KEY"]
    report = preflight(tmp_path, env=env)
    names = [c["name"] for c in report["checks"] if not c["ok"]]
    assert "api_key_env_present" in names
    dumped = json.dumps(report)
    assert API_KEY_PLACEHOLDER not in dumped
    assert "CALLE_API_KEY" in dumped  # the name, never the value


def test_preflight_with_an_invalid_recipient_refuses_without_echoing_it(tmp_path):
    env = dict(ENV)
    env["WARRANTYOPS_TEST_RECIPIENT_E164"] = "call me maybe"
    report = preflight(tmp_path, env=env)
    names = [c["name"] for c in report["checks"] if not c["ok"]]
    assert "recipient_env_valid_e164" in names
    assert "authorization_bound_to_recipient" in names
    assert "call me maybe" not in json.dumps(report)


def test_preflight_with_a_missing_recipient_refuses(tmp_path):
    env = dict(ENV)
    del env["WARRANTYOPS_TEST_RECIPIENT_E164"]
    report = preflight(tmp_path, env=env)
    names = [c["name"] for c in report["checks"] if not c["ok"]]
    assert "recipient_env_valid_e164" in names


def test_preflight_refuses_a_ledger_inside_the_repository(tmp_path):
    from warrantyops.config import find_repository_root

    repo_root = find_repository_root()
    assert repo_root is not None
    report = preflight(
        tmp_path, ledger_db=repo_root / "apps" / "python" / "warrantyops" / "a.sqlite"
    )
    names = [c["name"] for c in report["checks"] if not c["ok"]]
    assert "ledger_path_explicit_and_outside_repository" in names


def test_preflight_reports_an_existing_reservation_without_creating_one(tmp_path):
    ledger_db = tmp_path / "attempts.sqlite"
    execute(tmp_path, ledger_db=ledger_db)
    report = preflight(tmp_path, ledger_db=ledger_db)
    check = next(
        c for c in report["checks"] if c["name"] == "no_existing_reservation"
    )
    assert check["ok"] is False
    assert "COMPLETED" in str(check["detail"])


# --- probe ---------------------------------------------------------------------


def test_the_probe_reads_a_nonexistent_call_and_never_creates_one():
    calls = FakeCalleCalls(
        created={"id": "never-created"},
        get_error=FakeCalleAPIError("not_found", "no such call", 404),
    )
    factory = CountingFactory(calls)
    report = probe_auth(
        env=ENV,
        client_factory=factory,
        python_version_info=PY311,
        sdk_imports=True,
    )
    assert report["outcome"] == "AUTHENTICATED_NOT_FOUND"
    assert report["http_status"] == 404
    assert report["calls_created"] == 0
    assert calls.create_count == 0


def test_the_probe_treats_an_authentication_error_as_a_refusal():
    calls = FakeCalleCalls(
        created={"id": "x"},
        get_error=FakeCalleAPIError("invalid_api_key", "bad key " + API_KEY_PLACEHOLDER, 401),
    )
    report = probe_auth(
        env=ENV,
        client_factory=CountingFactory(calls),
        python_version_info=PY311,
        sdk_imports=True,
    )
    assert report["refused"] is True
    assert report["reasons"] == ["AUTHENTICATION_REFUSED"]
    assert API_KEY_PLACEHOLDER not in json.dumps(report)


def test_the_probe_refuses_without_the_environment():
    report = probe_auth(env={}, python_version_info=PY311, sdk_imports=True)
    assert report["refused"] is True
    assert report["stage"] == "GATES"
    assert report["calls_created"] == 0


# --- execution gates -------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides, reason",
    [
        ({"confirm_consenting_recipient": False}, "MISSING_CONFIRM_CONSENTING_RECIPIENT_FLAG"),
        ({"confirm_phrase": "W1042-RUNTIME-PROOOOF"}, "CONFIRMATION_PHRASE_MISMATCH"),
        ({"confirm_phrase": None}, "CONFIRMATION_PHRASE_MISMATCH"),
        ({"ledger_db": None}, "MISSING_LEDGER_DB"),
        ({"python_version_info": PY39}, "python_311_plus"),
        ({"env": {**ENV, "CALLE_API_KEY": ""}}, "api_key_env_present"),
        (
            {"env": {**ENV, "WARRANTYOPS_TEST_RECIPIENT_E164": "202-555-0142"}},
            "recipient_env_valid_e164",
        ),
    ],
)
def test_live_execution_refuses_before_any_client_on_any_missing_requirement(
    tmp_path, overrides, reason
):
    report, factory = execute(tmp_path, **overrides)
    assert report["refused"] is True
    assert report["calls_placed"] == 0
    assert factory.clients == []  # not even a client was constructed
    if reason in report.get("reasons", []):
        assert reason in report["reasons"]
    else:
        names = [c["name"] for c in report["checks"] if not c["ok"]]
        assert reason in names


def test_live_execution_refuses_a_ledger_inside_the_repository(tmp_path):
    from warrantyops.config import find_repository_root

    repo_root = find_repository_root()
    report, factory = execute(
        tmp_path,
        ledger_db=repo_root / "apps" / "python" / "warrantyops" / "a.sqlite",
    )
    assert report["refused"] is True
    assert "LEDGER_PATH_INSIDE_REPOSITORY" in report["reasons"]
    assert factory.clients == []


# --- permitted execution ----------------------------------------------------------


def test_permitted_execution_creates_exactly_once_and_withholds_write_back(tmp_path):
    events: list[tuple] = []
    calls = canonical_calls(events)
    report, factory = execute(tmp_path, calls=calls)
    assert report["refused"] is False
    assert calls.create_count == 1
    assert len(factory.clients) == 1
    assert factory.clients[0].closed is True
    assert report["write_back"] == "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW"
    assert report["ledger_state"] == "COMPLETED"
    assert report["evidence_persistence"] == "SAVED"


def test_the_call_id_is_persisted_before_the_first_status_read(tmp_path):
    """The durable correlation survives the full runtime pathway.

    The strict create → attach → first-get ordering is pinned by
    ``test_calle_adapter.test_the_call_id_is_persisted_between_creation_and_
    the_first_status_read``; here the same callback runs end to end through
    ``run_exception`` and the row it wrote is what a reconciler would read.
    """
    events: list[tuple] = []
    calls = canonical_calls(events)
    report, _ = execute(tmp_path, calls=calls)
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    row = ledger.rows()[0]
    assert row["call_id"] == CALL_ID
    assert row["state"] == "COMPLETED"
    kinds = [event[0] for event in events]
    assert kinds[0] == "create"
    assert "get" in kinds


def test_a_duplicate_execution_is_suppressed_locally(tmp_path):
    ledger_db = tmp_path / "attempts.sqlite"
    first_calls = canonical_calls()
    second_calls = canonical_calls()
    first, _ = execute(tmp_path, ledger_db=ledger_db, calls=first_calls)
    second, _ = execute(tmp_path, ledger_db=ledger_db, calls=second_calls)
    assert first["refused"] is False
    assert second["refused"] is True
    assert second["stage"] == "WORKFLOW"
    assert second["reasons"] == ["DUPLICATE_CALL_SUPPRESSED"]
    assert first_calls.create_count + second_calls.create_count == 1
    assert second["write_back"] == "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW"


def test_the_receipt_masks_the_recipient_and_the_call_id(tmp_path):
    report, _ = execute(tmp_path)
    dumped = json.dumps(report)
    assert report["recipient"] == "+12*******42"
    assert RECIPIENT not in dumped
    assert report["call_id"] == mask_call_id(CALL_ID)
    assert CALL_ID not in dumped


def test_the_receipt_contains_no_key_and_no_full_transcript(tmp_path):
    report, _ = execute(tmp_path)
    dumped = json.dumps(report)
    assert API_KEY_PLACEHOLDER not in dumped
    for speaker, text in TRANSCRIPT_TURNS:
        if speaker == "bot":
            assert text not in dumped  # agent turns never appear
    # The single grounded counterparty quote is the evidence, not the transcript.
    quotes = [item["quote"] for item in report["evidence"]]
    assert "It is showing returned in our system." in quotes


def test_the_canonical_answer_produces_the_expected_maya_outcome(tmp_path):
    report, _ = execute(tmp_path)
    assert report["terminal_state"] == "INFORMATION_OBTAINED"
    assert report["claim_status"] == "STATED_RETURNED"
    assert any(
        "installation photograph" in item
        for item in report["missing_requirement"]
    )
    assert report["reference"] == {
        "normalized": "BR4821",
        "display": "BR-4821",
        "method": "DIRECT_COUNTERPARTY_QUOTE",
        "label": "CASE",
    }
    assert report["identifier_state"] == "CONFIRMED_IDENTIFIER"


# --- CLI surface --------------------------------------------------------------------


def test_the_cli_refuses_conflicting_modes(capsys):
    from warrantyops.cli import main

    code = main(["--preflight", "--probe-auth"])
    assert code == 2
    assert "refused" in capsys.readouterr().err


def test_mask_call_id_keeps_only_prefix_and_suffix():
    long_id = "call_" + "synthetic_abcdefghij"
    masked = mask_call_id(long_id)
    assert masked == long_id[:8] + "…" + long_id[-4:]
    assert long_id not in masked
    short_id = "call_" + "example"
    assert mask_call_id(short_id) == short_id[:4] + "…"
    assert mask_call_id(None) is None


# --- sdk presence, damaged ledgers, unexpected provider behaviour --------------


def test_the_sdk_presence_probe_reports_an_importable_module(monkeypatch):
    import sys
    import types

    monkeypatch.setitem(sys.modules, "calle", types.ModuleType("calle"))
    from warrantyops.runtime_proof import _sdk_imports

    assert _sdk_imports() is True


def test_the_probe_constructs_the_sdk_client_when_no_factory_is_given(monkeypatch):
    import sys
    import types

    calls = FakeCalleCalls(
        created={"id": "x"},
        get_error=FakeCalleAPIError("not_found", "no such call", 404),
    )
    constructed: list[bool] = []

    class FakeSdkClient:
        def __init__(self, *, api_key: str, base_url: str, timeout: float) -> None:
            constructed.append(bool(api_key))
            self.calls = calls

        def __enter__(self) -> FakeSdkClient:
            return self

        def __exit__(self, *exc) -> bool:
            return False

    module = types.ModuleType("calle")
    module.CalleClient = FakeSdkClient  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calle", module)

    report = probe_auth(env=ENV, python_version_info=PY311, sdk_imports=True)
    assert report["outcome"] == "AUTHENTICATED_NOT_FOUND"
    assert constructed == [True]  # the key reached the client, printed nowhere


def test_the_probe_refuses_an_error_it_does_not_model():
    calls = FakeCalleCalls(created={"id": "x"}, get_error=RuntimeError("socket hiccup"))
    report = probe_auth(
        env=ENV,
        client_factory=CountingFactory(calls),
        python_version_info=PY311,
        sdk_imports=True,
    )
    assert report["refused"] is True
    assert report["reasons"] == ["UNEXPECTED_RESPONSE"]
    assert report["error_class"] == "RuntimeError"
    assert report["http_status"] is None
    assert "socket hiccup" not in json.dumps(report)  # the message never echoes


def test_the_probe_refuses_a_success_answer_for_a_nonexistent_call():
    calls = FakeCalleCalls(created={"id": "x"}, statuses=[TERMINAL_PAYLOAD])
    report = probe_auth(
        env=ENV,
        client_factory=CountingFactory(calls),
        python_version_info=PY311,
        sdk_imports=True,
    )
    assert report["refused"] is True
    assert report["reasons"] == ["UNEXPECTED_RESPONSE"]
    assert report["calls_created"] == 0
    assert calls.create_count == 0


def test_an_unopenable_ledger_refuses_preflight_and_execution(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("a regular file where a directory was expected")
    doomed = blocker / "attempts.sqlite"

    inspected = preflight(tmp_path, ledger_db=doomed)
    names = [check["name"] for check in inspected["checks"] if not check["ok"]]
    assert "ledger_openable" in names

    report, factory = execute(tmp_path, ledger_db=doomed)
    assert report["refused"] is True
    assert report["calls_placed"] == 0
    assert factory.clients == []


def test_an_unexpected_runtime_failure_refuses_and_records_the_attempt(tmp_path):
    class ExplodingCalls(FakeCalleCalls):
        def create(self, **kwargs):
            raise RuntimeError("synthetic provider failure")

    report, factory = execute(tmp_path, calls=ExplodingCalls(created={"id": "x"}))
    assert report["refused"] is True
    assert factory.clients  # a client existed; the refusal came after it
    # The durable reservation survives as UNKNOWN: the retry stays suppressed
    # and a human reconciles, which is the whole point of the state.
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    row = ledger.rows()[0]
    assert row["state"] == "UNKNOWN"


def test_a_missing_artifact_directory_is_reported_not_raised():
    from warrantyops.runtime_proof import _persist_receipt

    report = _persist_receipt({"mode": "execute-live-call"}, None)
    assert report["evidence_persistence"] == "FAILED"
    assert report["receipt_error"] == "no artifact directory configured"


def test_a_run_without_a_confirmed_reference_renders_no_reference(tmp_path):
    import copy

    payload = copy.deepcopy(TERMINAL_PAYLOAD)
    payload["structured_result"].update(
        {
            "reference_kind": "UNKNOWN",
            "reference_heard": None,
            "reference_readback_performed": False,
            "reference_confirmed": None,
            "reference_confirmation_quote": None,
        }
    )
    calls = FakeCalleCalls(created={"id": CALL_ID}, statuses=[payload])
    report, _ = execute(tmp_path, calls=calls)
    assert report["refused"] is False
    # No confirmed reference means no reference presentation: the key renders
    # null and the identifier is absent, never an unconfirmed candidate shown
    # as if it were confirmed.
    assert report["reference"] is None
    assert report["identifier_state"] == "ABSENT"


def test_an_unset_kill_switch_refuses_before_reserving_the_key(tmp_path):
    """The switch is an entry gate, not only the provider seam.

    Without this, a switch-off run would pass the shared gates (key present,
    recipient valid), reserve the idempotency key, and only then discover
    LIVE_NOT_ENABLED at the provider — leaving an UNKNOWN reservation behind
    for a call that was never allowed to exist.
    """

    dead_env = dict(ENV)
    del dead_env["CALLE_LIVE_CALLS_ENABLED"]
    report, factory = execute(tmp_path, env=dead_env)
    assert report["refused"] is True
    assert report["stage"] == "REQUIREMENTS"
    assert "LIVE_NOT_ENABLED" in report["reasons"]
    assert report["calls_placed"] == 0
    assert factory.clients == []
    # The reservation was never made: the ledger is empty, so the operator
    # fixes the configuration and re-runs without a burned key.
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    assert ledger.rows() == []
