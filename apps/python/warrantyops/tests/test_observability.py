"""The structured event log: closed fields, closed vocabularies, no PII.

F1 hardening. Everything the log may emit is enumerated in advance; these
tests prove the enumeration is enforced (unknown names and fields are
dropped and counted, never written), that vocabulary fields can only carry
values the implementation's own enums define, and — the negative control —
that planted sensitive values (a phone number, an account number, a
credential-shaped string) never appear in the emitted stream.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.envelope import source_claim_from_dict
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.observability import EventLog, json_metrics
from warrantyops.providers.fake import FakeCallProvider
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import RefusalGate, run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"
CORRELATION = "0123456789abcdef"

PLANTED_PHONE = "+15555550199"
PLANTED_ACCOUNT = "account 00423 99871"
# Deliberately NOT Bearer-/sk-/calle_-shaped: the repository's hygiene scan
# forbids credential-shaped strings even as planted negatives. A long digit
# run is still a planted secret as far as the guard is concerned.
PLANTED_CREDENTIAL = "authorization token 9988776655443322"


def capturing_log() -> tuple[EventLog, list[str]]:
    lines: list[str] = []
    return EventLog(sink=lines.append, correlation_id=CORRELATION), lines


def run_with_events(scenario: str, **kwargs):
    provider = FakeCallProvider(scenario=scenario)
    fixture = provider.load()
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
    options = {
        "version_reader": store,
        "attempt_ledger": InMemoryAttemptLedger(),
        "now": NOW,
        "on": ON,
        "allowlist": frozenset({recipient}),
    }
    options.update(kwargs)
    return run_exception(claim, authorization, provider, **options)


# --- closed names and fields ------------------------------------------------


def test_unknown_event_names_are_dropped_and_counted():
    log, lines = capturing_log()
    log.emit("definitely_not_an_event", note="x")
    assert lines == []
    assert log.dropped_fields() == 1
    assert log.metrics()["by_event"].get("field_dropped_from_event") == 1


def test_unknown_fields_are_dropped_and_counted():
    log, lines = capturing_log()
    log.emit("run_started", note="fine", transcript="should never exist")
    body = json.loads(lines[0])
    assert "transcript" not in body
    assert log.dropped_fields() == 1


def test_vocabulary_fields_refuse_free_text():
    log, _ = capturing_log()
    log.emit("gate_passed", gate="TOTALLY_MADE_UP_GATE")
    log.emit("outcome_derived", terminal_state="EVERYTHING_IS_FINE")
    log.emit("reserved", to_state="reserved but in prose")
    log.emit("write_back_result", outcome="wrote it, trust me")
    assert log.dropped_fields() == 4
    for event in log.events():
        assert "gate" not in event or event["event"] != "gate_passed"
        assert "terminal_state" not in event


def test_key_prefix_must_be_a_short_digest_prefix():
    log, _ = capturing_log()
    log.emit("reserved", key_prefix="deadbeefcafe")
    log.emit("reserved", key_prefix="warrantyops:deadbeefcafe")
    log.emit("reserved", key_prefix="deadbeefcafe0123456789abcdef0")  # too long
    log.emit("reserved", key_prefix="not-hex!")
    assert log.dropped_fields() == 2
    prefixes = [e["key_prefix"] for e in log.events() if "key_prefix" in e]
    assert prefixes == ["deadbeefcafe", "warrantyops:deadbeefcafe"]


def test_ts_must_be_a_string():
    log, _ = capturing_log()
    log.emit("decision_recorded", ts=12345)
    assert log.dropped_fields() == 1


# --- the planted-value negative control --------------------------------------


def test_planted_pii_never_reaches_the_stream():
    log, lines = capturing_log()
    # Every free-form field the log has, with a planted sensitive value.
    log.emit("run_started", note=PLANTED_PHONE, provider=PLANTED_CREDENTIAL)
    log.emit(
        "gate_refused",
        gate=RefusalGate.ECONOMICS.value,
        refusals=[PLANTED_ACCOUNT],  # not vocabulary members
    )
    log.emit("reserved", key_prefix=PLANTED_PHONE)
    stream = "\n".join(lines)
    assert PLANTED_PHONE not in stream
    assert PLANTED_ACCOUNT not in stream
    assert PLANTED_CREDENTIAL not in stream
    assert "555555" not in stream  # the number, fragmented or whole
    # Nothing was silently emitted: every planted field was counted.
    assert log.dropped_fields() == 4


def test_no_five_digit_run_exists_in_any_legal_event():
    """Even a legal event cannot smuggle a long digit run past the guard."""

    log, lines = capturing_log()
    log.emit("run_started", note="claim 987654321 on file")
    # The event still happens; the note with the account number does not.
    assert len(lines) == 1
    assert "987654321" not in lines[0]
    assert log.dropped_fields() == 1


# --- one run, one correlation id ---------------------------------------------


def test_a_full_run_emits_its_trace_in_gate_order():
    log = EventLog(sink=lambda _line: None, correlation_id=CORRELATION)
    run = run_with_events("case_a_useful_resolution", events=log)
    assert run.refusal is None
    names = [event["event"] for event in log.events()]
    assert names[0] == "run_started"
    assert names[-1] == "outcome_derived"
    gates = [
        event["gate"] for event in log.events() if event["event"] == "gate_passed"
    ]
    assert gates == [
        RefusalGate.ENVELOPE.value,
        RefusalGate.RESIDUAL_NECESSITY.value,
        RefusalGate.SOURCE_STATE.value,
        RefusalGate.ECONOMICS.value,
        RefusalGate.AUTHORIZATION.value,
        RefusalGate.DISCLOSURE.value,
    ]
    assert "reserved" in names
    assert "call_created" in names
    assert all(event["correlation_id"] == CORRELATION for event in log.events())


def test_a_refused_run_counts_the_refusing_gate():
    log = EventLog(sink=lambda _line: None, correlation_id=CORRELATION)
    # case_c is missing documents — the call happens; use a stale-version
    # scenario instead by pointing the store at a different version first.
    provider = FakeCallProvider(scenario="case_a_useful_resolution")
    fixture = provider.load()
    claim = source_claim_from_dict(fixture["envelope"])
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, "v999")
    authorization = CallAuthorization(
        recipient_e164=fixture["recipient_e164"],
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )
    run = run_exception(
        claim,
        authorization,
        provider,
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=NOW,
        on=ON,
        allowlist=frozenset({fixture["recipient_e164"]}),
        events=log,
    )
    assert run.refusal is not None
    metrics = log.metrics()
    assert metrics["refusals_by_gate"] == {RefusalGate.SOURCE_STATE.value: 1}
    assert metrics["terminal_states"] == {}
    names = [event["event"] for event in log.events()]
    assert names[-1] == "gate_refused"


def test_duplicate_suppression_is_observable():
    ledger = InMemoryAttemptLedger()
    log = EventLog(sink=lambda _line: None, correlation_id=CORRELATION)
    first = run_with_events("case_a_useful_resolution", events=log, attempt_ledger=ledger)
    assert first.refusal is None
    second = run_with_events("case_a_useful_resolution", events=log, attempt_ledger=ledger)
    assert second.refusal is not None
    assert any(
        event["event"] == "duplicate_suppressed" for event in log.events()
    )


# --- metrics and the pane ----------------------------------------------------


def test_metrics_and_json_rendering_agree_with_the_stream():
    log, lines = capturing_log()
    run_with_events("case_a_useful_resolution", events=log)
    metrics = log.metrics()
    assert metrics["events_total"] == len(lines)
    assert metrics["dropped_fields"] == 0
    assert metrics["correlation_id"] == CORRELATION
    assert metrics["terminal_states"]  # the terminal classification was counted
    parsed = json.loads(json_metrics(log))
    assert parsed == metrics
    assert log.pane() == [json.loads(line) for line in lines]


def test_the_pane_is_a_copy_not_the_live_list():
    log, _ = capturing_log()
    run_with_events("case_a_useful_resolution", events=log)
    pane = log.pane()
    pane.append({"event": "forged"})
    assert len(log.pane()) != len(pane)


def test_receipts_dont_read_the_log_so_runs_stay_deterministic():
    """Same inputs, with and without the log, produce the same outcome dict."""

    with_log = run_with_events(
        "case_a_useful_resolution", events=EventLog(sink=lambda _line: None)
    )
    without_log = run_with_events("case_a_useful_resolution")
    assert with_log.outcome is not None
    assert with_log.outcome.to_dict() == without_log.outcome.to_dict()
    assert with_log.idempotency_key == without_log.idempotency_key


# --- the default sink ------------------------------------------------------------


def test_the_default_sink_writes_the_event_stream_to_stderr(capsys):
    log = EventLog()  # no sink injected: the operator default applies
    run_with_events("case_a_useful_resolution", events=log)
    err = capsys.readouterr().err
    assert err.strip()
    assert json.loads(err.splitlines()[0])["event"]
