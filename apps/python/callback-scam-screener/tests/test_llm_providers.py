import pytest

from pipeline.llm_providers import PROVIDERS, _call_anthropic, call_llm


def test_providers_registry_has_expected_shape():
    # Only gemini is registered right now — see the PROVIDERS comment in
    # llm_providers.py. _call_anthropic exists and is tested below directly,
    # but isn't wired into the public registry until it has its own real-call
    # verification the way the Gemini path has had.
    assert set(PROVIDERS) == {"gemini"}
    for entry in PROVIDERS.values():
        assert callable(entry["call"])
        assert isinstance(entry["default_model"], str)


def test_unknown_provider_raises_before_any_network_call():
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        call_llm("irrelevant prompt", provider="openai")


def test_anthropic_not_currently_registered():
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        call_llm("irrelevant prompt", provider="anthropic")


def test_anthropic_function_without_api_key_raises_clear_error(monkeypatch):
    # Tests the underlying function directly, not via call_llm's registry —
    # it isn't registered (see above), but the implementation still exists
    # and its own error handling is still worth covering.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY is not set"):
        _call_anthropic("irrelevant prompt", "claude-sonnet-5")


def test_gemini_without_api_key_raises_clear_error(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        call_llm("irrelevant prompt", provider="gemini")
