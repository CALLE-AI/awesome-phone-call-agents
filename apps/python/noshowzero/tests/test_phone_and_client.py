import json

import httpx
import pytest

from noshowzero import client as client_mod
from noshowzero.client import (
    CalleClient, CredentialTargetError, build_offer_request, build_reminder_request, offer_key,
    place_offer_call, place_reminder_call, reminder_key, resolve_base_url,
)
from noshowzero.phone import DestinationError, allowlist, assert_authorized, mask, mask_all, normalize_e164


# ── phone numbers ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["(212) 555-0116", "212-555-0116", "+1 212 555 0116", "1 212 555 0116"])
def test_typed_numbers_normalize(raw):
    assert normalize_e164(raw) == "+12125550116"


ARABIC_INDIC = "٢١٢ 555 0116"
FULLWIDTH = "２１２５５５０１１６"


@pytest.mark.parametrize("raw", ["", "212-555-01l6", "ext 5550116", "212+5550116", ARABIC_INDIC, FULLWIDTH, "555-0116"])
def test_ambiguous_or_confusable_numbers_are_refused(raw):
    with pytest.raises(DestinationError):
        normalize_e164(raw)


def test_masking_never_reveals_a_full_number():
    assert mask("+12125550116") == "+1******0116"
    assert "5550116" not in mask_all("call me on (212) 555-0116 please")


def test_empty_allowlist_authorizes_nothing():
    assert allowlist("") == set()
    with pytest.raises(DestinationError):
        assert_authorized("+12125550116", set())


def test_allowlist_entries_must_be_strict_e164():
    with pytest.raises(DestinationError):
        allowlist("(212) 555-0116")


# ── origin pinning ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", ["https://api.heycall-e.com", "https://api.heycall-e.com/", "https://api.heycall-e.com:443"])
def test_official_origin_is_accepted(url):
    assert resolve_base_url(url) == "https://api.heycall-e.com"


@pytest.mark.parametrize("url", ["http://api.heycall-e.com", "https://api.heycall-e.com.example",
                                 "https://user@api.heycall-e.com", "https://api.heycall-e.com:8443",
                                 "https://api.heycall-e.com/v1", "https://api.heycall-e.com?x=1", "https://evil.test"])
def test_the_key_is_never_sent_elsewhere(url):
    with pytest.raises(CredentialTargetError):
        resolve_base_url(url)


# ── requests ─────────────────────────────────────────────────────────────────

def test_reminder_request_shape(clinic, appointment):
    req = build_reminder_request(clinic, appointment, "+12125550116", "24h")
    body = req["body"]
    assert req["idempotency_key"] == "noshowzero:appointment:appt-1042:reminder:24h:v1"
    assert body["recipients"] == [{"phones": ["+12125550116"], "locale": "en-US", "region": "US"}]
    assert body["metadata"]["kind"] == "reminder" and body["metadata"]["reminder_window"] == "24h"
    assert body["result_schema"]["properties"]["outcome"]["enum"][0] == "confirmed"
    assert "webhook_url" not in body


def test_offer_request_shape(clinic, waitlist, appointment):
    olivia = waitlist[3]
    req = build_offer_request(clinic, olivia, "+12125550199", slot_id="appt-1042",
                              slot_at=appointment["appointment_at"], service_type="Dental Cleaning")
    assert req["idempotency_key"] == "noshowzero:waitlist:wl-204:slot:appt-1042:offer:v1"
    assert req["body"]["metadata"] == {"app": "noshowzero", "kind": "waitlist_offer", "clinic_id": "clinic-bright-smile",
                                       "entry_id": "wl-204", "slot_id": "appt-1042",
                                       "slot_at": appointment["appointment_at"]}


def test_keys_are_stable_across_retries():
    assert reminder_key("a1", "2h") == reminder_key("a1", "2h") != reminder_key("a1", "24h")
    assert offer_key("w1", "s1") == offer_key("w1", "s1") != offer_key("w2", "s1")


def test_unknown_window_and_plain_http_webhook_are_refused(clinic, appointment):
    with pytest.raises(ValueError):
        build_reminder_request(clinic, appointment, "+12125550116", "48h")
    with pytest.raises(ValueError):
        build_reminder_request(clinic, appointment, "+12125550116", "24h", webhook_url="http://example.com/hook")


# ── placing calls ────────────────────────────────────────────────────────────

class Recorder:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]


def _client(recorder):
    return CalleClient(api_key="iams_test_not_real", transport=httpx.MockTransport(recorder))


def test_off_allowlist_number_is_refused_before_any_client_is_built(clinic, appointment, monkeypatch):
    monkeypatch.setattr(client_mod, "CalleClient", lambda *a, **k: pytest.fail("client must not be built"))
    with pytest.raises(DestinationError):
        place_reminder_call(clinic, appointment, "24h")


def test_missing_patient_consent_is_refused(clinic, appointment, monkeypatch):
    monkeypatch.setenv("NOSHOWZERO_ALLOWED_DESTINATIONS", "+12125550116")
    monkeypatch.setattr(client_mod, "CalleClient", lambda *a, **k: pytest.fail("client must not be built"))
    with pytest.raises(PermissionError):
        place_reminder_call(clinic, appointment | {"consent_to_call": False}, "24h")


def test_waitlist_patient_without_consent_is_never_offered(clinic, waitlist, monkeypatch):
    monkeypatch.setenv("NOSHOWZERO_ALLOWED_DESTINATIONS", "+12125550134")
    with pytest.raises(PermissionError):
        place_offer_call(clinic, waitlist[2], slot_id="s", slot_at="2026-09-11T20:30:00Z", service_type="Dental Cleaning",
                         client=_client(Recorder([httpx.Response(500)])))


def test_authorized_reminder_posts_once_with_idempotency_key(clinic, appointment, monkeypatch):
    monkeypatch.setenv("NOSHOWZERO_ALLOWED_DESTINATIONS", "+12125550116")
    rec = Recorder([httpx.Response(201, json={"id": "call_x", "status": "queued"})])
    call = place_reminder_call(clinic, appointment, "24h", client=_client(rec))
    assert call["id"] == "call_x"
    (req,) = rec.requests
    assert req.method == "POST" and req.url.path == "/v1/calls"
    assert req.headers["Idempotency-Key"] == "noshowzero:appointment:appt-1042:reminder:24h:v1"
    assert req.headers["Authorization"] == "Bearer iams_test_not_real"
    assert json.loads(req.content)["recipients"][0]["phones"] == ["+12125550116"]


def test_polling_only_reads(reminder_call):
    in_progress = reminder_call | {"status": "in_progress"}
    rec = Recorder([httpx.Response(200, json=in_progress), httpx.Response(200, json=in_progress),
                    httpx.Response(200, json=reminder_call)])
    final = _client(rec).wait_for_result("call_fictional0reminder0001", sleep=lambda s: None)
    assert final["status"] == "completed"
    assert {r.method for r in rec.requests} == {"GET"}


def test_polling_times_out_without_redialing(reminder_call):
    rec = Recorder([httpx.Response(200, json=reminder_call | {"status": "in_progress"})])
    with pytest.raises(TimeoutError):
        _client(rec).wait_for_result("call_x", timeout_seconds=10, interval_seconds=5, sleep=lambda s: None)
    assert all(r.method == "GET" for r in rec.requests)


def test_api_errors_carry_code_not_body(clinic, appointment, monkeypatch):
    monkeypatch.setenv("NOSHOWZERO_ALLOWED_DESTINATIONS", "+12125550116")
    rec = Recorder([httpx.Response(400, json={"error": {"code": "invalid_phone", "message": "phone must be an E.164 number."}})])
    with pytest.raises(client_mod.CalleAPIError) as exc:
        place_reminder_call(clinic, appointment, "24h", client=_client(rec))
    assert exc.value.status == 400 and exc.value.code == "invalid_phone"


def test_missing_key_is_an_error():
    with pytest.raises(RuntimeError):
        CalleClient()
