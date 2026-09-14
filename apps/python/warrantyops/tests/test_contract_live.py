"""The GET-only live contract check: one read, no create path, ever.

``--contract-live`` is the bridge between the offline suite and the live
platform: env-gated like every live path, it performs exactly one
``calls.get`` (the deterministic known-nonexistent id by default, a recorded
id via ``WARRANTYOPS_CONTRACT_CALL_ID``) and reports the payload's structural
agreement with the adapter's contract. These tests pin the three properties
that make it safe to exist: it refuses offline before constructing any
client, the only SDK method it can reach is ``get``, and its public report
carries a masked call id only.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from test_calle_adapter import FakeCalleAPIError
from test_runtime_proof import ENV, PY311, TERMINAL_PAYLOAD

from warrantyops.runtime_proof import (
    CONTRACT_CALL_ID_ENV,
    PROBE_CALL_ID,
    contract_live_check,
    mask_call_id,
)

RECORDED_ID = "call_synthetic_contract_recorded_0000042"


class NoCreateCalls:
    """A calls namespace whose only method is ``get``.

    ``create`` does not exist at all, so reaching for it raises
    ``AttributeError`` — a stronger structural proof than a stub that
    raises: the contract check cannot even name a create path.
    """

    def __init__(
        self,
        payload: Any = None,
        get_error: Optional[Exception] = None,
        seen: Optional[list[str]] = None,
    ) -> None:
        self._payload = payload
        self._get_error = get_error
        self._seen = seen


class Client:
    """The minimal SDK shape the check touches: ``with … as c: c.calls.get``."""

    def __init__(self, calls: NoCreateCalls) -> None:
        self.calls = calls

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *args: Any) -> None:
        return None


def no_create_factory(
    payload: Any = None,
    get_error: Optional[Exception] = None,
    seen: Optional[list[str]] = None,
) -> Callable[[], Client]:
    class RecordingCalls(NoCreateCalls):
        def get(self, call_id: str):
            if self._seen is not None:
                self._seen.append(call_id)
            if self._get_error is not None:
                raise self._get_error
            return self._payload

    client = Client(RecordingCalls(payload, get_error, seen))
    return lambda: client


def check(factory, env=ENV, **overrides):
    options = {
        "env": env,
        "client_factory": factory,
        "python_version_info": PY311,
        "sdk_imports": True,
    }
    options.update(overrides)
    return contract_live_check(**options)


# --- gates --------------------------------------------------------------------


def test_the_check_refuses_offline_before_constructing_any_client():
    def factory():
        raise AssertionError("no client may be constructed offline")

    report = check(factory, env={**ENV, "CALLE_API_KEY": ""})
    assert report["refused"] is True
    assert report["stage"] == "GATES"
    assert report["calls_created"] == 0


def test_the_check_needs_no_recipient_environment():
    """A contract read has no called party; the recipient gate is dropped."""

    env = {
        key: value
        for key, value in ENV.items()
        if key != "WARRANTYOPS_TEST_RECIPIENT_E164"
    }
    report = check(no_create_factory(TERMINAL_PAYLOAD), env=env)
    assert report["refused"] is False
    assert report["outcome"] == "READ"


def test_an_unofficial_origin_is_not_a_contract_check():
    report = check(
        no_create_factory(TERMINAL_PAYLOAD),
        env={**ENV, "CALLE_BASE_URL": "https://api.lookalike.example"},
    )
    assert report["refused"] is True
    # The origin refusal fails twice by design: once inside the shared
    # live-config gate, once in the dedicated origin check.
    failed = [c["name"] for c in report["checks"] if not c["ok"]]
    assert failed == ["live_config_gates", "official_origin"]


def test_an_unset_kill_switch_refuses_without_a_client():
    dead_env = dict(ENV)
    del dead_env["CALLE_LIVE_CALLS_ENABLED"]

    def factory():
        raise AssertionError("no client may be constructed when disabled")

    report = check(factory, env=dead_env)
    assert report["refused"] is True
    assert "live_config_gates" in [c["name"] for c in report["checks"] if not c["ok"]]


# --- the read -----------------------------------------------------------------


def test_the_default_probe_id_reads_one_authenticated_not_found():
    seen: list[str] = []
    report = check(
        no_create_factory(
            get_error=FakeCalleAPIError("not_found", "no such call", 404), seen=seen
        )
    )
    assert report["refused"] is False
    assert report["outcome"] == "AUTHENTICATED_NOT_FOUND"
    assert report["http_status"] == 404
    assert report["calls_created"] == 0
    assert seen == [PROBE_CALL_ID]  # exactly one read, of the probe id
    assert report["shape_checks"][0]["name"] == "shape_not_checked"
    assert CONTRACT_CALL_ID_ENV in report["shape_checks"][0]["detail"]
    # Even the nonexistent probe id is masked like any other, out of habit.
    assert report["call_id"] == mask_call_id(PROBE_CALL_ID)


def test_a_recorded_call_id_is_read_from_the_environment():
    seen: list[str] = []
    report = check(
        no_create_factory(TERMINAL_PAYLOAD, seen=seen),
        env={**ENV, CONTRACT_CALL_ID_ENV: RECORDED_ID},
    )
    assert report["refused"] is False
    assert report["outcome"] == "READ"
    assert seen == [RECORDED_ID]
    assert report["call_id"] == mask_call_id(RECORDED_ID)


def test_an_explicit_call_id_argument_wins_over_the_environment():
    seen: list[str] = []
    explicit = "call_synthetic_contract_explicit_0000043"
    check(
        no_create_factory(TERMINAL_PAYLOAD, seen=seen),
        env={**ENV, CONTRACT_CALL_ID_ENV: RECORDED_ID},
        call_id=explicit,
    )
    assert seen == [explicit]


def test_the_canonical_payload_passes_every_shape_check():
    report = check(no_create_factory(TERMINAL_PAYLOAD))
    assert report["refused"] is False
    assert report["outcome"] == "READ"
    assert report["shape_ok"] is True
    assert [c["name"] for c in report["shape_checks"]] == [
        "object_is_call_task",
        "status_documented",
        "recipients_listed",
        "transcript_turns_labeled",
        "structured_result_key_present",
    ]


def test_a_shape_drift_is_named_not_swallowed():
    drifted = {
        "object": "goal_run_synthetic",  # a GoalRun, not a call task
        "status": "teleported",  # not documented
        "recipients": [],  # nobody
        # structured_result stays absent below; a present-but-null value is
        # covered separately (presence is what this check reads).
    }
    report = check(no_create_factory(drifted))
    assert report["refused"] is False  # the read succeeded; the shape says no
    assert report["shape_ok"] is False
    failed = {c["name"] for c in report["shape_checks"] if c["ok"] is False}
    assert failed == {
        "object_is_call_task",
        "status_documented",
        "recipients_listed",
        "transcript_turns_labeled",
        "structured_result_key_present",
    }


def test_an_undocumented_speaker_vocabulary_fails_the_shape():
    payload = {
        "object": "call_task",
        "status": "completed",
        "recipients": [
            {
                "attempts": [
                    {
                        "transcript_turns": [
                            {"speaker": "agent", "text": "hello"},
                            {"speaker": "human", "text": "returned"},
                        ]
                    }
                ]
            }
        ],
        "structured_result": {"claim_status": "STATED_RETURNED"},
    }
    report = check(no_create_factory(payload))
    assert report["shape_ok"] is False
    shape = next(
        c for c in report["shape_checks"] if c["name"] == "transcript_turns_labeled"
    )
    assert shape["ok"] is False
    assert "agent" in shape["detail"]


def test_an_authentication_error_refuses_the_check():
    report = check(
        no_create_factory(get_error=FakeCalleAPIError("forbidden", "bad key", 403))
    )
    assert report["refused"] is True
    assert report["reasons"] == ["AUTHENTICATION_REFUSED"]


# --- the CLI surface ----------------------------------------------------------


def test_the_cli_mode_refuses_hermetically(monkeypatch, capsys):
    from warrantyops.cli import main

    for name in (
        "CALLE_API_KEY",
        "CALLE_LIVE_CALLS_ENABLED",
        "WARRANTYOPS_TEST_RECIPIENT_E164",
        CONTRACT_CALL_ID_ENV,
    ):
        monkeypatch.delenv(name, raising=False)
    code = main(["--contract-live"])
    assert code == 1
    report = json.loads(capsys.readouterr().out)
    assert report["refused"] is True
    assert report["calls_created"] == 0


def test_the_cli_mode_conflicts_with_every_other_mode(monkeypatch):
    from warrantyops.cli import main

    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    assert main(["--contract-live", "--verify-docs"]) == 2
