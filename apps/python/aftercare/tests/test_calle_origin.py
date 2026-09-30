from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.integrations.calle import _get_client, pinned_calle_base_url
from app.utils.validators import (
    OFFICIAL_CALLE_ORIGIN,
    UntrustedCalleOrigin,
    validate_official_calle_origin,
)

REJECTED_ORIGINS = (
    "http://api.heycall-e.com",
    "https://evil.example.com",
    "https://user:pass@api.heycall-e.com",
    "https://api.heycall-e.com:8443",
    "https://api.heycall-e.com/v1",
    "https://api.heycall-e.com/?q=1",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
)


def _settings(**overrides: object) -> Settings:
    values = {
        "app_env": "test",
        "database_url": (
            "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/aftercare_test"
        ),
        "calle_api_key": "test_calle_key",
        "jwt_secret": "test-jwt-secret-value-at-least-32-chars",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_official_origin_and_trailing_slash_are_accepted() -> None:
    assert validate_official_calle_origin(OFFICIAL_CALLE_ORIGIN) == OFFICIAL_CALLE_ORIGIN
    assert (
        validate_official_calle_origin("https://api.heycall-e.com/")
        == OFFICIAL_CALLE_ORIGIN
    )
    assert validate_official_calle_origin("") == OFFICIAL_CALLE_ORIGIN
    assert validate_official_calle_origin(None) == OFFICIAL_CALLE_ORIGIN


@pytest.mark.parametrize("url", REJECTED_ORIGINS)
def test_unofficial_origins_are_rejected(url: str) -> None:
    with pytest.raises(UntrustedCalleOrigin):
        validate_official_calle_origin(url)


@pytest.mark.parametrize("url", REJECTED_ORIGINS)
def test_settings_refuse_unofficial_calle_base_url(url: str) -> None:
    with pytest.raises((UntrustedCalleOrigin, ValidationError)):
        _settings(calle_base_url=url)


def test_settings_normalize_official_calle_base_url() -> None:
    loaded = _settings(calle_base_url="https://api.heycall-e.com/")
    assert loaded.calle_base_url == OFFICIAL_CALLE_ORIGIN


def test_pinned_base_url_never_returns_unofficial_origin() -> None:
    with patch("app.integrations.calle.settings") as mock_settings:
        mock_settings.calle_base_url = "https://evil.example.com"
        with pytest.raises(UntrustedCalleOrigin):
            pinned_calle_base_url()

    with patch("app.integrations.calle.settings") as mock_settings:
        mock_settings.calle_base_url = OFFICIAL_CALLE_ORIGIN
        assert pinned_calle_base_url() == OFFICIAL_CALLE_ORIGIN


def test_get_client_sends_bearer_only_to_official_origin() -> None:
    fake = MagicMock()
    with (
        patch("app.integrations.calle.CalleClient", return_value=fake) as ctor,
        patch("app.integrations.calle.settings") as mock_settings,
    ):
        mock_settings.calle_api_key = "test_calle_key"
        mock_settings.calle_base_url = OFFICIAL_CALLE_ORIGIN
        client = _get_client()
    assert client is fake
    ctor.assert_called_once_with(
        api_key="test_calle_key",
        base_url=OFFICIAL_CALLE_ORIGIN,
    )
