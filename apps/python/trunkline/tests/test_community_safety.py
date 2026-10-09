"""Regression tests for the public demo and live submission safety boundaries."""
from __future__ import annotations

import threading
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from tests.helpers import FIXTURES_DIR, bundle_for, context, seed
from trunkline import authz, client as calle_client, console, engine, redact
from trunkline.models import CallRecord, PENDING_RECONCILIATION, load_ledger


def _start(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _stop(server):
    server.shutdown()
    server.server_close()


def test_redirect_never_forwards_the_bearer_key_to_another_origin():
    received = []

    class Target(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            received.append(self.headers.get("Authorization"))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")

    target = _start(Target)
    target_url = "http://127.0.0.1:%d/stolen" % target.server_address[1]

    class Redirect(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", target_url)
            self.end_headers()

    redirect = _start(Redirect)
    try:
        origin = "http://127.0.0.1:%d" % redirect.server_address[1]
        api = calle_client.CalleClient("super-secret-key", origin, allow_local_fake=True)
        with pytest.raises(calle_client.CalleError, match="beyond the approved origin"):
            api.get_call("call_1")
        assert received == []
    finally:
        _stop(redirect)
        _stop(target)


def test_provider_error_body_is_not_exposed():
    class ErrorResponse(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            body = b'private provider detail +12125550199 secret-body-marker'
            self.send_response(502)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = _start(ErrorResponse)
    try:
        origin = "http://127.0.0.1:%d" % server.server_address[1]
        api = calle_client.CalleClient("key", origin, allow_local_fake=True)
        with pytest.raises(calle_client.CalleError) as caught:
            api.get_call("call_1")
        message = str(caught.value)
        assert "HTTP 502" in message
        assert "secret-body-marker" not in message
        assert "+12125550199" not in message
    finally:
        _stop(server)


def test_phone_numbers_are_masked_in_provider_text():
    known = redact.build_phone_patterns(["+12125550142"])
    text = (
        "The payer line is 1 2 1 2 5 5 5 0 1 4 2 and the callback is "
        "(646) 555-0199 or +442071838750."
    )
    masked = redact.mask_phone_text(text, known)

    assert "1 2 1 2 5 5 5 0 1 4 2" not in masked
    assert "(646) 555-0199" not in masked
    assert "+442071838750" not in masked
    assert "+12*******42" in masked


def test_phone_numbers_are_masked_before_call_output_is_persisted(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    bundle = bundle_for(ctx, "claim_status")
    server = calle_client.FakeCalleServer(FIXTURES_DIR).start()
    try:
        outcome = engine.run_bundle(
            ctx, bundle, mode=engine.MODE_FIXTURE, api_key="key",
            base_url=server.base_url, fixture_scenario="claim_status_paid",
            first_poll_delay=0.0, sleep=lambda _seconds: None,
        )
    finally:
        server.stop()

    record = outcome.call
    payload = calle_client.load_fixture(FIXTURES_DIR, "claim_status_paid")
    payload["summary"] = "Call the payer at +12125550142 or (646) 555-0199"
    payload["recipients"][0]["attempts"][0]["transcript_turns"].append({
        "speaker": "agent",
        "offset_seconds": 1700,
        "text": "The number is 1 2 1 2 5 5 5 0 1 4 2 or (646) 555-0199",
    })
    engine.ingest_terminal(ctx, record, payload)
    detail = console._call_detail(ctx.ledger, record)
    rendered = str(detail) + record.summary

    assert "+12125550142" not in rendered
    assert "1 2 1 2 5 5 5 0 1 4 2" not in rendered
    assert "(646) 555-0199" not in rendered


def test_ambiguous_submission_stays_pending_reconciliation(tmp_path, monkeypatch):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    bundle = bundle_for(ctx, "claim_status")

    def fail_submission(self, request, idempotency_key):
        raise calle_client.CalleError("network response was lost")

    monkeypatch.setattr(calle_client.CalleClient, "create_call", fail_submission)
    with pytest.raises(calle_client.CalleError, match="outcome is unknown"):
        engine.run_bundle(
            ctx, bundle, mode=engine.MODE_FIXTURE, api_key="key",
            base_url="http://127.0.0.1:9", first_poll_delay=0.0,
        )

    record = ctx.ledger.calls[-1]
    assert record.status == engine.SUBMISSION_UNKNOWN
    assert record.outcome == "unknown"
    assert record.calle_call_id == ""
    assert all(ctx.ledger.claim(claim_id).state == PENDING_RECONCILIATION
               for claim_id in record.claim_ids)


def test_unresolved_live_submission_blocks_every_later_live_call(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    ctx.ledger.calls.append(CallRecord(
        id="tlcall_unknown",
        practice_id="prac_lakeshore",
        payer_id="pay_meridian",
        workflow="claim_status",
        claim_ids=[],
        mode=engine.MODE_LIVE,
        status=engine.SUBMISSION_UNKNOWN,
    ))
    cascade = ctx.ledger.payer("pay_cascade")
    authz.write(
        data, payer_id=cascade.id, phone=cascade.phone, region=cascade.region,
        until=(date.today() + timedelta(days=10)).isoformat(), max_calls=3,
    )

    reasons = engine.suppression_for(
        ctx, bundle_for(ctx, "claim_status", "pay_cascade"), engine.MODE_LIVE,
    )
    assert "pending_reconciliation" in reasons


def test_unknown_submission_can_attach_a_provider_id_and_reconcile(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    bundle = bundle_for(ctx, "claim_status")
    record = CallRecord(
        id="tlcall_unknown",
        practice_id="prac_lakeshore",
        payer_id="pay_meridian",
        workflow="claim_status",
        claim_ids=bundle.claim_ids,
        mode=engine.MODE_FIXTURE,
        status=engine.SUBMISSION_UNKNOWN,
        idempotency_key="same-key",
    )
    ctx.ledger.calls.append(record)
    for claim in bundle.claims:
        claim.state = PENDING_RECONCILIATION
        claim.call_ids.append(record.id)
    ctx.save()

    server = calle_client.FakeCalleServer(FIXTURES_DIR).start()
    try:
        api = calle_client.CalleClient("key", server.base_url, allow_local_fake=True)
        created = api.create_call(
            {"task": "fixture", "recipients": [], "metadata": {
                "fixture_scenario": "claim_status_paid",
            }},
            "same-key",
        )
        first = engine.reconcile(
            ctx, record, api_key="key", base_url=server.base_url,
            allow_local_fake=True, provider_call_id=created["id"],
        )
        second = engine.reconcile(
            ctx, record, api_key="key", base_url=server.base_url,
            allow_local_fake=True,
        )
    finally:
        server.stop()

    assert first is None
    assert second is not None
    assert record.calle_call_id == created["id"]
    assert record.status == "completed"
    assert ctx.ledger.calls_placed == 1


def test_public_demo_uses_only_a_fresh_synthetic_ledger(tmp_path):
    data = str(tmp_path)
    seed(data)
    local = load_ledger(data)
    local.practices[0].name = "Private Practice That Must Not Be Served"

    public_directory = console._synthetic_public_data()
    try:
        public = load_ledger(public_directory.name)
        assert public_directory.name != data
        assert public.practices[0].name == "Lakeshore Family Medicine"
        assert all("55501" in payer.phone for payer in public.payers)
        assert not console._public_write_allowed("/add-claim")
        assert console._public_write_allowed("/call")
    finally:
        public_directory.cleanup()
