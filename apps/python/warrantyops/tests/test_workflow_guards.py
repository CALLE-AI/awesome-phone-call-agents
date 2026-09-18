"""The workflow's own hard refusals and duplicate-prevention guarantees.

The gate modules are tested elsewhere; these tests prove the workflow
honours them: a run without a version reader never reaches the provider, an
authorization for a number other than the claim's counterparty never reaches
the provider, and one run of one claim at one source version is exactly one
provider interaction carrying one stable idempotency key.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.envelope import source_claim_from_dict
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.providers.base import CallRequest, ProviderCall
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import RefusalGate, run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"
SCENARIO = "case_a_useful_resolution"


class CountingProvider:
    """A provider seam that records every request and refuses a second call.

    One run of one claim at one source version must be at most one provider
    interaction. The guard lives in the seam so that any code path trying to
    dial twice inside a single run fails loudly here instead of quietly in
    production.
    """

    def __init__(self, scenario: str) -> None:
        self._inner = FakeCallProvider(scenario=scenario, fixture_dir=FIXTURE_DIR)
        self.name = "counting"
        self.requires_durable_ledger = False
        self.requests: list[CallRequest] = []

    def place_call(self, request: CallRequest, on_call_created=None) -> ProviderCall:
        if self.requests:
            raise AssertionError("one run placed a second provider interaction")
        self.requests.append(request)
        return self._inner.place_call(request, on_call_created=on_call_created)


def load_claim():
    fixture = FakeCallProvider(scenario=SCENARIO, fixture_dir=FIXTURE_DIR).load()
    return source_claim_from_dict(fixture["envelope"])


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


def run(claim, authorization, provider, **overrides):
    options = {
        "version_reader": seeded_store(claim),
        "attempt_ledger": InMemoryAttemptLedger(),
        "now": NOW,
        "on": ON,
    }
    options.update(overrides)
    return run_exception(claim, authorization, provider, **options)


# --- the mandatory changed-state check -------------------------------------


def test_a_run_without_a_version_reader_refuses_instead_of_skipping_the_check():
    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    result = run(
        claim,
        authorization_for(claim.counterparty_phone_e164),
        provider,
        version_reader=None,
    )
    assert result.outcome is None
    assert result.idempotency_key is None
    assert result.refusal.gate is RefusalGate.SOURCE_STATE
    assert result.refusal.reasons == ("SOURCE_RECHECK_UNAVAILABLE",)
    assert result.refusal.details["reason"]
    assert provider.requests == []  # zero provider interactions


def test_a_run_with_a_reader_that_confirms_the_version_still_calls_once():
    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    result = run(
        claim, authorization_for(claim.counterparty_phone_e164), provider
    )
    assert result.refusal is None
    assert len(provider.requests) == 1


# --- the authorization is bound to the claim's destination ------------------


def test_an_authorization_for_another_number_than_the_claim_refuses():
    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    result = run(claim, authorization_for("+14155550101"), provider)
    assert result.outcome is None
    assert result.idempotency_key is None
    assert result.refusal.gate is RefusalGate.AUTHORIZATION
    assert result.refusal.reasons == ("AUTHORIZED_RECIPIENT_MISMATCH",)
    assert result.refusal.details["reason"]
    assert provider.requests == []  # zero provider interactions


def test_the_mismatch_refusal_holds_even_when_the_authorization_is_otherwise_valid():
    """The binding is not something a valid record can compensate for."""

    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    # Every other field is in order: basis, purpose, window, record pointer,
    # and the number itself is a valid E.164 that is allowlisted.
    result = run(
        claim,
        authorization_for("+14155550101"),
        provider,
        allowlist=frozenset({"+14155550101"}),
    )
    assert result.refusal.reasons == ("AUTHORIZED_RECIPIENT_MISMATCH",)
    assert provider.requests == []


# --- one claim, one version, one interaction --------------------------------


def test_one_run_is_exactly_one_provider_interaction_for_the_counterparty():
    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    result = run(claim, authorization_for(claim.counterparty_phone_e164), provider)
    assert result.refusal is None
    assert len(provider.requests) == 1
    request = provider.requests[0]
    assert request.recipient_e164 == claim.counterparty_phone_e164
    assert request.idempotency_key == result.idempotency_key


def test_the_same_claim_and_source_version_twice_places_exactly_one_call():
    """One shared ledger, one claim version: one total provider interaction.

    The second run derives the same key, finds the reservation and is
    suppressed locally — the CALL-E replay guarantee is not relied on.
    """

    claim = load_claim()
    ledger = InMemoryAttemptLedger()
    first_provider = CountingProvider(SCENARIO)
    second_provider = CountingProvider(SCENARIO)
    first = run(
        claim,
        authorization_for(claim.counterparty_phone_e164),
        first_provider,
        attempt_ledger=ledger,
    )
    second = run(
        claim,
        authorization_for(claim.counterparty_phone_e164),
        second_provider,
        attempt_ledger=ledger,
    )
    assert first.refusal is None
    assert len(first_provider.requests) == 1
    assert second_provider.requests == []  # the second run never reached it
    assert second.refusal is not None
    assert second.refusal.gate is RefusalGate.ATTEMPT_LEDGER
    assert second.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)
    assert second.idempotency_key == first.idempotency_key


def test_independent_ledgers_still_derive_the_identical_request():
    """Defence in depth: fresh ledgers, identical key and body on the wire.

    Each run is a separate ledger (as a genuinely independent retry would
    be), so both place one interaction — and what they send is byte-for-byte
    the same request, which is what lets a vendor-side idempotency mechanism,
    if one exists, replay instead of dial.
    """

    claim = load_claim()
    first_provider = CountingProvider(SCENARIO)
    second_provider = CountingProvider(SCENARIO)
    first = run(
        claim, authorization_for(claim.counterparty_phone_e164), first_provider
    )
    second = run(
        claim, authorization_for(claim.counterparty_phone_e164), second_provider
    )
    assert first.refusal is None and second.refusal is None
    assert first.idempotency_key is not None
    assert first.idempotency_key == second.idempotency_key
    assert len(first_provider.requests) == 1
    assert len(second_provider.requests) == 1
    assert first_provider.requests[0] == second_provider.requests[0]


def test_a_moved_source_version_changes_the_key_so_a_replay_cannot_answer_it():
    """The key is claim-version bound: v7's answer must not serve a v8 record."""

    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    store = seeded_store(claim)
    first = run(claim, authorization_for(claim.counterparty_phone_e164), provider)
    store.set_version(claim.source_platform, claim.source_claim_id, "v8")
    moved = run_exception(
        claim,
        authorization_for(claim.counterparty_phone_e164),
        CountingProvider(SCENARIO),
        version_reader=store,
        now=NOW,
        on=ON,
    )
    assert first.idempotency_key != moved.idempotency_key
    # And the moved record is refused outright: v8 is not v7.
    assert moved.refusal is not None
    assert moved.refusal.gate is RefusalGate.SOURCE_STATE
    assert moved.refusal.reasons == ("SOURCE_CHANGED",)


# --- every gate can refuse through the workflow, not only in isolation ---------


def test_an_invalid_envelope_refuses_at_the_envelope_gate():
    from dataclasses import replace

    claim = replace(load_claim(), economic_policy_id="  ")
    provider = CountingProvider(SCENARIO)
    result = run(claim, authorization_for(claim.counterparty_phone_e164), provider)
    assert result.refusal.gate is RefusalGate.ENVELOPE
    assert result.refusal.reasons == ("MISSING_POLICY_ID",)
    assert provider.requests == []


def test_an_uneconomic_claim_refuses_at_the_economics_gate():
    from dataclasses import replace

    claim = replace(load_claim(), claim_face_value=None, claim_currency=None)
    provider = CountingProvider(SCENARIO)
    result = run(claim, authorization_for(claim.counterparty_phone_e164), provider)
    assert result.refusal.gate is RefusalGate.ECONOMICS
    assert result.refusal.reasons
    assert provider.requests == []


def test_an_expired_authorization_refuses_at_the_authorization_gate():
    from dataclasses import replace

    claim = load_claim()
    provider = CountingProvider(SCENARIO)
    expired = replace(
        authorization_for(claim.counterparty_phone_e164),
        expires_at=NOW - timedelta(minutes=1),
    )
    result = run(claim, expired, provider)
    assert result.refusal.gate is RefusalGate.AUTHORIZATION
    assert result.refusal.reasons == ("EXPIRED",)
    assert provider.requests == []
