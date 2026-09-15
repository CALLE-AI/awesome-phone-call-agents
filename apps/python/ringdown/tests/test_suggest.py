from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from ringdown.audit import DETAIL_LIMIT
from ringdown.calle import UntrustedHost
from ringdown.incident import IncidentError
from ringdown.suggest import (
    ATTEMPTS,
    LIVE,
    MODEL,
    SuggestionError,
    prompt_for,
    suggest_mapping,
)
from tests.data import example_body

PAYLOAD = example_body("opsgenie")

MAPPING = {
    "id": "$.alert.alertId",
    "title": "$.alert.message",
    "severity": "$.alert.tags[0]",
    "service": "$.integrationName",
    "summary": "p99 latency is 3.4s against a 1.2s objective.",
    "ladder": ["primary", "secondary"],
    "timezone": "UTC",
}

RECEIVED: list[dict] = []


class _Gemini(BaseHTTPRequestHandler):
    status = 200
    answers = [json.dumps(MAPPING)]
    redirect_to = ""

    @classmethod
    def _answer(cls) -> str:
        return cls.answers[min(len(RECEIVED), len(cls.answers)) - 1]

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        RECEIVED.append(
            {
                "path": self.path,
                "key": self.headers.get("x-goog-api-key", ""),
                "body": json.loads(body),
            }
        )
        if type(self).redirect_to:
            self.send_response(302)
            self.send_header("Location", type(self).redirect_to)
            self.end_headers()
            return
        self.send_response(type(self).status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps(
                {"error": {"message": "API key not valid"}}
                if type(self).status != 200
                else {"candidates": [{"content": {"parts": [{"text": type(self)._answer()}]}}]}
            ).encode()
        )

    def log_message(self, *_) -> None:
        return


@pytest.fixture
def gemini():
    RECEIVED.clear()
    _Gemini.status = 200
    _Gemini.answers = [json.dumps(MAPPING)]
    _Gemini.redirect_to = ""
    server = HTTPServer(("127.0.0.1", 0), _Gemini)
    threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True
    ).start()
    yield _Gemini, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def test_the_prompt_carries_the_payload_and_the_severities_the_loader_accepts():
    prompt = prompt_for(PAYLOAD)

    assert "052652ac-5d1c-464a-812a-7dd18bbfba8c" in prompt
    assert "sev1, sev2, sev3, p1, p2, p3, p4, p5" in prompt


def test_a_suggested_mapping_is_returned_only_after_it_dials_a_valid_incident(gemini):
    _, url = gemini

    assert suggest_mapping(PAYLOAD, "k", url=url) == MAPPING


def test_a_mapping_the_model_invented_is_refused_rather_than_handed_back(gemini):
    handler, url = gemini
    handler.answers = [json.dumps({**MAPPING, "severity": "$.alert.nowhere"})]

    with pytest.raises(IncidentError) as raised:
        suggest_mapping(PAYLOAD, "k", url=url)
    assert "severity" in str(raised.value)
    assert "The model proposed" in str(raised.value)
    assert len(RECEIVED) == ATTEMPTS


def test_a_rejected_mapping_is_sent_back_to_the_model_with_what_the_loader_said(gemini):
    handler, url = gemini
    handler.answers = [json.dumps({**MAPPING, "severity": "$.alert.nowhere"}), json.dumps(MAPPING)]

    assert suggest_mapping(PAYLOAD, "k", url=url) == MAPPING

    retry = RECEIVED[1]["body"]["contents"][0]["parts"][0]["text"]
    assert "Your previous answer was rejected" in retry
    assert "$.alert.nowhere" in retry
    assert "severity" in retry


def test_an_answer_that_is_not_a_mapping_object_is_reported(gemini):
    handler, url = gemini
    handler.answers = ["here is your mapping:"]

    with pytest.raises(SuggestionError):
        suggest_mapping(PAYLOAD, "k", url=url)


def test_the_key_travels_in_a_header_to_the_model_path_and_never_in_the_query(gemini):
    _, url = gemini
    suggest_mapping(PAYLOAD, "secret", url=url)
    sent = RECEIVED[0]

    assert sent["key"] == "secret"
    assert sent["path"] == f"/v1beta/models/{MODEL}:generateContent"
    assert "secret" not in sent["path"]


def test_a_key_is_never_sent_anywhere_but_the_pinned_host_or_loopback():
    with pytest.raises(UntrustedHost):
        suggest_mapping(PAYLOAD, "secret", url="https://evil.example.com")


def test_a_refused_request_is_reported_with_the_providers_own_message(gemini):
    handler, url = gemini
    handler.status = 403

    with pytest.raises(SuggestionError) as raised:
        suggest_mapping(PAYLOAD, "k", url=url)
    assert "http 403" in str(raised.value)
    assert "API key not valid" in str(raised.value)
    assert len(str(raised.value)) <= DETAIL_LIMIT


def test_a_redirect_is_refused_rather_than_followed_with_the_key(gemini):
    handler, url = gemini
    handler.redirect_to = f"{LIVE}/v1beta/models/other:generateContent"

    with pytest.raises(SuggestionError) as raised:
        suggest_mapping(PAYLOAD, "k", url=url)
    assert "answered with a redirect" in str(raised.value)


def test_a_dead_endpoint_is_a_transport_failure_not_a_crash():
    with pytest.raises(SuggestionError) as raised:
        suggest_mapping(PAYLOAD, "k", url="http://127.0.0.1:1", timeout=1.0)
    assert "transport failure" in str(raised.value)
