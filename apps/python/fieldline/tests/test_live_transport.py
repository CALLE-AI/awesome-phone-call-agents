"""Offline fail-closed transport checks; no provider requests or credentials."""

import sys
from types import SimpleNamespace

import pytest

from fieldline.calle_client import LiveCalleDispatcher, OFFICIAL_BASE_URL, UnknownCallOutcome
from fieldline.config import get_settings

PHONE = "+15555550100"
OTHER_PHONE = "+15555550101"


class Calls:
    def __init__(self, result=None, error=None):
        self.result = result if result is not None else {"status": "completed"}
        self.error = error
        self.requests = []

    def create_and_wait(self, **kwargs):
        self.requests.append(kwargs)
        if self.error:
            raise self.error
        return self.result


def dispatcher(calls=None, **kwargs):
    calls = calls or Calls()
    return LiveCalleDispatcher(
        api_key="fake-test-key", client=SimpleNamespace(calls=calls),
        authorized_phones={PHONE}, **kwargs,
    )


@pytest.mark.parametrize("origin", [
    "http://api.heycall-e.com", "https://api.heycall-e.com.evil.example",
    "https://api.heycall-e.com@evil.example", "https://evil.example",
    "https://api.heycall-e.com/path", "https://api.heycall-e.com?x=y",
    "https://api.heycall-e.com#fragment", "https://api.heycall-e.com:444",
    "https://user:secret@api.heycall-e.com", "", "//api.heycall-e.com",
])
def test_origin_rejected_before_sdk_creation(monkeypatch, origin):
    def forbidden(**kwargs):
        pytest.fail("SDK must not be constructed for an untrusted origin")
    monkeypatch.setitem(sys.modules, "calle", SimpleNamespace(CalleClient=forbidden))
    with pytest.raises(ValueError, match="official"):
        LiveCalleDispatcher(api_key="fake-test-key", base_url=origin, authorized_phones={PHONE})


@pytest.mark.parametrize("origin", [OFFICIAL_BASE_URL, OFFICIAL_BASE_URL + "/"])
def test_official_origin_allowed(origin):
    assert dispatcher(base_url=origin).create_and_wait(task="t", recipient={"phone": PHONE})


@pytest.mark.parametrize("key", [None, "", "   "])
def test_missing_key_rejected_even_with_injected_client(key):
    with pytest.raises(ValueError, match="CALLE_API_KEY"):
        LiveCalleDispatcher(api_key=key, client=SimpleNamespace(calls=Calls()), authorized_phones={PHONE})


@pytest.mark.parametrize("phones", [[], ["+１２３４５"], ["+١٢٣٤٥"], ["15555550100"], ["+01234"],
                                   ["+1234567890123456"], ["+12"], ["+1234567"], ["+123\n"], [None], PHONE])
def test_invalid_allowlist_rejected(phones):
    with pytest.raises(ValueError):
        LiveCalleDispatcher(api_key="fake-test-key", client=object(), authorized_phones=phones)


@pytest.mark.parametrize("recipient", [
    {"phone": OTHER_PHONE}, {"phone": "+12"}, {"phone": "+1234567"}, {"phone": "+１５５５５５５０１００"}, {"phones": [PHONE]},
    {"phone": PHONE, "phones": [OTHER_PHONE]}, {}, None,
])
def test_every_destination_checked_before_call(recipient):
    calls = Calls()
    d = dispatcher(calls)
    with pytest.raises(ValueError):
        d.create_and_wait(task="t", recipient=recipient)
    assert not calls.requests


def test_approval_is_snapshot_and_cannot_be_bypassed_with_recipients():
    phones = {PHONE}
    calls = Calls()
    d = LiveCalleDispatcher(api_key="fake-test-key", client=SimpleNamespace(calls=calls), authorized_phones=phones)
    phones.add(OTHER_PHONE)
    with pytest.raises(ValueError):
        d.create_and_wait(task="t", recipient={"phone": OTHER_PHONE})
    with pytest.raises(ValueError):
        d.create_and_wait(task="t", recipient={"phone": PHONE}, recipients=[{"phones": [OTHER_PHONE]}])
    assert not calls.requests


@pytest.mark.parametrize("error", [TimeoutError("secret URL"), ConnectionError("secret phone"), RuntimeError("raw response")])
def test_ambiguous_result_never_retries_or_becomes_no_answer(error):
    calls = Calls(error=error)
    d = dispatcher(calls)
    with pytest.raises(UnknownCallOutcome) as caught:
        d.create_and_wait(task="t", recipient={"phone": PHONE}, idempotency_key="test-only")
    assert str(error) not in str(caught.value)
    with pytest.raises(UnknownCallOutcome):
        d.create_and_wait(task="t", recipient={"phone": PHONE})
    assert len(calls.requests) == 1


@pytest.mark.parametrize("result", [{}, {"status": "queued"}, {"status": "in_progress"}, [], "bad"])
def test_nonterminal_response_is_unknown(result):
    with pytest.raises(UnknownCallOutcome):
        dispatcher(Calls(result=result)).create_and_wait(task="t", recipient={"phone": PHONE})


@pytest.mark.parametrize("status", ["completed", "failed", "canceled"])
def test_real_terminal_result_is_preserved(status):
    result = {"status": status, "id": "fake-call"}
    calls = Calls(result=result)
    assert dispatcher(calls).create_and_wait(task="t", recipient={"phone": PHONE}) is result
    assert len(calls.requests) == 1
    assert calls.requests[0]["timeout_seconds"] == 420.0


def test_live_client_disables_retries_redirects_and_proxy_environment(monkeypatch):
    transport_options = {}
    client_options = {}
    sdk_options = {}
    closed = []

    def transport(**kwargs):
        transport_options.update(kwargs)
        return "fake-transport"

    def http_client(**kwargs):
        client_options.update(kwargs)
        return SimpleNamespace(close=lambda: closed.append(True))

    def sdk(**kwargs):
        sdk_options.update(kwargs)
        return SimpleNamespace(calls=Calls())

    monkeypatch.setitem(sys.modules, "httpx", SimpleNamespace(Client=http_client, HTTPTransport=transport))
    monkeypatch.setitem(sys.modules, "calle", SimpleNamespace(CalleClient=sdk))
    d = LiveCalleDispatcher(api_key="fake-test-key", authorized_phones={PHONE})
    assert transport_options == {"retries": 0, "trust_env": False}
    assert client_options["follow_redirects"] is False
    assert client_options["trust_env"] is False
    assert client_options["base_url"] == OFFICIAL_BASE_URL
    assert client_options["headers"] == {"Authorization": "Bearer fake-test-key"}
    assert sdk_options["base_url"] == OFFICIAL_BASE_URL
    assert sdk_options["http_client"] is d._http_client
    d.close()
    assert closed == [True]


@pytest.mark.parametrize("flag", [None, "", "true", "TRUE", "0", "no", "off", "typo"])
def test_demo_stays_default_even_with_api_key(monkeypatch, tmp_path, flag):
    monkeypatch.setenv("CALLE_API_KEY", "fake-test-key")
    if flag is None:
        monkeypatch.delenv("FIELDLINE_DEMO", raising=False)
    else:
        monkeypatch.setenv("FIELDLINE_DEMO", flag)
    assert get_settings(tmp_path).demo is True


def test_only_explicit_false_selects_live(monkeypatch, tmp_path):
    monkeypatch.setenv("FIELDLINE_DEMO", "false")
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    settings = get_settings(tmp_path)
    assert settings.demo is False
    assert settings.api_key is None  # live dispatcher still rejects the missing key


@pytest.mark.parametrize("failure_stage", ["create", "poll", "redirect"])
def test_published_sdk_ambiguity_and_redirect_use_no_extra_requests(monkeypatch, failure_stage):
    """Exercise the real SDK against an in-memory HTTP transport only."""
    httpx = pytest.importorskip("httpx")
    pytest.importorskip("calle")
    requests = []

    def respond(request):
        requests.append((request.method, str(request.url)))
        assert request.url.host == "api.heycall-e.com"
        if failure_stage == "create":
            raise httpx.ReadTimeout("fake create timeout", request=request)
        if failure_stage == "redirect":
            return httpx.Response(307, headers={"Location": "https://untrusted.invalid/capture"})
        if request.method == "POST":
            return httpx.Response(201, json={"id": "fake-call", "status": "queued"})
        raise httpx.ReadTimeout("fake poll timeout", request=request)

    def transport(**kwargs):
        assert kwargs == {"retries": 0, "trust_env": False}
        return httpx.MockTransport(respond)

    monkeypatch.setattr(httpx, "HTTPTransport", transport)
    d = LiveCalleDispatcher(api_key="fake-test-key", authorized_phones={PHONE})
    try:
        for _ in range(2):
            with pytest.raises(UnknownCallOutcome):
                d.create_and_wait(task="offline fake", recipient={"phone": PHONE}, idempotency_key="fake-idempotency")
    finally:
        d.close()
    assert requests == [
        ("POST", OFFICIAL_BASE_URL + "/v1/calls"),
        *([("GET", OFFICIAL_BASE_URL + "/v1/calls/fake-call")] if failure_stage == "poll" else []),
    ]
