import pytest

from pipeline.llm_providers import PROVIDERS, call_llm


def test_providers_registry_has_expected_shape():
    assert set(PROVIDERS) == {"anthropic", "gemini"}
    for entry in PROVIDERS.values():
        assert callable(entry["call"])
        assert isinstance(entry["default_model"], str)


def test_unknown_provider_raises_before_any_network_call():
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        call_llm("irrelevant prompt", provider="openai")


def test_anthropic_without_api_key_raises_clear_error(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY is not set"):
        call_llm("irrelevant prompt", provider="anthropic")


def test_gemini_without_api_key_raises_clear_error(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        call_llm("irrelevant prompt", provider="gemini")
