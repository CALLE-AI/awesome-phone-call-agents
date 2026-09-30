"""LLM transport trust-boundary regressions. No external model is contacted."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from coordinator import Coordinator


REPORT = {
    "id": "incident_security",
    "summary": "A dog needs a safe ride.",
    "location": "Fictional location",
    "expected_outcome": "Arrange transport to a receiving clinic.",
}


@pytest.mark.parametrize("base_url", [
    "http://model.example/v1",
    "https://model.example/v1",
    "https://api.openai.com.evil.example/v1",
])
def test_untrusted_remote_model_never_receives_credential_or_case_data(monkeypatch, base_url):
    monkeypatch.delenv("LLM_ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("LLM_BASE_URL", base_url)
    monkeypatch.setenv("LLM_MODEL", "configured-model")
    monkeypatch.setenv("LLM_API_KEY", "credential-must-not-leave")
    monkeypatch.setenv("LLM_FALLBACK", "true")
    opened = []

    class ForbiddenClient:
        def __init__(self, **kwargs):
            opened.append(kwargs)
            raise AssertionError("An untrusted model client must not be created")

    planner = Coordinator()
    planner.client_factory = ForbiddenClient
    result = asyncio.run(planner.define(REPORT))

    assert result["_meta"]["engine"] == "rules"
    assert "approved HTTPS" in result["_meta"]["fallback_reason"]
    assert opened == []


def test_loopback_model_never_receives_environment_credential(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:1234/v1")
    monkeypatch.setenv("LLM_MODEL", "local-model")
    monkeypatch.setenv("LLM_API_KEY", "credential-must-stay-in-env")
    seen = []

    class Completion:
        async def create(self, **kwargs):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
                content=json.dumps({"ok": True})
            ))])

    class LocalClient:
        def __init__(self, **kwargs):
            seen.append(kwargs)
            self.chat = SimpleNamespace(completions=Completion())

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    planner = Coordinator()
    planner.client_factory = LocalClient
    assert asyncio.run(planner._json("security test", "Return JSON.", {"case": "fictional"})) == {"ok": True}
    assert seen[0]["api_key"] == "local"


def test_official_openai_https_endpoint_is_trusted(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("LLM_MODEL", "configured-model")
    monkeypatch.setenv("LLM_API_KEY", "credential-from-env")
    assert Coordinator().enabled


def test_explicit_https_origin_approves_exact_compatible_endpoint(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("LLM_ALLOWED_ORIGINS", "https://openrouter.ai")
    monkeypatch.setenv("LLM_MODEL", "configured-model")
    monkeypatch.setenv("LLM_API_KEY", "credential-from-env")
    planner = Coordinator()
    assert planner.enabled
    assert planner.configuration_error == ""


@pytest.mark.parametrize("base_url,allowed", [
    ("http://model.example/v1", "http://model.example"),
    ("https://openrouter.ai.evil.example/api/v1", "https://openrouter.ai"),
    ("https://openrouter.ai/api/v1?forward=elsewhere", "https://openrouter.ai"),
])
def test_allowlist_cannot_approve_insecure_or_nonexact_endpoint(monkeypatch, base_url, allowed):
    monkeypatch.setenv("LLM_BASE_URL", base_url)
    monkeypatch.setenv("LLM_ALLOWED_ORIGINS", allowed)
    monkeypatch.setenv("LLM_MODEL", "configured-model")
    monkeypatch.setenv("LLM_API_KEY", "credential-from-env")
    assert not Coordinator().enabled


def test_remote_model_client_does_not_follow_redirects(monkeypatch):
    sdk = pytest.importorskip("openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("LLM_ALLOWED_ORIGINS", "https://openrouter.ai")
    monkeypatch.setenv("LLM_MODEL", "configured-model")
    monkeypatch.setenv("LLM_API_KEY", "credential-from-env")
    seen = []

    class Completion:
        async def create(self, **kwargs):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
                content=json.dumps({"ok": True})
            ))])

    class RemoteClient:
        def __init__(self, **kwargs):
            seen.append(kwargs)
            self.chat = SimpleNamespace(completions=Completion())

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(sdk, "AsyncOpenAI", RemoteClient)
    planner = Coordinator()
    assert asyncio.run(planner._json("security test", "Return JSON.", {"case": "fictional"})) == {"ok": True}
    assert seen[0]["api_key"] == "credential-from-env"
    assert seen[0]["http_client"].follow_redirects is False
