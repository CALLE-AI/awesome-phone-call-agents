"""The full cycle: suppression, dialling, verification, scrubbing, persistence."""
from __future__ import annotations

import os
from datetime import date, timedelta

import pytest

from tests.helpers import FIXTURES_DIR, bundle_for, context, every_file_under, run, seed
from trunkline import audit, authz, client as calle_client, engine, redact, vault, workqueue
from trunkline.models import ANSWERED, CLOSED, NEEDS_HUMAN, PENDING_RECONCILIATION, QUEUED


def test_a_good_call_answers_every_claim_on_it(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")

    assert outcome.call.outcome == "answered"
    assert outcome.call.hold_seconds == 1420
    assert outcome.call.talk_seconds == 265
    assert outcome.call.reference_number == "MHP-REF-88417203"
    for claim_id in outcome.call.claim_ids:
        assert ctx.ledger.claim(claim_id).state == ANSWERED


def test_no_patient_identifier_survives_a_call(tmp_path):
    """The call said the member id out loud. Nothing Trunkline wrote may contain it."""
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")

    record = vault.get(data, "pt_0001")
    secrets = [value for value in record.values() if value]
    assert record["member_id"] and record["date_of_birth"]

    written = every_file_under(data, skip_dirs=[vault.vault_dir(data)])
    assert written, "the run should have written something"
    for path in written:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
        for secret in secrets:
            assert not redact.contains_any(text, [secret]), "%s leaked %r" % (path, secret[:3] + "...")


def test_the_transcript_is_kept_and_visibly_redacted(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")

    spoken = " ".join(turn["text"] for turn in outcome.call.transcript)
    assert len(outcome.call.transcript) > 10, "the transcript must still be there"
    assert redact.REDACTION in spoken, "identifiers should be replaced, not silently dropped"
    # Claim numbers are business identifiers the biller needs, and are kept.
    assert "004612" in spoken.replace(" ", "")


def test_a_fabricated_quote_sends_only_that_claim_to_a_human(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = run(ctx, bundle_for(ctx, "claim_status"), "ungrounded_evidence")

    states = {ctx.ledger.claim(cid).claim_number: ctx.ledger.claim(cid).state
              for cid in outcome.call.claim_ids}
    assert states["CLM-2026-004612"] == NEEDS_HUMAN
    assert states["CLM-2026-004417"] == ANSWERED


def test_an_out_of_schema_result_sends_the_whole_call_to_a_human(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = run(ctx, bundle_for(ctx, "claim_status"), "schema_violation")
    assert outcome.call.outcome == "unusable"
    for claim_id in outcome.call.claim_ids:
        assert ctx.ledger.claim(claim_id).state == NEEDS_HUMAN


def test_preview_mode_places_no_call(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = engine.run_bundle(ctx, bundle_for(ctx, "claim_status"), mode=engine.MODE_PREVIEW)
    assert outcome.call is None
    assert outcome.plan is not None
    assert ctx.ledger.calls_placed == 0
    for claim in ctx.ledger.claims:
        assert claim.state == QUEUED


def test_the_kill_switch_refuses_everything(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    with open(engine.kill_switch_path(data), "w", encoding="utf-8") as handle:
        handle.write("stop\n")
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_FIXTURE)
    assert "kill_switch" in reasons


def test_live_mode_refuses_without_an_authorization_record(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_LIVE)
    assert "no_authorization" in reasons


def test_live_mode_refuses_when_the_number_no_longer_matches(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    authz.write(data, payer_id="pay_meridian", phone="+12125550142", region="US",
                until=(date.today() + timedelta(days=10)).isoformat(), max_calls=3)
    ctx.ledger.payer("pay_meridian").phone = "+12125550199"
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_LIVE)
    assert "authorization_mismatch" in reasons


def test_live_mode_is_allowed_once_authorized(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    authz.write(data, payer_id="pay_meridian", phone="+12125550142", region="US",
                until=(date.today() + timedelta(days=10)).isoformat(), max_calls=3)
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_LIVE)
    assert reasons == []


def test_the_cost_cap_refuses_a_bundle_worth_less_than_the_call(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    bundle = bundle_for(ctx, "claim_status")
    for claim in bundle.claims:
        claim.billed_amount = 3.0
    reasons = engine.suppression_for(ctx, bundle, engine.MODE_FIXTURE)
    assert "cost_cap_exceeded" in reasons


def test_the_hold_budget_stops_a_run(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data, hold_budget_minutes=10)
    ctx.ledger.hold_seconds_used = 11 * 60
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_FIXTURE)
    assert "hold_budget_exhausted" in reasons


def test_a_claim_without_a_vault_record_is_never_called_about(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    os.remove(os.path.join(vault.vault_dir(data), "pt_0001.json"))
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_FIXTURE)
    assert "no_vault_record" in reasons


def test_the_calling_window_is_enforced_unless_overridden(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    ctx.config.ignore_window = False
    ctx.ledger.payer("pay_meridian").call_window = "00:00-00:01"
    reasons = engine.suppression_for(ctx, bundle_for(ctx, "claim_status"), engine.MODE_FIXTURE)
    assert "outside_call_window" in reasons


def test_clearing_a_stuck_call_returns_its_claims_to_the_queue(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")
    record = outcome.call
    for claim_id in record.claim_ids:
        ctx.ledger.claim(claim_id).state = PENDING_RECONCILIATION
    engine.clear_pending(ctx, record)
    for claim_id in record.claim_ids:
        assert ctx.ledger.claim(claim_id).state == QUEUED


def test_approval_is_required_before_a_claim_closes(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    outcome = run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")
    claim = ctx.ledger.claim(outcome.call.claim_ids[0])
    assert claim.state == ANSWERED
    engine.approve(ctx, claim, note="checked")
    assert claim.state == CLOSED
    with pytest.raises(engine.EngineError):
        engine.approve(ctx, claim)


def test_an_idempotency_key_stops_a_duplicate_call(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    server = calle_client.FakeCalleServer(FIXTURES_DIR).start()
    try:
        api = calle_client.CalleClient("k", server.base_url, allow_local_fake=True)
        request = {"task": "t", "recipients": [], "metadata": {"fixture_scenario": "claim_status_paid"}}
        first = api.create_call(request, "same-key")
        second = api.create_call(request, "same-key")
        assert first["id"] == second["id"]
    finally:
        server.stop()


def test_the_api_key_only_goes_to_the_official_origin():
    with pytest.raises(calle_client.CalleError):
        calle_client.CalleClient("k", "https://not-calle.example.com")
    with pytest.raises(calle_client.CalleError):
        calle_client.CalleClient("k", "http://127.0.0.1:9/", allow_local_fake=False)
    assert calle_client.CalleClient("k", "http://127.0.0.1:9", allow_local_fake=True)


def test_a_missing_key_is_refused_before_any_request():
    with pytest.raises(calle_client.CalleError):
        calle_client.CalleClient("")
