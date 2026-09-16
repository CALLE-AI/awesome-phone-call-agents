"""One call, one key - the property this tool exists to guarantee."""

from __future__ import annotations

import pytest
from claimcall import dispatcher, safety
from claimcall import manifest as manifest_mod
from claimcall_core import FixtureProvider

from .conftest import FIXTURES, load_claim


def _plan(name="eligible-claim.json"):  # noqa: ANN001, ANN201
    m = manifest_mod.build(load_claim(name))
    return m, safety.evaluate(m)


def test_a_dry_run_places_no_call_and_still_reserves():
    m, report = _plan()
    outcome = dispatcher.run(manifest=m, safety=report, live=False)
    assert outcome.intent.dry_run is True
    assert outcome.intent.idempotency_key.startswith("claimcall:")


def test_repeated_runs_in_one_session_produce_one_call():
    m, report = _plan()
    session = dispatcher.Session()
    provider = FixtureProvider(fixtures_dir=FIXTURES, scenario="claim-registered")
    first = dispatcher.run(manifest=m, safety=report, session=session, provider=provider)
    for _ in range(4):
        again = dispatcher.run(manifest=m, safety=report, session=session, provider=provider)
        assert again.deduplicated is True
        assert again.intent.id == first.intent.id
    assert provider.submissions == 1


def test_the_key_survives_recompiling_the_same_claim_file():
    source = load_claim("eligible-claim.json")
    a = dispatcher.idempotency_key_for(manifest_mod.build(source))
    b = dispatcher.idempotency_key_for(manifest_mod.build(source))
    assert a == b


def test_the_key_changes_when_the_recipient_changes():
    source = load_claim("eligible-claim.json")
    before = dispatcher.idempotency_key_for(manifest_mod.build(source))
    source.recipient.phone_e164 = "+15005550007"
    assert dispatcher.idempotency_key_for(manifest_mod.build(source)) != before


def test_the_raw_number_never_appears_in_the_key():
    key = dispatcher.idempotency_key_for(manifest_mod.build(load_claim("eligible-claim.json")))
    assert "+15005550006" not in key


def test_live_needs_more_than_the_flag(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    monkeypatch.delenv("CLAIMCALL_ALLOW_LIVE", raising=False)
    monkeypatch.setenv("CLAIMCALL_ALLOWED_PHONE_HASHES", "")
    m, report = _plan()
    with pytest.raises(dispatcher.LiveCallBlocked, match="not allowlisted"):
        dispatcher.run(manifest=m, safety=report, live=True)


def test_live_is_blocked_without_an_api_key(monkeypatch: pytest.MonkeyPatch):
    from claimcall_core import hash_phone

    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    monkeypatch.setenv("CLAIMCALL_ALLOW_LIVE", "true")
    monkeypatch.setenv("CLAIMCALL_ALLOWED_PHONE_HASHES", hash_phone("+15005550006"))
    m, report = _plan()
    with pytest.raises(dispatcher.LiveCallBlocked, match="CALLE_API_KEY"):
        dispatcher.run(manifest=m, safety=report, live=True)
