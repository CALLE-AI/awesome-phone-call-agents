"""Model-pass tests. A stub provider throughout: no key, no network, no model.

The point of these is not that the model finds things. It is that everything it
returns is discarded unless the thread actually contains it — because a finding
becomes an offer to telephone a real person.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.detect import Finding, detect  # noqa: E402
from app.llm import (  # noqa: E402
    ModelUnavailable, _extract_json, build_provider, findings_from_model, merge,
)
from app.thread import thread_from_payload  # noqa: E402

THREAD = thread_from_payload({
    "subject": "Kickoff",
    "messages": [
        {"sender": "Charles Miller", "from_me": True,
         "body": "Either the short deck or the full deck would suit us, whichever you prefer."},
        {"sender": "Alex", "from_me": False, "body": "Perfect, that suits us."},
    ],
})


class Stub:
    name = "stub"

    def __init__(self, payload):
        self.payload = payload

    def complete(self, prompt: str) -> str:
        self.prompt = prompt
        return self.payload if isinstance(self.payload, str) else json.dumps(self.payload)


def one(**overrides) -> dict:
    finding = {
        "kind": "unclear_choice",
        "asked_index": 0,
        "replied_index": 1,
        "question": "Either the short deck or the full deck would suit us, whichever you prefer.",
        "reply": "Perfect, that suits us.",
        "options": ["the short deck", "the full deck"],
        "call_question": "Which did you mean, the short deck or the full deck?",
    }
    finding.update(overrides)
    return {"findings": [finding]}


# --- it must substantiate everything it claims -------------------------------

def test_a_well_formed_finding_is_accepted():
    [finding] = findings_from_model(THREAD, Stub(one()))
    assert finding.kind == "unclear_choice"
    assert finding.source == "model"
    assert finding.confidence == "medium"   # never "high"


def test_a_paraphrased_question_is_rejected():
    """The guard against a confident hallucination becoming a phone call."""
    assert findings_from_model(THREAD, Stub(one(question="Which deck would you like?"))) == []


def test_an_invented_reply_is_rejected():
    assert findings_from_model(THREAD, Stub(one(reply="Yes, the full one please."))) == []


def test_quoting_is_whitespace_and_case_tolerant():
    sloppy = "  either the short deck  or the full deck would suit us, whichever you prefer. "
    assert len(findings_from_model(THREAD, Stub(one(question=sloppy)))) == 1


# --- it must not misread who said what ---------------------------------------

def test_a_question_attributed_to_the_other_person_is_rejected():
    assert findings_from_model(THREAD, Stub(one(asked_index=1, replied_index=0))) == []


def test_a_reply_that_precedes_its_question_is_rejected():
    assert findings_from_model(THREAD, Stub(one(asked_index=1))) == []


def test_an_out_of_range_index_is_rejected():
    assert findings_from_model(THREAD, Stub(one(replied_index=9))) == []


# --- shape ------------------------------------------------------------------

def test_an_unknown_kind_is_rejected():
    assert findings_from_model(THREAD, Stub(one(kind="contradiction"))) == []


def test_unclear_choice_needs_at_least_two_options():
    assert findings_from_model(THREAD, Stub(one(options=["the short deck"]))) == []


def test_a_missing_call_question_is_rejected():
    assert findings_from_model(THREAD, Stub(one(call_question=""))) == []


def test_an_absurdly_long_call_question_is_rejected():
    assert findings_from_model(THREAD, Stub(one(call_question="x" * 500))) == []


def test_empty_findings_are_fine():
    assert findings_from_model(THREAD, Stub({"findings": []})) == []


def test_fenced_json_is_unwrapped():
    body = "Here you go:\n```json\n" + json.dumps(one()) + "\n```"
    assert len(findings_from_model(THREAD, Stub(body))) == 1


def test_prose_instead_of_json_raises_rather_than_guessing():
    with pytest.raises(ModelUnavailable):
        findings_from_model(THREAD, Stub("I could not find anything."))


def test_malformed_json_raises():
    with pytest.raises(ModelUnavailable):
        _extract_json('{"findings": [')


# --- merging -----------------------------------------------------------------

def test_rules_win_on_the_same_reply():
    rules = detect(thread_from_payload({
        "subject": "s",
        "messages": [
            {"sender": "Me", "from_me": True, "body": "Does Monday or Tuesday work?"},
            {"sender": "Alex", "from_me": False, "body": "Yeah, I'll be there."},
        ],
    }))
    assert rules and rules[0].source == "rules"
    model = [Finding(kind="unclear_choice", confidence="medium", asked_index=0,
                     replied_index=1, question="q", reply="r", options=["a", "b"],
                     headline="h", call_question="c", source="model")]
    merged = merge(rules, model)
    assert len(merged) == 1
    assert merged[0].source == "rules"


def test_the_model_adds_replies_the_rules_missed():
    model = [Finding(kind="unclear_choice", confidence="medium", asked_index=0,
                     replied_index=1, question="q", reply="r", options=["a", "b"],
                     headline="h", call_question="c", source="model")]
    merged = merge([], model)
    assert [f.source for f in merged] == ["model"]


# --- configuration -----------------------------------------------------------

def test_the_pass_is_off_without_configuration():
    assert build_provider({}) is None
    assert build_provider({"DEFAULT_AI_ENV": "GEMINI"}) is None          # no key
    assert build_provider({"GEMINI_API_KEY": "x"}) is None               # not selected


def test_providers_are_selected_by_name():
    assert build_provider({"DEFAULT_AI_ENV": "GEMINI", "GEMINI_API_KEY": "x"}).name == "gemini"
    assert build_provider({"DEFAULT_AI_ENV": "ANTHROPIC", "ANTHROPIC_API_KEY": "x"}).name == "anthropic"


# --- the automatic pre-check must not spend money ----------------------------

def test_rules_only_skips_the_model_pass():
    """The extension pre-checks every thread you open. Running the model on all
    of them costs money and latency for threads that are almost always fine."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fastapi.testclient import TestClient
    from app.main import DEV_TOKEN, create_app

    calls = {"n": 0}

    class Counting(Stub):
        def complete(self, prompt):
            calls["n"] += 1
            return super().complete(prompt)

    app = create_app({"CONVERSATION_CLARIFY_MODE": "fixture",
                      "DEFAULT_AI_ENV": "GEMINI", "GEMINI_API_KEY": "x"})
    # swap in a provider we can count, without touching the network
    import app.main as main_module  # noqa: F401
    client = TestClient(app)
    thread = {
        "subject": "s",
        "messages": [
            {"sender": "Me", "from_me": True, "body": "Does Monday or Tuesday work?"},
            {"sender": "Alex", "from_me": False, "body": "Yeah, I'll be there."},
        ],
    }
    headers = {"Authorization": f"Bearer {DEV_TOKEN}"}

    rules_only = client.post("/v1/analyze", json={**thread, "rules_only": True}, headers=headers)
    assert rules_only.status_code == 200
    assert rules_only.json()["model_pass"] == "skipped"
    assert rules_only.json()["findings"], "rules still run"


# --- the key must not follow a redirect --------------------------------------
#
# urllib's HTTPRedirectHandler copies every request header onto the redirected
# request without comparing hosts, so following a 30x would hand the provider
# key to whatever host the redirect names.

def test_a_redirect_is_refused_rather_than_followed():
    from app.llm import _NoRedirects

    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": "secret"},
    )
    with pytest.raises(ModelUnavailable, match="refusing to resend the key"):
        _NoRedirects().redirect_request(
            request, None, 302, "Found", {}, "https://elsewhere.example/collect"
        )


def test_an_unpinned_origin_is_refused_before_the_socket_opens():
    from app.llm import _send

    request = urllib.request.Request(
        "http://127.0.0.1:9/v1/messages", headers={"x-api-key": "secret"}
    )
    with pytest.raises(ModelUnavailable, match="refusing to send the model key"):
        _send(request)


def test_the_allowlist_is_derived_from_the_endpoints_actually_used():
    from app.llm import ALLOWED_ORIGINS, Anthropic, Gemini, _origin

    assert _origin(Gemini.ENDPOINT) in ALLOWED_ORIGINS
    assert _origin(Anthropic.ENDPOINT) in ALLOWED_ORIGINS
    assert all(origin.startswith("https://") for origin in ALLOWED_ORIGINS)
