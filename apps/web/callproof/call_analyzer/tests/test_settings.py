"""The signing secret must never fall back to a public value outside development."""
from __future__ import annotations

import pytest

from call_analyzer.settings import DEVELOPMENT_ONLY_SECRET, MissingWebhookSecret, Settings


def test_development_may_use_the_shared_default(monkeypatch):
    monkeypatch.delenv("CALLPROOF_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("CALL_ANALYZER_ENV", raising=False)

    assert Settings.from_env().webhook_secret == DEVELOPMENT_ONLY_SECRET


def test_a_deployment_that_forgets_the_secret_refuses_to_start(monkeypatch):
    """Signing with the repo's own constant would be worse than not starting."""
    monkeypatch.delenv("CALLPROOF_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv("CALL_ANALYZER_ENV", "production")

    with pytest.raises(MissingWebhookSecret, match="CALLPROOF_WEBHOOK_SECRET is required"):
        Settings.from_env()


def test_an_explicit_secret_is_used_in_every_environment(monkeypatch):
    monkeypatch.setenv("CALLPROOF_WEBHOOK_SECRET", "s3cret-from-the-vault")
    monkeypatch.setenv("CALL_ANALYZER_ENV", "production")

    assert Settings.from_env().webhook_secret == "s3cret-from-the-vault"
