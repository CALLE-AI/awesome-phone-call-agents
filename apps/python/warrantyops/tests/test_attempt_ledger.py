"""The attempt ledger: durable local suppression of duplicate calls.

These tests prove the safety property the workflow now depends on: one
claim, one source version, one provider interaction — enforced locally,
before the provider, whether the ledger is in memory or a SQLite file that
survives the process. The vendor's idempotency replay is never exercised and
never relied on.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.config import find_repository_root
from warrantyops.contract import CONTRACT_VERSION
from warrantyops.envelope import source_claim_from_dict
from warrantyops.idempotency import derive_idempotency_key
from warrantyops.ledger import (
    AttemptLedgerUnavailable,
    InMemoryAttemptLedger,
    LedgerRefusal,
    SqliteAttemptLedger,
    ledger_path_refusals,
)
from warrantyops.outcome import TerminalState, TransportOutcome, TransportState
from warrantyops.providers.base import CallRequest, ProviderCall
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import RefusalGate, run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"
SCENARIO = "case_a_useful_resolution"

#: Strings that must never appear in a ledger, in memory or on disk.
FORBIDDEN_IN_LEDGER = (
    "5550142",  # the recipient number's digits
    "CLM-1042",  # the claim identity
    "hour meter",  # task and transcript text
    "Example Equipment Dealers",  # the organization
)


def load_fixture() -> dict:
    return FakeCallProvider(scenario=SCENARIO, fixture_dir=FIXTURE_DIR).load()


def claim_from(envelope: dict):
    return source_claim_from_dict(envelope)


def seeded_store(claim):
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    return store


def authorization_for(number: str) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=number,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )


def run(claim, ledger, provider, **overrides):
    options = {
        "version_reader": seeded_store(claim),
        "attempt_ledger": ledger,
        "now": NOW,
        "on": ON,
    }
    options.update(overrides)
    return run_exception(
        claim, authorization_for(claim.counterparty_phone_e164), provider, **options
    )


class RecordingProvider:
    """Counts interactions; fails loudly if one run dials twice."""

    def __init__(self, scenario: str = SCENARIO) -> None:
        self._inner = FakeCallProvider(scenario=scenario, fixture_dir=FIXTURE_DIR)
        self.name = "recording"
        self.requires_durable_ledger = False
        self.requests: list[CallRequest] = []

    def place_call(self, request: CallRequest, on_call_created=None) -> ProviderCall:
        if self.requests:
            raise AssertionError("one run placed a second provider interaction")
        self.requests.append(request)
        return self._inner.place_call(request, on_call_created=on_call_created)


class LiveDeclaringProvider(RecordingProvider):
    """Declares live capability, so only a durable ledger may pair with it."""

    def __init__(self, scenario: str = SCENARIO) -> None:
        super().__init__(scenario)
        self.name = "live-declaring"
        self.requires_durable_ledger = True


class ExplodingProvider:
    """Raises mid-call: the attempt's outcome is genuinely unknown."""

    name = "exploding"
    requires_durable_ledger = False

    def __init__(self) -> None:
        self.requests: list[CallRequest] = []

    def place_call(self, request: CallRequest, on_call_created=None) -> ProviderCall:
        self.requests.append(request)
        raise RuntimeError("connection lost while placing the call")


class InFlightProvider:
    """Returns before the call reaches a terminal state."""

    name = "in-flight"
    requires_durable_ledger = False

    def __init__(self) -> None:
        self.requests: list[CallRequest] = []

    def place_call(self, request: CallRequest, on_call_created=None) -> ProviderCall:
        self.requests.append(request)
        if on_call_created is not None:
            on_call_created("call_synthetic_inflight")
        return ProviderCall(
            transport=TransportOutcome(
                state=TransportState.IN_PROGRESS, call_id="call_synthetic_inflight"
            ),
            structured_result=None,
            transcript=(),
            raw={},
        )


class BrokenLedger:
    """A ledger that cannot be read or written fails closed."""

    durable = True

    def reserve(self, idempotency_key, request_fingerprint):
        raise AttemptLedgerUnavailable("database is locked")

    def mark_completed(self, idempotency_key):
        raise AttemptLedgerUnavailable("database is locked")

    def mark_unknown(self, idempotency_key):
        raise AttemptLedgerUnavailable("database is locked")

    def attach_call_id(self, idempotency_key, call_id):
        raise AttemptLedgerUnavailable("database is locked")


# --- one claim version, one interaction --------------------------------------


def test_one_shared_ledger_two_executions_one_total_interaction():
    claim = claim_from(load_fixture()["envelope"])
    ledger = InMemoryAttemptLedger()
    first_provider = RecordingProvider()
    second_provider = RecordingProvider()
    first = run(claim, ledger, first_provider)
    second = run(claim, ledger, second_provider)
    assert first.refusal is None
    assert len(first_provider.requests) + len(second_provider.requests) == 1
    assert second.refusal is not None
    assert second.refusal.gate is RefusalGate.ATTEMPT_LEDGER
    assert second.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)


def test_the_second_execution_reports_only_safe_attempt_metadata():
    claim = claim_from(load_fixture()["envelope"])
    ledger = InMemoryAttemptLedger()
    run(claim, ledger, RecordingProvider())
    second = run(claim, ledger, RecordingProvider())
    details = second.refusal.details
    assert details["reservation"]["reservation_state"] == "COMPLETED"
    assert details["reason"]
    dumped = repr(details)
    for forbidden in FORBIDDEN_IN_LEDGER:
        assert forbidden not in dumped, forbidden


def test_two_sqlite_instances_on_one_database_permit_one_interaction(tmp_path):
    """Two ledger instances simulate a process restart; suppression holds."""

    envelope = load_fixture()["envelope"]
    claim = claim_from(envelope)
    database = tmp_path / "attempts.sqlite"
    first_provider = RecordingProvider()
    first = run(claim, SqliteAttemptLedger(database), first_provider)
    # A brand-new instance over the same file: everything the process knew is
    # gone except what was committed.
    second_provider = RecordingProvider()
    second = run(claim, SqliteAttemptLedger(database), second_provider)
    assert first.refusal is None
    assert len(first_provider.requests) == 1
    assert second_provider.requests == []
    assert second.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)
    rows = SqliteAttemptLedger(database).rows()
    assert len(rows) == 1
    assert rows[0]["state"] == "COMPLETED"


# --- conflicts ---------------------------------------------------------------


def test_the_same_key_with_a_changed_body_is_an_idempotency_conflict():
    """Same key (same claim, version, authorization) but a different task."""

    fixture = load_fixture()
    claim = claim_from(fixture["envelope"])
    altered_envelope = dict(fixture["envelope"])
    altered_envelope["caller_organization"] = "Other Equipment Dealers"
    altered = claim_from(altered_envelope)

    ledger = InMemoryAttemptLedger()
    first_provider = RecordingProvider()
    second_provider = RecordingProvider()
    first = run(claim, ledger, first_provider)
    second = run(altered, ledger, second_provider)
    assert first.refusal is None
    assert first.idempotency_key == second.idempotency_key  # key unchanged
    assert second.refusal.reasons == ("IDEMPOTENCY_CONFLICT",)
    assert second_provider.requests == []


# --- uncertain attempts ------------------------------------------------------


def test_a_provider_failure_after_reservation_leaves_unknown_and_blocks_retry(tmp_path):
    database = tmp_path / "attempts.sqlite"
    claim = claim_from(load_fixture()["envelope"])
    exploding = ExplodingProvider()
    with pytest.raises(RuntimeError):
        run(claim, SqliteAttemptLedger(database), exploding)
    assert len(exploding.requests) == 1  # the reservation did reach it once

    # After a "restart", the unknown attempt still suppresses.
    rows = SqliteAttemptLedger(database).rows()
    assert rows[0]["state"] == "UNKNOWN"
    replay_provider = RecordingProvider()
    replay = run(claim, SqliteAttemptLedger(database), replay_provider)
    assert replay_provider.requests == []
    assert replay.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)
    assert replay.refusal.details["reservation"]["reservation_state"] == "UNKNOWN"


def test_a_non_terminal_provider_result_is_an_unknown_attempt():
    claim = claim_from(load_fixture()["envelope"])
    ledger = InMemoryAttemptLedger()
    provider = InFlightProvider()
    result = run(claim, ledger, provider)
    assert result.outcome.terminal_state is TerminalState.IN_FLIGHT
    verdict = ledger.reserve(result.idempotency_key, "irrelevant")
    assert verdict.created is False
    assert verdict.state.value == "UNKNOWN"
    replay = run(claim, ledger, RecordingProvider())
    assert replay.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)


# --- the ledger is mandatory -------------------------------------------------


def test_a_missing_ledger_refuses_before_any_provider_interaction():
    claim = claim_from(load_fixture()["envelope"])
    provider = RecordingProvider()
    result = run(claim, None, provider)
    assert result.outcome is None
    assert result.refusal.gate is RefusalGate.ATTEMPT_LEDGER
    assert result.refusal.reasons == ("ATTEMPT_LEDGER_UNAVAILABLE",)
    assert provider.requests == []


def test_an_unreadable_ledger_fails_closed():
    claim = claim_from(load_fixture()["envelope"])
    provider = RecordingProvider()
    result = run(claim, BrokenLedger(), provider)
    assert result.refusal.reasons == ("ATTEMPT_LEDGER_UNAVAILABLE",)
    assert result.refusal.details["reason"]
    assert provider.requests == []


def test_a_live_capable_provider_refuses_a_non_durable_ledger():
    claim = claim_from(load_fixture()["envelope"])
    provider = LiveDeclaringProvider()
    result = run(claim, InMemoryAttemptLedger(), provider)
    assert result.refusal.reasons == ("LEDGER_NOT_DURABLE",)
    assert provider.requests == []


def test_a_live_capable_provider_accepts_a_durable_ledger(tmp_path):
    claim = claim_from(load_fixture()["envelope"])
    provider = LiveDeclaringProvider()
    result = run(claim, SqliteAttemptLedger(tmp_path / "attempts.sqlite"), provider)
    assert result.refusal is None
    assert len(provider.requests) == 1


# --- new keys, and what is stored --------------------------------------------


def test_a_legitimately_new_key_creates_a_new_reservation(tmp_path):
    fixture = load_fixture()
    claim = claim_from(fixture["envelope"])
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    first = run(claim, ledger, RecordingProvider())

    # A new source version is a new question: new key, new reservation. The
    # manifest is re-bound to the new version, as a fresh export would be.
    bumped_envelope = dict(fixture["envelope"])
    bumped_envelope["source_version"] = "v8"
    bumped_envelope["exhaustion_manifest"] = dict(
        fixture["envelope"]["exhaustion_manifest"], source_version="v8"
    )
    bumped = claim_from(bumped_envelope)
    bumped_store = InMemorySourceStore()
    bumped_store.set_version(bumped.source_platform, bumped.source_claim_id, "v8")
    second_provider = RecordingProvider()
    second = run_exception(
        bumped,
        authorization_for(bumped.counterparty_phone_e164),
        second_provider,
        version_reader=bumped_store,
        attempt_ledger=ledger,
        now=NOW,
        on=ON,
    )
    assert first.idempotency_key != second.idempotency_key
    assert second.refusal is None
    assert len(second_provider.requests) == 1
    assert len(ledger.rows()) == 2


def test_the_one_permitted_request_still_carries_the_deterministic_key():
    claim = claim_from(load_fixture()["envelope"])
    provider = RecordingProvider()
    result = run(claim, InMemoryAttemptLedger(), provider)
    assert len(provider.requests) == 1
    expected_key = derive_idempotency_key(
        namespace="warrantyops",
        authorization_record_reference="synthetic://fixture-authorization",
        source_platform=claim.source_platform,
        source_claim_id=claim.source_claim_id,
        source_version=claim.source_version,
        contract_version=CONTRACT_VERSION,
    )
    assert provider.requests[0].idempotency_key == expected_key
    assert result.idempotency_key == expected_key


def test_no_sensitive_field_ever_reaches_the_durable_ledger(tmp_path):
    database = tmp_path / "attempts.sqlite"
    claim = claim_from(load_fixture()["envelope"])
    run(claim, SqliteAttemptLedger(database), RecordingProvider())
    for row in SqliteAttemptLedger(database).rows():
        stored = " ".join(str(value) for value in row.values())
        for forbidden in FORBIDDEN_IN_LEDGER:
            assert forbidden not in stored, forbidden
    raw = database.read_bytes()
    for forbidden in FORBIDDEN_IN_LEDGER:
        assert forbidden.encode("utf-8") not in raw, forbidden


# --- ledger paths ------------------------------------------------------------


def test_a_ledger_path_inside_the_repository_is_refused():
    repo_root = find_repository_root()
    assert repo_root is not None
    inside = repo_root / "apps" / "python" / "warrantyops" / "attempts.sqlite"
    assert ledger_path_refusals(inside) == (
        LedgerRefusal.LEDGER_PATH_INSIDE_REPOSITORY,
    )
    with pytest.raises(AttemptLedgerUnavailable):
        SqliteAttemptLedger(inside)
    assert ledger_path_refusals(None) == (LedgerRefusal.LEDGER_PATH_MISSING,)
    assert ledger_path_refusals(Path("/tmp/warrantyops-attempts.sqlite")) == ()


# --- unavailable ledgers and damaged reservations ---------------------------------


def test_a_missing_repository_root_lets_an_outside_path_stand(tmp_path, monkeypatch):
    from warrantyops import ledger as ledger_module

    monkeypatch.setattr(ledger_module, "find_repository_root", lambda: None)
    assert ledger_path_refusals(tmp_path / "attempts.sqlite") == ()


def test_marking_a_key_that_was_never_reserved_is_an_error():
    ledger = InMemoryAttemptLedger()
    with pytest.raises(AttemptLedgerUnavailable, match="no reservation"):
        ledger.mark_completed("warrantyops:never-reserved")
    with pytest.raises(AttemptLedgerUnavailable, match="no reservation"):
        ledger.mark_unknown("warrantyops:never-reserved")
    with pytest.raises(AttemptLedgerUnavailable, match="no reservation"):
        ledger.attach_call_id("warrantyops:never-reserved", "call_synthetic_missing")


def test_a_reservation_deleted_out_of_band_is_detected_not_assumed(tmp_path):
    import sqlite3

    database = tmp_path / "attempts.sqlite"
    ledger = SqliteAttemptLedger(database)
    ledger.reserve("warrantyops:damaged", "fingerprint")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "DELETE FROM attempt_ledger WHERE idempotency_key = ?",
            ("warrantyops:damaged",),
        )
    with pytest.raises(AttemptLedgerUnavailable, match="no reservation"):
        ledger.mark_completed("warrantyops:damaged")
    with pytest.raises(AttemptLedgerUnavailable, match="no reservation"):
        ledger.attach_call_id("warrantyops:damaged", "call_synthetic_ghost")


def test_sqlite_failures_surface_as_unavailable_never_as_success(tmp_path, monkeypatch):
    import sqlite3

    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")

    def refusing_connect(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked by the test")

    monkeypatch.setattr(sqlite3, "connect", refusing_connect)
    for operation in (
        lambda: ledger.reserve("warrantyops:locked", "fingerprint"),
        lambda: ledger.mark_completed("warrantyops:locked"),
        lambda: ledger.mark_unknown("warrantyops:locked"),
        lambda: ledger.attach_call_id("warrantyops:locked", "call_synthetic_locked"),
        lambda: ledger.find("warrantyops:locked"),
        lambda: ledger.rows(),
        lambda: ledger.audit_events(),
    ):
        with pytest.raises(AttemptLedgerUnavailable, match="unavailable"):
            operation()


def test_a_database_from_before_call_ids_existed_is_migrated_on_open(tmp_path):
    import sqlite3

    database = tmp_path / "attempts.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE attempt_ledger ("
            "idempotency_key TEXT PRIMARY KEY, request_fingerprint TEXT NOT NULL, "
            "state TEXT NOT NULL, reserved_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO attempt_ledger VALUES (?, ?, ?, ?, ?)",
            (
                "warrantyops:legacy",
                "fingerprint",
                "RESERVED",
                "2026-09-01T12:00:00+00:00",
                "2026-09-01T12:00:00+00:00",
            ),
        )
    ledger = SqliteAttemptLedger(database)  # the open itself migrates the schema
    assert ledger.find("warrantyops:legacy")["state"] == "RESERVED"
    ledger.attach_call_id("warrantyops:legacy", "call_synthetic_migrated")
    assert ledger.find("warrantyops:legacy")["call_id"] == "call_synthetic_migrated"
