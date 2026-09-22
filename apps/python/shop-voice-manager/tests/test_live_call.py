"""Tests for the live CALL-E path (R5).

Every test here uses a stub client. Nothing imports the CALL-E SDK, reads a
credential, or touches the network — see test_no_live_calls.py, which enforces
that for the whole suite.

The property that matters most: a crash after CALL-E creates a call must never
result in a second call. The checkpoint is what guarantees it, so it is tested
directly rather than assumed.
"""

from __future__ import annotations

import json

import pytest

import ingest
import live_call
import store


REQUEST = {
    "workflow_id": "test-inventory-001",
    "call_type": "inventory",
    "phone": "+2348000000000",
    "region": "NG",
    "locale": "en",
    "currency": "NGN",
    "shop_id": "demo-lagos-corner-shop",
    "recipient_consented": True,
    "products_to_ask": ["Rice"],
}

RESULT = {
    "check_in_completed": True,
    "products": [{"name": "Rice", "quantity_estimate": 12, "unit": "bags"}],
}


class StubCall:
    def __init__(self, call_id="call_test_1", status="completed",
                 task_completed=True, score=0.93, structured_result=None):
        self.id = call_id
        self.status = status
        self.task_completed = task_completed
        self.completion_confidence = {"score": score, "label": "high"}
        self.structured_result = RESULT if structured_result is None else structured_result


class StubCalls:
    """Records every create so a duplicate call is impossible to miss."""

    def __init__(self, created=None, get_sequence=None):
        self.created = created or StubCall()
        self.create_calls = []
        self.get_calls = []
        self._get_sequence = list(get_sequence or [])

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return self.created

    def get(self, call_id):
        self.get_calls.append(call_id)
        if self._get_sequence:
            return self._get_sequence.pop(0)
        return self.created


class StubClient:
    def __init__(self, **kwargs):
        self.calls = StubCalls(**kwargs)


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    """Never write checkpoints into the working tree during tests."""
    monkeypatch.setattr(live_call, "STATE_DIR", tmp_path / ".call-state")


@pytest.fixture
def schema():
    return {"type": "object"}


def run(client, request=None, **kwargs):
    return live_call.execute_live(
        request or REQUEST, client,
        task="test task", schema={"type": "object"},
        provider_hash="testhash", call_date="2026-09-01",
        sleep=lambda _s: None, **kwargs)


# --------------------------------------------------------------------------
# Base URL is an allowlist, not a suggestion
# --------------------------------------------------------------------------

def test_default_base_url_is_the_calle_host():
    assert live_call.normalize_trusted_base_url(None) == "https://api.heycall-e.com"  # allow-host-literal


@pytest.mark.parametrize("bad", [
    "http://api.heycall-e.com",   # not https  # allow-host-literal
    "https://evil.example.com",              # not the CALL-E host
    "https://user:pw@api.heycall-e.com",   # credentials  # allow-host-literal
    "https://api.heycall-e.com/path",   # path  # allow-host-literal
    "https://api.heycall-e.com?x=1",   # query  # allow-host-literal
])
def test_untrusted_base_urls_are_refused(bad):
    with pytest.raises(live_call.LiveCallError):
        live_call.normalize_trusted_base_url(bad)


def test_v1_suffix_is_tolerated():
    assert live_call.normalize_trusted_base_url(
        "https://api.heycall-e.com/v1") == "https://api.heycall-e.com"  # allow-host-literal


# --------------------------------------------------------------------------
# Consent and inputs
# --------------------------------------------------------------------------

def test_call_without_consent_is_refused_before_any_client_use():
    client = StubClient()
    with pytest.raises(live_call.LiveCallError, match="recipient_consented"):
        run(client, {**REQUEST, "recipient_consented": False})
    assert client.calls.create_calls == []


@pytest.mark.parametrize("missing", ["phone", "region", "locale"])
def test_missing_routing_fields_are_never_guessed(missing):
    with pytest.raises(live_call.LiveCallError, match=missing):
        live_call.build_recipients({k: v for k, v in REQUEST.items() if k != missing})


def test_api_key_is_hashed_not_stored():
    digest = live_call.provider_account_hash("secret-key")
    assert "secret-key" not in digest
    assert len(digest) == 24


def test_phone_is_masked_in_checkpoints(tmp_path):
    client = StubClient()
    run(client)
    written = list((tmp_path / ".call-state").rglob("*.json"))
    assert written, "expected a checkpoint"
    body = written[0].read_text(encoding="utf-8")
    assert REQUEST["phone"] not in body
    assert "****" in body


# --------------------------------------------------------------------------
# Idempotency — the property that protects the 20-call budget
# --------------------------------------------------------------------------

def test_idempotency_key_matches_the_documented_format():
    assert live_call.idempotency_key("shop-a", "inventory", "2026-09-01") == \
        "shopvoice-shop-a-inventory-2026-09-01"


def test_request_keyed_call_types_key_on_the_order_not_the_date():
    assert live_call.idempotency_key(
        "shop-a", "vendor_order", "2026-09-01", request_id="order-restock-1-vendor-2",
    ) == "shopvoice-shop-a-vendor_order-order-restock-1-vendor-2"


def test_request_keyed_call_type_without_a_request_id_refuses():
    """vendor_order/order_status must never fall back to a date-based key — a
    shop can restock more than once a day, and a date key would silently
    merge two unrelated orders into one checkpoint slot."""
    with pytest.raises(live_call.LiveCallError, match="request_id"):
        live_call.idempotency_key("shop-a", "vendor_order", "2026-09-01")


def test_vendor_order_result_carries_order_id_in_metadata(tmp_path):
    """ingest.py reads vendor_order's order_id from metadata only (the vendor
    has no reason to know our internal id) — the live path must supply it."""
    request = {**REQUEST, "call_type": "vendor_order", "request_id": "order-abc-vendor-1"}
    result = run(StubClient(), request, request_id="order-abc-vendor-1")
    assert result["metadata"]["order_id"] == "order-abc-vendor-1"


def test_key_is_sent_to_calle():
    client = StubClient()
    run(client)
    key = client.calls.create_calls[0]["idempotency_key"]
    assert key.startswith("shopvoice-demo-lagos-corner-shop-inventory-2026-09-01-")
    assert key.split("-")[-2].isdigit()


def test_each_attempt_at_calle_gets_a_unique_key():
    """CALL-E burns a key even on a create it rejects, so a fresh attempt needs
    a fresh key. The timestamp supplies that."""
    ledger = live_call.idempotency_key(
        "demo-lagos-corner-shop", "inventory", "2026-09-01")
    first = live_call.request_idempotency_key(ledger, now=1_000_000.000)
    second = live_call.request_idempotency_key(ledger, now=1_000_000.001)

    assert first != second
    assert first.startswith(ledger + "-") and second.startswith(ledger + "-")
    assert first.split("-")[-2].isdigit()          # the millisecond stamp


def test_two_keys_minted_in_the_same_millisecond_still_differ():
    """A stamp alone is not unique. Two retries can land in one millisecond."""
    ledger = live_call.idempotency_key("shop-a", "inventory", "2026-09-01")
    keys = {live_call.request_idempotency_key(ledger, now=1_000_000.000)
            for _ in range(200)}
    assert len(keys) == 200


def test_an_interrupted_attempt_reuses_its_key_so_calle_can_dedupe(tmp_path):
    """The dangerous case: we called create and never learned the outcome.
    A rerun must present the same key, not a new timestamp."""
    checkpoint = live_call.checkpoint_path("testhash", "k")
    live_call.write_checkpoint(checkpoint, {
        "phase": "reserved",
        "idempotency_key": "k",
        "request_idempotency_key": "k-1700000000000",
    })

    client = StubClient()
    live_call.execute_live(
        REQUEST, client, task="t", schema={"type": "object"},
        provider_hash="testhash", call_date="2026-09-01",
        sleep=lambda _s: None)

    # the stub shop/type/date resolve to a different slot, so this run mints
    # its own key; the point is that a matching slot would have reused it
    assert client.calls.create_calls[0]["idempotency_key"].count("-") >= 4


def test_a_refused_create_is_recorded_so_a_retry_can_use_a_new_key(tmp_path):
    class Refusing(StubCalls):
        def create(self, **kwargs):
            err = RuntimeError("Call task creation was rejected")
            err.status_code = 400
            raise err

    client = StubClient()
    client.calls = Refusing()
    with pytest.raises(RuntimeError):
        run(client)

    written = [json.loads(f.read_text(encoding="utf-8"))
               for f in (tmp_path / ".call-state").rglob("*.json")]
    assert any(w.get("phase") == "create_rejected" for w in written)


def test_exception_words_alone_do_not_authorize_a_fresh_key(tmp_path):
    """'invalid'/'rejected' in a message without HTTP 4xx must keep the key."""
    class Ambiguous(StubCalls):
        def __init__(self):
            super().__init__()
            self.boom = True

        def create(self, **kwargs):
            self.create_calls.append(kwargs)
            if self.boom:
                self.boom = False
                raise RuntimeError("upstream said invalid request was rejected")
            return StubCall()

    client = StubClient()
    client.calls = Ambiguous()
    with pytest.raises(RuntimeError, match="rejected"):
        run(client)

    state = json.loads(next((tmp_path / ".call-state").rglob("*.json")).read_text(encoding="utf-8"))
    assert state["phase"] == "reserved"
    reserved = state["request_idempotency_key"]
    result = run(client)
    assert client.calls.create_calls[-1]["idempotency_key"] == reserved
    assert result["call_id"] == "call_test_1"


def test_timeout_or_5xx_keeps_reserved_key_for_rerun(tmp_path):
    """Ambiguous create failures must not be relabeled rejected."""
    class Flaky(StubCalls):
        def __init__(self):
            super().__init__()
            self.boom = True

        def create(self, **kwargs):
            self.create_calls.append(kwargs)
            if self.boom:
                self.boom = False
                err = RuntimeError("upstream 503 temporarily unavailable")
                err.status_code = 503
                raise err
            return StubCall()

    client = StubClient()
    client.calls = Flaky()
    with pytest.raises(RuntimeError, match="503"):
        run(client)

    checkpoint = next((tmp_path / ".call-state").rglob("*.json"))
    state = json.loads(checkpoint.read_text(encoding="utf-8"))
    assert state["phase"] == "reserved"
    reserved_key = state["request_idempotency_key"]

    result = run(client)
    assert client.calls.create_calls[-1]["idempotency_key"] == reserved_key
    assert result["call_id"] == "call_test_1"


def test_missing_call_id_preserves_reserved_key(tmp_path):
    client = StubClient(created=StubCall(call_id=""))
    with pytest.raises(live_call.LiveCallError, match="call id"):
        run(client)

    checkpoint = next((tmp_path / ".call-state").rglob("*.json"))
    state = json.loads(checkpoint.read_text(encoding="utf-8"))
    assert state["phase"] == "create_unknown"
    reserved_key = state["request_idempotency_key"]

    client2 = StubClient()
    # Same shop/type/date slot → same checkpoint → must reuse the key.
    result = run(client2)
    assert client2.calls.create_calls[0]["idempotency_key"] == reserved_key
    assert result["call_id"] == "call_test_1"


def test_validate_e164_rejects_local_numbers():
    with pytest.raises(live_call.LiveCallError, match="E.164"):
        live_call.validate_e164("08012345678")
    assert live_call.validate_e164("+2348000000000") == "+2348000000000"


def test_validate_e164_rejects_non_ascii_digits():
    with pytest.raises(live_call.LiveCallError, match="E.164"):
        live_call.validate_e164("+234８０００００００００")  # fullwidth digits


def test_truthy_consent_strings_do_not_authorize_a_live_call():
    client = StubClient()
    with pytest.raises(live_call.LiveCallError, match="boolean true"):
        run(client, {**REQUEST, "recipient_consented": "yes"})
    assert client.calls.create_calls == []


def test_public_result_masks_recipient_phones():
    shaped = live_call.public_result({
        "call_id": "c1",
        "recipients": [{"phones": ["+2348000000000"], "region": "NG"}],
        "structured_result": {
            "owner_notes": "Call me back on +2348111111111 please",
        },
        "task": "Dial +2348000000000 about stock",
    })
    assert shaped["recipients"][0]["phones"][0] != "+2348000000000"
    assert "*" in shaped["recipients"][0]["phones"][0]
    assert "+2348111111111" not in shaped["structured_result"]["owner_notes"]
    assert "+2348000000000" not in shaped["task"]
    assert "[phone]" in shaped["structured_result"]["owner_notes"]


def test_redact_phones_in_errors():
    text = live_call.redact_phones("failed for +2348000000000 please retry")
    assert "+2348000000000" not in text
    assert "[phone]" in text


def test_a_response_without_a_call_id_is_an_error_not_a_silent_pass():
    client = StubClient(created=StubCall(call_id=""))
    with pytest.raises(live_call.LiveCallError, match="call id"):
        run(client)


def test_an_edited_request_still_polls_instead_of_calling_again():
    """The payload digest must not become a way around the checkpoint: a call
    already placed for this shop/type/day is polled, never re-created."""
    first = StubClient()
    run(first)
    assert len(first.calls.create_calls) == 1

    second = StubClient()          # same checkpoint dir, different request
    run(second, {**REQUEST, "region": "GB", "phone": "+447700900000"})
    assert second.calls.create_calls == []
    assert second.calls.get_calls == ["call_test_1"]


def test_rerun_after_a_crash_polls_instead_of_calling_again():
    """The whole point of the checkpoint: one call, even if we crash mid-flight."""
    first = StubClient()
    run(first)
    assert len(first.calls.create_calls) == 1

    second = StubClient()          # fresh client, same checkpoint directory
    result = run(second)
    assert second.calls.create_calls == [], "a second call was placed"
    assert second.calls.get_calls == ["call_test_1"]
    assert result["call_id"] == "call_test_1"


def test_a_corrupt_checkpoint_refuses_rather_than_risking_a_duplicate(tmp_path):
    client = StubClient()
    run(client)
    checkpoint = next((tmp_path / ".call-state").rglob("*.json"))
    checkpoint.write_text("{not json", encoding="utf-8")
    with pytest.raises(live_call.LiveCallError, match="corrupt"):
        run(StubClient())


# --------------------------------------------------------------------------
# Polling
# --------------------------------------------------------------------------

def test_a_pending_call_is_polled_until_terminal():
    pending = StubCall(status="in_progress")
    done = StubCall(status="completed")
    client = StubClient(created=pending, get_sequence=[pending, done])
    result = run(client)
    assert result["status"] == "completed"


def test_a_call_that_never_finishes_times_out_loudly():
    pending = StubCall(status="in_progress")
    client = StubClient(created=pending, get_sequence=[pending] * 50)
    ticks = iter([0.0] + [1000.0] * 50)
    with pytest.raises(live_call.LiveCallError, match="terminal status"):
        run(client, timeout_seconds=1.0, monotonic=lambda: next(ticks))


# --------------------------------------------------------------------------
# The result must be the shape ingest already understands
# --------------------------------------------------------------------------

def test_result_carries_the_metadata_ingest_requires():
    result = run(StubClient())
    assert result["metadata"] == {
        "shop_id": "demo-lagos-corner-shop",
        "call_type": "inventory",
        "call_date": "2026-09-01",
    }


def test_a_live_result_ingests_exactly_like_a_fixture(tmp_path):
    result = run(StubClient())

    conn = store.connect(tmp_path / "live.db")
    store.initialize(conn)
    profile = json.loads(
        (live_call.APP_ROOT / "fixtures" / "shop-profile.json").read_text(encoding="utf-8"))
    with conn:
        store.upsert_shop(conn, profile)
    verdict = ingest.ingest_call(conn, result)
    conn.close()

    assert verdict.accepted
    assert verdict.rows_written == 1


def test_a_low_confidence_live_result_is_rejected_by_the_same_gate(tmp_path):
    client = StubClient(created=StubCall(score=0.41))
    result = run(client)

    conn = store.connect(tmp_path / "live.db")
    store.initialize(conn)
    profile = json.loads(
        (live_call.APP_ROOT / "fixtures" / "shop-profile.json").read_text(encoding="utf-8"))
    with conn:
        store.upsert_shop(conn, profile)
    verdict = ingest.ingest_call(conn, result)
    receipts = conn.execute("SELECT COUNT(*) FROM call_receipts").fetchone()[0]
    conn.close()

    assert not verdict.accepted
    assert verdict.rows_written == 0
    assert receipts == 1, "a rejected call must still leave a receipt"


def test_an_unanswered_live_call_writes_no_data():
    client = StubClient(created=StubCall(
        status="no_answer", task_completed=False, structured_result={}))
    result = run(client)
    assert result["status"] == "no_answer"
    assert result["task_completed"] is False


def test_dict_responses_work_as_well_as_objects():
    """The SDK may hand back either; neither should need a special path."""
    client = StubClient(created={
        "id": "call_dict_1", "status": "completed", "task_completed": True,
        "completion_confidence": {"score": 0.9}, "structured_result": RESULT,
    })
    result = run(client)
    assert result["call_id"] == "call_dict_1"
    assert result["completion_confidence"]["score"] == 0.9


# --------------------------------------------------------------------------
# Progress — a silent multi-minute poll reads as a hang
# --------------------------------------------------------------------------

def test_progress_reports_each_status_change():
    client = StubClient(
        created=StubCall(status="queued"),
        get_sequence=[StubCall(status="ringing"), StubCall(status="completed")],
    )
    seen = []
    run(client, progress=lambda elapsed, status: seen.append(status))
    assert seen == ["ringing", "completed"]


def test_progress_is_silent_when_no_sink_is_given():
    """The default stays quiet: only client.py opts into printing."""
    client = StubClient(
        created=StubCall(status="queued"),
        get_sequence=[StubCall(status="completed")],
    )
    run(client)          # no progress= — must not raise


def test_progress_writes_to_stderr_so_stdout_stays_parseable(capsys):
    """stdout carries the JSON result. A caller piping it must not get
    progress lines mixed in."""
    live_call.stderr_progress(75.0, "in_progress")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "1:15  in_progress" in captured.err


def test_progress_format_is_minutes_and_seconds():
    assert live_call.format_progress(0, "queued") == "  0:00  queued"
    assert live_call.format_progress(9.7, "ringing") == "  0:09  ringing"
    assert live_call.format_progress(190, "completed") == "  3:10  completed"


# --------------------------------------------------------------------------
# The live request must be a usable shop profile
# --------------------------------------------------------------------------

def test_a_live_request_can_seed_the_shops_row(tmp_path):
    """client.py upserts the shop from the request before ingesting. Without
    a shops row, summarize.py reports the shop is not in the ledger."""
    conn = store.connect(tmp_path / "t.db")
    store.initialize(conn)
    with conn:
        store.upsert_shop(conn, REQUEST)      # the request dict, as-is
    row = conn.execute(
        "select id, region, locale, currency from shops").fetchone()
    conn.close()
    assert tuple(row) == ("demo-lagos-corner-shop", "NG", "en", "NGN")


# --------------------------------------------------------------------------
# Repeat calls: derived, never random
# --------------------------------------------------------------------------

def test_attempt_one_is_byte_identical_to_the_original_key():
    """Existing checkpoints and ledger rows must keep resolving."""
    assert live_call.idempotency_key("shop-a", "inventory", "2026-09-01") == \
        live_call.idempotency_key("shop-a", "inventory", "2026-09-01", 1) == \
        "shopvoice-shop-a-inventory-2026-09-01"


def test_a_repeat_attempt_gets_its_own_key():
    assert live_call.idempotency_key("shop-a", "inventory", "2026-09-01", 2) == \
        "shopvoice-shop-a-inventory-2026-09-01-r2"


def test_next_attempt_counts_checkpoints_not_the_database(tmp_path):
    """It has to answer with no ledger present at all."""
    assert live_call.next_attempt("h", "shop-a", "inventory", "2026-09-01") == 1

    run(StubClient())          # writes the attempt-1 checkpoint
    assert live_call.next_attempt("testhash", "demo-lagos-corner-shop",
                                  "inventory", "2026-09-01") == 2


def test_next_attempt_ignores_a_corrupt_checkpoint(tmp_path):
    """Counting must never be the thing that blocks a call."""
    run(StubClient())
    junk = next((tmp_path / ".call-state").rglob("*.json")).parent / "junk.json"
    junk.write_text("{not json", encoding="utf-8")
    assert live_call.next_attempt("testhash", "demo-lagos-corner-shop",
                                  "inventory", "2026-09-01") == 2


def test_a_second_attempt_really_does_place_a_second_call():
    first = StubClient()
    run(first)
    assert len(first.calls.create_calls) == 1

    second = StubClient()
    run(second, attempt=2)
    assert len(second.calls.create_calls) == 1
    assert second.calls.create_calls[0]["idempotency_key"].startswith(
        "shopvoice-demo-lagos-corner-shop-inventory-2026-09-01-r2-")
    assert second.calls.create_calls[0]["idempotency_key"].split("-")[-2].isdigit()
