"""F4: the fault matrix. Inject the failure, assert the fail-closed shape.

Every row is one fault this architecture promises something specific about.
The provider seam is scripted to fail at a chosen point — before creation,
after creation with the id persisted, with the id persistence itself
failing, with a non-terminal return, with an invalid result — and the
ledger is corrupted, locked or versioned-from-the-future underneath the
run. The promise under test is the same for every row: the attempt is never
silently retried, the durable reservation survives, the state says exactly
what is and is not known, and a human is told when only a human can settle
it.

The rows here are the test half of ``docs/reliability.md``; the document
maps each fault to its observed behaviour and names the test that proves
it.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.contract import build_extraction_schema
from warrantyops.envelope import source_claim_from_dict
from warrantyops.identifiers import TranscriptTurn
from warrantyops.ledger import (
    SCHEMA_VERSION,
    AttemptLedgerUnavailable,
    AttemptReconciliationRequired,
    AttemptState,
    InMemoryAttemptLedger,
    SqliteAttemptLedger,
)
from warrantyops.outcome import TerminalState, TransportOutcome, TransportState
from warrantyops.providers.base import CallRequest, ProviderCall
from warrantyops.providers.fake import FakeCallProvider
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import RefusalGate, run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"
SCHEMA = build_extraction_schema()

TRANSCRIPT = (
    TranscriptTurn(speaker="bot", text="May I ask about warranty claim CLM-1042?"),
    TranscriptTurn(speaker="user", text="It is showing returned in our system."),
    TranscriptTurn(speaker="bot", text="What do you need from us?"),
    TranscriptTurn(speaker="user", text="A photograph of the hour meter."),
)


class ScriptedFaultProvider:
    """A provider that fails exactly where the row says it fails."""

    name = "scripted-fault"
    requires_durable_ledger = False

    def __init__(
        self,
        *,
        fail_before_create: bool = False,
        fail_after_create: bool = False,
        fail_call_id_persistence: bool = False,
        non_terminal: bool = False,
        invalid_result: bool = False,
        ledger_for_callback=None,
        key_for_callback=None,
    ) -> None:
        self.fail_before_create = fail_before_create
        self.fail_after_create = fail_after_create
        self.fail_call_id_persistence = fail_call_id_persistence
        self.non_terminal = non_terminal
        self.invalid_result = invalid_result
        self.ledger_for_callback = ledger_for_callback
        self.key_for_callback = key_for_callback

    def place_call(self, request: CallRequest, on_call_created=None) -> ProviderCall:
        if self.fail_before_create:
            raise RuntimeError("network unreachable before creation")
        if on_call_created is not None:
            if self.fail_call_id_persistence:
                # Creation succeeded; the persistence the caller performs
                # inside the callback is what fails.
                on_call_created("call_synthetic_fault")
                raise AttemptLedgerUnavailable("could not persist the call id")
            on_call_created("call_synthetic_fault")
        if self.fail_after_create:
            raise RuntimeError("connection lost after creation")
        if self.non_terminal:
            return ProviderCall(
                transport=TransportOutcome(state=TransportState.IN_PROGRESS),
                structured_result=None,
                transcript=(),
            )
        result = None if self.invalid_result else {
            "claim_status": "STATED_RETURNED",
            "claim_status_evidence_quote": "It is showing returned in our system.",
            "stated_reason": "no operating-hours reading attached",
            "required_correction": None,
            "required_documents": ["photograph of the hour meter"],
            "stated_deadline": None,
            "escalation_path": None,
            "stated_next_action": None,
            "reference_kind": "UNKNOWN",
            "reference_heard": None,
            "reference_readback_performed": False,
            "reference_confirmed": None,
            "reference_confirmation_quote": None,
        }
        return ProviderCall(
            transport=TransportOutcome(
                state=TransportState.COMPLETED, call_id="call_synthetic_fault"
            ),
            structured_result=(
                {"claim_status": 42} if self.invalid_result else result
            ),
            transcript=TRANSCRIPT,
        )


def seeded_setup(provider):
    fixture = FakeCallProvider(scenario="case_a_useful_resolution").load()
    claim = source_claim_from_dict(fixture["envelope"])
    recipient = fixture["recipient_e164"]
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    authorization = CallAuthorization(
        recipient_e164=recipient,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )
    return claim, authorization, provider, store


def first_key(ledger) -> str:
    """The one key a single-run ledger reserved, via the public audit API."""

    events = ledger.audit_events()
    assert events, "nothing was ever reserved"
    assert len({event.idempotency_key for event in events}) == 1
    return events[0].idempotency_key


# --- provider-seam faults ----------------------------------------------------


def test_provider_fails_before_creation_marks_unknown_and_never_retries():
    ledger = InMemoryAttemptLedger()
    claim, authorization, provider, store = seeded_setup(
        ScriptedFaultProvider(fail_before_create=True)
    )
    with pytest.raises(RuntimeError, match="before creation"):
        run_exception(
            claim, authorization, provider,
            version_reader=store, attempt_ledger=ledger,
            now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
        )
    # The reservation exists, is UNKNOWN, and a re-run is suppressed — even
    # by a provider that would succeed this time.
    key = first_key(ledger)
    assert ledger.find(key)["state"] == AttemptState.UNKNOWN.value
    second = run_exception(
        claim, authorization, ScriptedFaultProvider(),
        version_reader=store, attempt_ledger=ledger,
        now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
    )
    assert second.refusal is not None
    assert second.refusal.gate is RefusalGate.ATTEMPT_LEDGER
    assert second.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)


def test_provider_fails_after_creation_leaves_unknown_with_the_call_id():
    ledger = InMemoryAttemptLedger()
    claim, authorization, provider, store = seeded_setup(
        ScriptedFaultProvider(fail_after_create=True)
    )
    with pytest.raises(RuntimeError, match="after creation"):
        run_exception(
            claim, authorization, provider,
            version_reader=store, attempt_ledger=ledger,
            now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
        )
    row = ledger.find(first_key(ledger))
    assert row["state"] == AttemptState.UNKNOWN.value
    assert row["call_id"] == "call_synthetic_fault"  # reconcilable by a human


def test_call_id_persistence_failure_requires_human_reconciliation():
    ledger = InMemoryAttemptLedger()

    class PersistingThenFailing(ScriptedFaultProvider):
        def place_call(self, request, on_call_created=None):
            # The workflow's own callback both persists and (here) fails.
            def persist_and_fail(call_id):
                ledger.attach_call_id(request.idempotency_key, call_id)
                raise AttemptLedgerUnavailable("persisted, then the seam failed")

            return super().place_call(request, on_call_created=persist_and_fail)

    claim, authorization, provider, store = seeded_setup(
        PersistingThenFailing(fail_call_id_persistence=True)
    )
    with pytest.raises(AttemptReconciliationRequired, match="manual reconciliation") as caught:
        run_exception(
            claim, authorization, provider,
            version_reader=store, attempt_ledger=ledger,
            now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
        )
    key = first_key(ledger)
    assert ledger.find(key)["call_id"] == "call_synthetic_fault"
    # The reconciliation message names the attempt: a literal "{key}" here
    # would leave the human without the one identifier they need.
    assert key in str(caught.value)


def test_a_non_terminal_return_is_in_flight_and_unknown():
    ledger = InMemoryAttemptLedger()
    claim, authorization, provider, store = seeded_setup(
        ScriptedFaultProvider(non_terminal=True)
    )
    case = run_exception(
        claim, authorization, provider,
        version_reader=store, attempt_ledger=ledger,
        now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
    )
    assert case.refusal is None
    assert case.outcome.terminal_state is TerminalState.IN_FLIGHT
    assert case.outcome.write_back_eligible is False
    assert ledger.find(first_key(ledger))["state"] == AttemptState.UNKNOWN.value


def test_an_invalid_result_classifies_result_invalid():
    ledger = InMemoryAttemptLedger()
    claim, authorization, provider, store = seeded_setup(
        ScriptedFaultProvider(invalid_result=True)
    )
    case = run_exception(
        claim, authorization, provider,
        version_reader=store, attempt_ledger=ledger,
        now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
    )
    assert case.refusal is None
    assert case.outcome.terminal_state is TerminalState.RESULT_INVALID
    assert case.outcome.write_back_eligible is False
    assert ledger.find(first_key(ledger))["state"] == AttemptState.COMPLETED.value


# --- ledger faults -----------------------------------------------------------


def test_a_corrupt_ledger_file_fails_closed_before_any_call(tmp_path):
    path = tmp_path / "corrupt.sqlite"
    ledger = SqliteAttemptLedger(path)
    # The corruption happens after construction: an already-open ledger
    # whose file has been wrecked underneath it.
    path.write_bytes(b"this is not a database" * 100)
    claim, authorization, provider, store = seeded_setup(FakeCallProvider(
        scenario="case_a_useful_resolution"
    ))
    case = run_exception(
        claim, authorization, provider,
        version_reader=store, attempt_ledger=ledger,
        now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
    )
    assert case.refusal is not None
    assert case.refusal.gate is RefusalGate.ATTEMPT_LEDGER
    assert provider.replays == 0, "the scenario was replayed despite no reservation"


def test_opening_a_corrupt_ledger_file_refuses_immediately(tmp_path):
    path = tmp_path / "not-a-db.sqlite"
    path.write_bytes(b"this is not a database" * 100)
    with pytest.raises(AttemptLedgerUnavailable):
        SqliteAttemptLedger(path)


def test_a_busy_locked_ledger_refuses_the_run(tmp_path):
    path = tmp_path / "locked.sqlite"
    SqliteAttemptLedger(path).reserve("a" * 64, "fp")
    holder = sqlite3.connect(str(path), timeout=1.0)
    holder.execute("BEGIN EXCLUSIVE")
    holder.execute("SELECT count(*) FROM attempt_ledger").fetchone()
    try:
        # Construction itself needs the write lock (it applies the schema),
        # so a held-exclusive database refuses here rather than during the
        # run — either way: no reservation, no call.
        with pytest.raises(AttemptLedgerUnavailable, match="locked"):
            SqliteAttemptLedger(path)
    finally:
        holder.rollback()
        holder.close()


def test_a_ledger_from_the_future_is_refused(tmp_path):
    path = tmp_path / "future.sqlite"
    SqliteAttemptLedger(path).reserve("a" * 64, "fp")
    connection = sqlite3.connect(str(path))
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    connection.commit()
    connection.close()
    with pytest.raises(AttemptLedgerUnavailable, match="newer than the supported"):
        SqliteAttemptLedger(path)


def test_every_fault_row_keeps_the_chain_verifiable(tmp_path):
    """Whatever the fault, the audit chain never lies about what happened."""

    ledger = InMemoryAttemptLedger()
    claim, authorization, provider, store = seeded_setup(
        ScriptedFaultProvider(fail_after_create=True)
    )
    with pytest.raises(RuntimeError):
        run_exception(
            claim, authorization, provider,
            version_reader=store, attempt_ledger=ledger,
            now=NOW, on=ON, allowlist=frozenset({authorization.recipient_e164}),
        )
    assert ledger.audit_problems() == []
    reasons = [event.reason for event in ledger.audit_events()]
    assert reasons.count("outcome_undetermined") == 1


# --- a ledger that cannot record uncertainty escalates --------------------------


def test_a_ledger_that_cannot_record_uncertainty_escalates_to_a_human():
    class LedgerThatCannotMark(InMemoryAttemptLedger):
        def mark_unknown(self, idempotency_key):
            raise AttemptLedgerUnavailable("synthetic: marks disabled")

    ledger = LedgerThatCannotMark()
    claim, authorization, provider, store = seeded_setup(
        ScriptedFaultProvider(fail_after_create=True)
    )
    with pytest.raises(AttemptReconciliationRequired, match="uncertain outcome"):
        run_exception(
            claim,
            authorization,
            provider,
            version_reader=store,
            attempt_ledger=ledger,
            now=NOW,
            on=ON,
            allowlist=frozenset({authorization.recipient_e164}),
        )
