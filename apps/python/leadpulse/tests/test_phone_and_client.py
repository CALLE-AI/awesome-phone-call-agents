import json

import httpx
import pytest

from leadpulse.client import (
    OFFICIAL_ORIGIN,
    CalleClient,
    CredentialTargetError,
    build_request,
    idempotency_key,
    place_call,
    resolve_base_url,
)
from leadpulse.phone import DestinationError, allowlist, assert_authorized, mask, mask_all, normalize_e164

ALLOWED = "+14155550142"


@pytest.mark.parametrize(
    "raw", ["(415) 555-0142", "415-555-0142", "4155550142", "1 415 555 0142", "+1 415 555 0142", ALLOWED]
)
def test_form_formats_normalize(raw):
    assert normalize_e164(raw) == ALLOWED


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "555-0142",
        "+0 415 555 0142",
        "+1415555014212345",
        "415\u0660555\u06610142",  # Arabic-Indic digits
        "\uff14\uff11\uff15\uff15\uff15\uff15\uff10\uff11\uff14\uff12",  # fullwidth digits
        "415 555 0142 ext 9",
        "1+4155550142",
    ],
)
def test_bad_numbers_are_refused(raw):
    with pytest.raises(DestinationError):
        normalize_e164(raw)


def test_empty_allowlist_authorizes_nothing():
    assert allowlist("") == set()
    with pytest.raises(DestinationError):
        assert_authorized(ALLOWED, set())


def test_allowlist_entries_must_be_strict_e164():
    with pytest.raises(DestinationError):
        allowlist("(415) 555-0142")
    assert allowlist(f" {ALLOWED} , +442079460123 ") == {ALLOWED, "+442079460123"}


def test_masking_never_returns_a_full_number():
    assert mask(ALLOWED) == "+1******0142"
    text = mask_all("Call me on +1 415 555 0142 or (415) 555-0143.")
    assert "555" not in text and "0142" in text and "0143" in text


@pytest.mark.parametrize(
    "url",
    [
        "http://api.heycall-e.com",
        "https://api.heycall-e.com.example",
        "https://user:pw@api.heycall-e.com",
        "https://api.heycall-e.com:8443",
        "https://api.heycall-e.com/v1",
        "https://api.heycall-e.com?x=1",
        "https://evil.example",
        "not a url",
    ],
)
def test_credentials_are_pinned_to_the_official_origin(url):
    with pytest.raises(CredentialTargetError):
        resolve_base_url(url)


def test_official_origin_accepted():
    assert resolve_base_url("https://api.heycall-e.com/") == OFFICIAL_ORIGIN
    assert resolve_base_url() == OFFICIAL_ORIGIN


def test_request_shape(business, form):
    req = build_request(business, form, ALLOWED)
    body = req["body"]
    assert req["idempotency_key"] == idempotency_key("lead-0001") == "leadpulse:lead:lead-0001:qualify:v1"
    assert body["recipients"] == [{"phones": [ALLOWED], "locale": "en-US", "region": "US"}]
    assert body["metadata"] == {"app": "leadpulse", "lead_id": "lead-0001"}
    assert "webhook_url" not in body
    with pytest.raises(ValueError):
        build_request(business, form, ALLOWED, webhook_url="http://insecure.example/hook")


class FakeCalle:
    """Answers the three Calls API endpoints in their documented shapes."""

    def __init__(self, statuses=("queued", "in_progress", "completed")):
        self.requests: list[httpx.Request] = []
        self.statuses = list(statuses)
        self.created: dict[str, dict] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "POST" and request.url.path == "/v1/calls":
            key = request.headers["Idempotency-Key"]
            if key not in self.created:
                self.created[key] = {"id": f"call_fake{len(self.created) + 1}", "status": "queued"}
            return httpx.Response(201, json=self.created[key])
        if request.method == "GET" and request.url.path.startswith("/v1/calls/"):
            status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
            return httpx.Response(200, json={"id": request.url.path.rsplit("/", 1)[1], "status": status})
        if request.url.path == "/v1/goals":
            ok = request.headers.get("Authorization") == "Bearer test-key"
            return httpx.Response(200 if ok else 401, json={} if ok else {"error": {"code": "unauthorized"}})
        return httpx.Response(404, json={"error": {"code": "not_found"}})

    def client(self) -> CalleClient:
        return CalleClient(api_key="test-key", transport=httpx.MockTransport(self.handler))


def test_create_sends_bearer_idempotency_and_schema(business, form, monkeypatch):
    monkeypatch.setenv("LEADPULSE_ALLOWED_DESTINATIONS", ALLOWED)
    fake = FakeCalle()
    call = place_call(business, form, client=fake.client())
    sent = fake.requests[0]
    assert call["id"] == "call_fake1"
    assert sent.url.host == "api.heycall-e.com"
    assert sent.headers["Authorization"] == "Bearer test-key"
    assert sent.headers["Idempotency-Key"] == "leadpulse:lead:lead-0001:qualify:v1"
    body = json.loads(sent.content)
    assert body["result_schema"]["additionalProperties"] is False
    assert body["recipients"][0]["phones"] == [ALLOWED]


def test_retry_returns_the_same_call(business, form, monkeypatch):
    monkeypatch.setenv("LEADPULSE_ALLOWED_DESTINATIONS", ALLOWED)
    fake = FakeCalle()
    client = fake.client()
    first = place_call(business, form, client=client)
    second = place_call(business, form, client=client)
    assert first["id"] == second["id"]
    assert len(fake.created) == 1


def test_unauthorized_destination_never_reaches_the_api(business, form, monkeypatch):
    monkeypatch.setenv("LEADPULSE_ALLOWED_DESTINATIONS", "+14155550199")
    fake = FakeCalle()
    with pytest.raises(DestinationError):
        place_call(business, form, client=fake.client())
    assert fake.requests == []


def test_missing_form_consent_never_reaches_the_api(business, form, monkeypatch):
    monkeypatch.setenv("LEADPULSE_ALLOWED_DESTINATIONS", ALLOWED)
    fake = FakeCalle()
    with pytest.raises(PermissionError):
        place_call(business, {**form, "consent_to_call": False}, client=fake.client())
    assert fake.requests == []


def test_polling_stops_at_terminal_and_never_posts():
    fake = FakeCalle(statuses=("queued", "in_progress", "completed"))
    final = fake.client().wait_for_result("call_x", interval_seconds=0, sleep=lambda s: None)
    assert final["status"] == "completed"
    assert [r.method for r in fake.requests] == ["GET", "GET", "GET"]


def test_polling_times_out_without_redialing():
    fake = FakeCalle(statuses=("in_progress",))
    with pytest.raises(TimeoutError):
        fake.client().wait_for_result("call_x", timeout_seconds=3, interval_seconds=1, sleep=lambda s: None)
    assert all(r.method == "GET" for r in fake.requests)


def test_credential_check():
    fake = FakeCalle()
    fake.client().check_credentials()
    bad = CalleClient(api_key="wrong", transport=httpx.MockTransport(fake.handler))
    with pytest.raises(Exception) as exc:
        bad.check_credentials()
    assert getattr(exc.value, "status", None) == 401


def test_client_requires_a_key():
    with pytest.raises(RuntimeError):
        CalleClient()
