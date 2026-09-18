"""The live adapter against the shapes of the installed calle-ai 0.7.0 SDK.

No network, no SDK import: the fakes below mirror exactly what the SDK
source does (verified in the isolated live environment, not inferred from
prose): ``calls.create`` and ``calls.get`` return plain dicts, the client is
a context manager, statuses are ``queued|in_progress|completed|failed|
canceled``, transcript turns carry ``speaker`` of ``bot|user|unknown`` and
errors carry ``code``/``status_code`` attributes.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import pytest

from warrantyops.authorization import AuthorizationBasis, AuthorizationDecision, CallAuthorization
from warrantyops.config import RuntimeConfig
from warrantyops.envelope import source_claim_from_dict
from warrantyops.outcome import TerminalState, TransportState
from warrantyops.providers.base import (
    CallRequest,
    RecipientRoutingError,
    recipient_routing,
)
from warrantyops.providers.calle_client import (
    CallCreationIncomplete,
    CalleCallProvider,
    LiveCallRefused,
    PollingConfig,
    attempt_transcript,
)
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"
RECIPIENT = "+12025550142"
API_KEY_PLACEHOLDER = "synthetic-not-a-real-key"
TASK_TEXT = "synthetic task for the adapter audit"

CONFIG = RuntimeConfig(
    dry_run=False,
    base_url="https://api.heycall-e.com",
    idempotency_namespace="warrantyops",
    api_key=API_KEY_PLACEHOLDER,
    artifact_dir=Path("/tmp/warrantyops-artifacts"),
)
ALLOWED = AuthorizationDecision(allowed=True, refusals=())


class FakeCalleAPIError(Exception):
    """Mirrors calle.errors.CalleAPIError attributes."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class FakeCalleConnectionError(Exception):
    """Mirrors calle.errors.CalleConnectionError (no code/status)."""


class FakeCalleCalls:
    """Mirror of calle.calls.CalleCalls create/get against scripted state."""

    def __init__(
        self,
        created: dict,
        statuses: Optional[list] = None,
        events: Optional[list] = None,
        get_error: Optional[Exception] = None,
    ) -> None:
        self.created = created
        self.statuses = list(statuses or [])
        self.default_status = "queued"
        self.events = events if events is not None else []
        self.create_count = 0
        self.get_error = get_error

    def create(self, *, task, recipients=None, result_schema=None,
               metadata=None, idempotency_key=None, **kwargs) -> dict:
        self.events.append(("create", idempotency_key))
        self.create_count += 1
        return self.created

    def get(self, call_id: str) -> dict:
        self.events.append(("get", call_id))
        if self.get_error is not None:
            raise self.get_error
        if self.statuses:
            return self.statuses.pop(0)
        return call_task(self.default_status)


class FakeCalleClient:
    """Mirror of CalleClient: namespace plus context-manager lifecycle."""

    def __init__(self, calls: FakeCalleCalls) -> None:
        self.calls = calls
        self.closed = False

    def __enter__(self) -> FakeCalleClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.closed = True


def call_task(
    status: str,
    call_id: str = "call_synthetic_sdk_1",
    structured_result: Any = None,
    failure_code: Optional[str] = None,
    failure_message: Optional[str] = None,
    turns: tuple = (
        ("bot", "May I ask about warranty claim CLM-1042?"),
        ("user", "It is showing returned in our system."),
        ("unknown", ""),
    ),
) -> dict:
    """A CallTask dict shaped exactly like SDK 0.7.0's verified model."""

    return {
        "id": call_id,
        "object": "call_task",
        "status": status,
        "task": TASK_TEXT,
        "recipients": [
            {
                "id": "rcp_synthetic_1",
                "phones": [RECIPIENT],
                "locale": "en-US",
                "region": "US",
                "attempts": [
                    {
                        "id": "att_synthetic_1",
                        "phone": RECIPIENT,
                        "status": status,
                        "transcript_turns": [
                            {"offset_seconds": index, "speaker": speaker, "text": text}
                            for index, (speaker, text) in enumerate(turns)
                        ],
                        "failure_code": None,
                        "failure_message": None,
                    }
                ],
            }
        ],
        "structured_result": structured_result,
        "failure_code": failure_code,
        "failure_message": failure_message,
    }


def provider_with(
    calls: FakeCalleCalls,
    *,
    deadline: float = 600.0,
    clock=None,
) -> CalleCallProvider:
    return CalleCallProvider(
        config=CONFIG,
        authorization=ALLOWED,
        polling=PollingConfig(
            deadline_seconds=deadline,
            interval_seconds=0.0,
            clock=clock or (lambda: 0.0),
            sleeper=lambda seconds: None,
        ),
        client_factory=lambda: FakeCalleClient(calls),
    )


def request_for(key: str = "warrantyops:adapter-audit") -> CallRequest:
    region, locale = recipient_routing(RECIPIENT)
    return CallRequest(
        task=TASK_TEXT,
        recipient_e164=RECIPIENT,
        result_schema={"type": "object"},
        idempotency_key=key,
        metadata={"app": "warrantyops"},
        locale=locale,
        region=region,
    )


def test_an_indian_recipient_never_inherits_us_routing_metadata():
    request = CallRequest(
        task=TASK_TEXT,
        recipient_e164="+911234567890",
        result_schema={"type": "object"},
        idempotency_key="warrantyops:adapter-audit-india",
        metadata={"app": "warrantyops"},
        locale="en-IN",
        region="IN",
    )
    assert (request.region, request.locale) == ("IN", "en-IN")


def test_mismatched_recipient_routing_refuses_before_the_provider():
    with pytest.raises(RecipientRoutingError, match="expected region=US"):
        CallRequest(
            task=TASK_TEXT,
            recipient_e164=RECIPIENT,
            result_schema={"type": "object"},
            idempotency_key="warrantyops:adapter-audit-mismatch",
            metadata={"app": "warrantyops"},
            locale="en-IN",
            region="IN",
        )


def test_an_unmapped_calling_code_refuses_instead_of_defaulting_to_us():
    with pytest.raises(RecipientRoutingError, match="outside the explicit"):
        recipient_routing("+99912345678")


# --- ordering and shapes -----------------------------------------------------


def test_the_call_id_is_persisted_between_creation_and_the_first_status_read():
    events: list[tuple] = []
    calls = FakeCalleCalls(
        created={"id": "call_synthetic_sdk_1"},
        statuses=[call_task("queued"), call_task("completed")],
        events=events,
    )
    attached: list[str] = []

    def record(call_id: str) -> None:
        attached.append(call_id)
        events.append(("attach", call_id))

    provider_with(calls).place_call(request_for(), on_call_created=record)
    create_at = events.index(("create", "warrantyops:adapter-audit"))
    attach_at = events.index(("attach", "call_synthetic_sdk_1"))
    first_get_at = events.index(("get", "call_synthetic_sdk_1"))
    assert create_at < attach_at < first_get_at


def test_the_workflow_persists_the_call_id_in_the_ledger(tmp_path):
    from warrantyops.ledger import SqliteAttemptLedger

    claim = source_claim_from_dict(
        FakeCallProvider(scenario="case_a_useful_resolution", fixture_dir=FIXTURE_DIR)
        .load()["envelope"]
    )
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    # The adapter declares live capability, so the workflow demands a
    # durable ledger — exactly the pairing rule under test here.
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    calls = FakeCalleCalls(
        created={"id": "call_synthetic_sdk_9"},
        statuses=[call_task("completed", call_id="call_synthetic_sdk_9")],
    )
    authorization = CallAuthorization(
        recipient_e164=claim.counterparty_phone_e164,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="audit",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )
    run = run_exception(
        claim,
        authorization,
        provider_with(calls),
        version_reader=store,
        attempt_ledger=ledger,
        now=NOW,
        on=ON,
    )
    assert run.refusal is None
    rows = ledger.rows()
    assert rows[0]["call_id"] == "call_synthetic_sdk_9"
    assert rows[0]["state"] == "COMPLETED"


def test_create_and_get_return_plain_dicts_and_are_handled_as_such():
    calls = FakeCalleCalls(
        created={"id": "call_synthetic_sdk_1"},
        statuses=[call_task("completed")],
    )
    result = provider_with(calls).place_call(request_for())
    assert result.transport.call_id == "call_synthetic_sdk_1"
    assert result.transport.state is TransportState.COMPLETED


# --- polling ------------------------------------------------------------------


def test_polling_walks_queued_then_in_progress_to_completed():
    statuses = [call_task("queued"), call_task("in_progress"), call_task("completed")]
    calls = FakeCalleCalls(created={"id": "c1"}, statuses=statuses)
    result = provider_with(calls).place_call(request_for())
    assert result.transport.state is TransportState.COMPLETED
    gets = [event for event in calls.events if event[0] == "get"]
    assert len(gets) == 3
    assert calls.create_count == 1


def test_failed_and_canceled_terminal_results_map_through():
    failed = FakeCalleCalls(
        created={"id": "c1"},
        statuses=[call_task("failed", failure_code="anything_at_all")],
    )
    canceled = FakeCalleCalls(
        created={"id": "c2"}, statuses=[call_task("canceled")]
    )
    assert provider_with(failed).place_call(request_for()).transport.state is TransportState.FAILED
    assert (
        provider_with(canceled).place_call(request_for()).transport.state
        is TransportState.CANCELED
    )


# --- unsafe creation shapes ----------------------------------------------------


@pytest.mark.parametrize("created", [{}, {"id": "   "}, {"id": None}, {"object": "call_task"}])
def test_a_missing_or_malformed_creation_id_fails_clearly(created):
    calls = FakeCalleCalls(created=created)
    with pytest.raises(CallCreationIncomplete):
        provider_with(calls).place_call(request_for())
    assert not [event for event in calls.events if event[0] == "get"]
    assert calls.create_count == 1


def test_a_creation_api_error_is_wrapped_with_safe_diagnostics():
    calls = FakeCalleCalls(created={"id": "c1"})
    calls.create = lambda **kwargs: (_ for _ in ()).throw(
        FakeCalleAPIError("invalid_phone", "phones[0] +14155550199 is invalid", 400)
    )
    with pytest.raises(CallCreationIncomplete) as caught:
        provider_with(calls).place_call(request_for())
    assert "+14155550199" not in str(caught.value)


# --- uncertainty ----------------------------------------------------------------


def test_a_wall_clock_deadline_produces_an_unknown_attempt():
    calls = FakeCalleCalls(created={"id": "c1"})  # never leaves "queued"
    ticking = {"now": 0.0}

    def clock() -> float:
        ticking["now"] += 100.0
        return ticking["now"]

    result = provider_with(calls, deadline=150.0, clock=clock).place_call(request_for())
    assert result.transport.state is TransportState.IN_PROGRESS
    assert result.transport.diagnostic_failure_code == "wait_deadline_exceeded"
    assert "reconciliation" in result.transport.diagnostic_failure_message


def test_a_status_read_failure_produces_safe_diagnostics_and_uncertainty():
    calls = FakeCalleCalls(
        created={"id": "c1"},
        get_error=FakeCalleAPIError("rate_limited", "echoes +12025550142 maybe", 429),
    )
    result = provider_with(calls).place_call(request_for())
    assert result.transport.state is TransportState.IN_PROGRESS
    assert result.transport.diagnostic_failure_code == "FakeCalleAPIError:rate_limited"
    assert "[http 429]" in result.transport.diagnostic_failure_message
    assert RECIPIENT not in result.transport.diagnostic_failure_message


def test_a_connection_failure_without_code_still_diagnoses_safely():
    calls = FakeCalleCalls(created={"id": "c1"}, get_error=FakeCalleConnectionError())
    result = provider_with(calls).place_call(request_for())
    assert result.transport.diagnostic_failure_code == "FakeCalleConnectionError"
    assert result.transport.state is TransportState.IN_PROGRESS


def test_create_is_invoked_exactly_once_even_when_waiting_fails():
    calls = FakeCalleCalls(created={"id": "c1"})
    ticking = {"now": 0.0}

    def clock() -> float:
        ticking["now"] += 1000.0
        return ticking["now"]

    provider_with(calls, deadline=10.0, clock=clock).place_call(request_for())
    assert calls.create_count == 1


def _workflow_audit(tmp_path, calls, *, deadline=600.0, clock=None):
    from warrantyops.ledger import SqliteAttemptLedger

    claim = source_claim_from_dict(
        FakeCallProvider(scenario="case_a_useful_resolution", fixture_dir=FIXTURE_DIR)
        .load()["envelope"]
    )
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    authorization = CallAuthorization(
        recipient_e164=claim.counterparty_phone_e164,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="audit",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )
    run = run_exception(
        claim,
        authorization,
        provider_with(calls, deadline=deadline, clock=clock),
        version_reader=store,
        attempt_ledger=ledger,
        now=NOW,
        on=ON,
    )
    return run, ledger


def test_a_deadline_exhausted_attempt_is_marked_unknown_in_the_ledger(tmp_path):
    ticking = {"now": 0.0}

    def clock() -> float:
        ticking["now"] += 1000.0
        return ticking["now"]

    run, ledger = _workflow_audit(
        tmp_path, FakeCalleCalls(created={"id": "c1"}), deadline=10.0, clock=clock
    )
    assert run.refusal is None
    assert run.outcome.terminal_state is TerminalState.IN_FLIGHT
    assert ledger.rows()[0]["state"] == "UNKNOWN"


def test_a_status_read_error_attempt_is_marked_unknown_in_the_ledger(tmp_path):
    calls = FakeCalleCalls(
        created={"id": "c1"},
        get_error=FakeCalleAPIError("internal_error", "boom", 500),
    )
    run, ledger = _workflow_audit(tmp_path, calls)
    assert run.refusal is None
    assert run.outcome.terminal_state is TerminalState.IN_FLIGHT
    assert ledger.rows()[0]["state"] == "UNKNOWN"


def test_a_subsequent_execution_is_suppressed_locally(tmp_path):
    from warrantyops.ledger import SqliteAttemptLedger

    claim = source_claim_from_dict(
        FakeCallProvider(scenario="case_a_useful_resolution", fixture_dir=FIXTURE_DIR)
        .load()["envelope"]
    )
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    first_calls = FakeCalleCalls(
        created={"id": "c1"}, statuses=[call_task("completed")]
    )
    second_calls = FakeCalleCalls(created={"id": "c2"})
    authorization = CallAuthorization(
        recipient_e164=claim.counterparty_phone_e164,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="audit",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )
    first = run_exception(
        claim, authorization, provider_with(first_calls),
        version_reader=store, attempt_ledger=ledger, now=NOW, on=ON,
    )
    second = run_exception(
        claim, authorization, provider_with(second_calls),
        version_reader=store, attempt_ledger=ledger, now=NOW, on=ON,
    )
    assert first.refusal is None
    assert first_calls.create_count + second_calls.create_count == 1
    assert second.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)


# --- lifecycle and extraction -----------------------------------------------------


def test_the_client_context_manager_closes_after_every_call():
    calls = FakeCalleCalls(created={"id": "c1"}, statuses=[call_task("completed")])
    clients = []

    def factory() -> FakeCalleClient:
        client = FakeCalleClient(calls)
        clients.append(client)
        return client

    CalleCallProvider(
        config=CONFIG,
        authorization=ALLOWED,
        polling=PollingConfig(
            deadline_seconds=600.0,
            interval_seconds=0.0,
            clock=lambda: 0.0,
            sleeper=lambda seconds: None,
        ),
        client_factory=factory,
    ).place_call(request_for())
    assert clients and all(client.closed for client in clients)


def test_structured_result_and_transcript_extraction_match_the_sdk_shapes():
    structured = {"claim_status": "STATED_RETURNED", "reference_kind": "CASE"}
    payload = call_task("completed", structured_result=structured)
    result = provider_with(
        FakeCalleCalls(created={"id": "call_synthetic_sdk_1"}, statuses=[payload])
    ).place_call(request_for())
    assert result.structured_result == structured
    assert [(turn.speaker, turn.text) for turn in result.transcript] == [
        ("bot", "May I ask about warranty claim CLM-1042?"),
        ("user", "It is showing returned in our system."),
    ]


def test_attempt_transcript_filters_on_the_dialled_number_and_keeps_unknown_speakers():
    payload = {
        "recipients": [
            {
                "phones": ["+14155550101"],
                "attempts": [
                    {"phone": "+14155550101",
                     "transcript_turns": [{"speaker": "user", "text": "wrong number"}]}
                ],
            },
            {
                "phones": [RECIPIENT],
                "attempts": [
                    {"phone": RECIPIENT,
                     "transcript_turns": [
                         {"speaker": "unknown", "text": "  "},
                         {"speaker": "user", "text": "It is showing returned."},
                     ]},
                ],
            },
        ]
    }
    turns = attempt_transcript(payload, RECIPIENT)
    assert [(turn.speaker, turn.text) for turn in turns] == [
        ("user", "It is showing returned.")
    ]


def test_no_credential_or_full_number_enters_errors_or_the_ledger(tmp_path):
    from warrantyops.ledger import SqliteAttemptLedger

    calls = FakeCalleCalls(
        created={"id": "c1"},
        get_error=FakeCalleAPIError("rate_limited", "may echo " + RECIPIENT, 429),
    )
    result = provider_with(calls).place_call(request_for())
    forbidden = (RECIPIENT, API_KEY_PLACEHOLDER, TASK_TEXT)
    surface = " ".join(
        [
            str(result.transport.diagnostic_failure_code),
            str(result.transport.diagnostic_failure_message),
        ]
    )
    for secret in forbidden:
        assert secret not in surface

    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    assert ledger.reserve("warrantyops:audit", "f" * 64).created
    ledger.attach_call_id("warrantyops:audit", "call_synthetic_sdk_1")
    for row in ledger.rows():
        stored = " ".join(str(value) for value in row.values())
        for secret in forbidden:
            assert secret not in stored, secret
    assert row["call_id"] == "call_synthetic_sdk_1"


def test_the_gate_refusal_still_precedes_any_client_interaction():
    refused = AuthorizationDecision(allowed=False, refusals=())
    calls = FakeCalleCalls(created={"id": "c1"})
    provider = CalleCallProvider(
        config=CONFIG,
        authorization=refused,
        polling=PollingConfig(clock=lambda: 0.0, sleeper=lambda s: None),
        client_factory=lambda: FakeCalleClient(calls),
    )
    with pytest.raises(LiveCallRefused):
        provider.place_call(request_for())
    assert calls.create_count == 0


# --- transcript selection, unknown statuses and the config gate ----------------


def test_an_attempt_for_another_number_is_skipped_not_mixed_in():
    from warrantyops.providers.calle_client import attempt_transcript

    payload = call_task("completed")
    payload["recipients"][0]["attempts"][0]["phone"] = "+14155550101"
    assert attempt_transcript(payload, RECIPIENT) == ()


def test_an_attempt_without_a_phone_on_an_unlisted_recipient_is_skipped():
    from warrantyops.providers.calle_client import attempt_transcript

    payload = call_task("completed")
    payload["recipients"][0]["phones"] = ["+14155550101"]
    payload["recipients"][0]["attempts"][0]["phone"] = None
    assert attempt_transcript(payload, RECIPIENT) == ()


def test_a_status_the_sdk_does_not_document_is_uncertainty_not_a_guess():
    calls = FakeCalleCalls(created={"id": "c1"}, statuses=[call_task("teleported")])
    result = provider_with(calls).place_call(request_for())
    assert result.transport.state is TransportState.IN_PROGRESS
    assert result.transport.diagnostic_failure_code == "unrecognized_status"


def test_a_config_refusal_raises_before_any_client_exists():
    from dataclasses import replace

    from warrantyops.config import ConfigError

    keyless = replace(CONFIG, api_key=None)
    provider = CalleCallProvider(
        config=keyless,
        authorization=ALLOWED,
        polling=PollingConfig(clock=lambda: 0.0, sleeper=lambda seconds: None),
        client_factory=lambda: FakeCalleClient(FakeCalleCalls(created={"id": "c1"})),
    )
    with pytest.raises(ConfigError):
        provider.place_call(request_for())


def test_the_sdk_client_is_constructed_only_when_no_factory_is_injected(monkeypatch):
    import sys
    import types

    constructed: list[dict] = []
    calls = FakeCalleCalls(
        created={"id": "call_synthetic_sdk_import"},
        statuses=[call_task("completed", call_id="call_synthetic_sdk_import")],
    )

    def sdk_client(*, api_key, base_url, timeout):
        constructed.append({"has_key": bool(api_key), "base_url": base_url})
        return FakeCalleClient(calls)

    module = types.ModuleType("calle")
    module.CalleClient = sdk_client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calle", module)

    provider = CalleCallProvider(
        config=CONFIG,
        authorization=ALLOWED,
        polling=PollingConfig(
            deadline_seconds=10.0,
            interval_seconds=0.0,
            clock=lambda: 0.0,
            sleeper=lambda seconds: None,
        ),
        client_factory=None,
    )
    result = provider.place_call(request_for())
    assert result.transport.state is TransportState.COMPLETED
    assert constructed == [{"has_key": True, "base_url": CONFIG.base_url}]


def test_the_default_clock_and_sleeper_delegate_to_the_host():
    default = PollingConfig()
    assert default.clock() >= 0.0
    default.sleeper(0.0)  # a zero-length sleep is observable only as a return
