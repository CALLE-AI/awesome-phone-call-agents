"""Requirement 1 of docs/SAFETY.md: the credential origin allowlist.

Bearer credentials may only ever be sent to an allowlisted HTTPS provider
origin, and the check happens at startup, before the API key is read.
"""

from __future__ import annotations

import pytest

from reachable.config import (
    OFFICIAL_CALLE_ORIGIN,
    Config,
    ConfigError,
    CredentialOriginError,
    validate_calle_origin,
    validate_zone,
)


def test_official_origin_is_allowed():
    assert validate_calle_origin("https://api.heycall-e.com") == OFFICIAL_CALLE_ORIGIN
    assert validate_calle_origin("https://api.heycall-e.com/") == OFFICIAL_CALLE_ORIGIN


def test_blank_defaults_to_the_official_origin():
    assert validate_calle_origin("") == OFFICIAL_CALLE_ORIGIN


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1:8787", "http://localhost:8787", "https://127.0.0.1:9000"],
)
def test_loopback_is_allowed_for_the_fake_server(url):
    assert validate_calle_origin(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example.com",
        # The substring trap: these all contain the official host as a substring
        # and must still be refused, because matching is on the parsed host.
        "https://api.heycall-e.com.attacker.test",
        "https://api.heycall-e.com.evil.test/v1/calls",
        "https://attacker.test/?x=https://api.heycall-e.com",
        "https://attacker.test#api.heycall-e.com",
        "https://user@evil.test",
        # Right host, wrong scheme: a bearer token must not cross plain HTTP.
        "http://api.heycall-e.com",
        "ftp://api.heycall-e.com",
        # Not a URL at all.
        "api.heycall-e.com",
        "not a url",
    ],
)
def test_every_other_origin_is_refused(url):
    with pytest.raises(CredentialOriginError):
        validate_calle_origin(url)


def test_userinfo_cannot_smuggle_the_official_host():
    """https://api.heycall-e.com@evil.test resolves to evil.test."""
    with pytest.raises(CredentialOriginError):
        validate_calle_origin("https://api.heycall-e.com@evil.test")


def test_a_bad_origin_refuses_at_config_time_not_call_time():
    """The whole point: the process refuses to start, so nothing can leak later."""
    with pytest.raises(CredentialOriginError):
        Config.from_env(
            {"REACHABLE_CALLE_BASE_URL": "https://evil.example.com", "CALLE_API_KEY": "secret"}
        )


def test_the_key_is_never_read_when_the_origin_is_rejected():
    """Ordering matters: validate the destination before touching the credential."""

    class TripwireEnv(dict):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.read_key = False

        def get(self, name, default=None):
            if name == "CALLE_API_KEY":
                self.read_key = True
            return super().get(name, default)

    env = TripwireEnv(
        {"REACHABLE_CALLE_BASE_URL": "https://evil.example.com", "CALLE_API_KEY": "secret"}
    )
    with pytest.raises(CredentialOriginError):
        Config.from_env(env)
    assert env.read_key is False


def test_redacted_config_never_exposes_a_key_or_a_prefix():
    config = Config.from_env({"CALLE_API_KEY": "sk-live-abc123", "REACHABLE_ADMIN_TOKEN": "tok-xyz"})
    rendered = repr(config.redacted())
    assert "sk-live-abc123" not in rendered
    assert "sk-" not in rendered
    assert "tok-xyz" not in rendered
    assert config.redacted()["calle_api_key"] == "set"
    assert Config.from_env({}).redacted()["calle_api_key"] == "unset"


def test_live_calls_requires_exactly_one():
    for value in ["", "0", "false", "true", "yes", "on"]:
        assert Config.from_env({"REACHABLE_LIVE_CALLS": value}).live_calls is False
    assert Config.from_env({"REACHABLE_LIVE_CALLS": "1"}).live_calls is True


def test_mode_banner_tells_the_operator_what_can_ring():
    assert Config.from_env({}).mode_banner == "DRY-RUN"
    assert (
        Config.from_env(
            {"REACHABLE_LIVE_CALLS": "1", "REACHABLE_CALLE_BASE_URL": "http://127.0.0.1:8787"}
        ).mode_banner
        == "FAKE"
    )
    assert Config.from_env({"REACHABLE_LIVE_CALLS": "1"}).mode_banner == "LIVE"


def test_timezone_is_never_guessed():
    assert validate_zone("Europe/London") == "Europe/London"
    for bad in ["BST", "+01:00", "GMT+1", ""]:
        with pytest.raises(ConfigError):
            validate_zone(bad)


def test_confidence_floor_is_bounded():
    with pytest.raises(ConfigError):
        Config.from_env({"REACHABLE_CONFIDENCE_FLOOR": "1.5"})
    with pytest.raises(ConfigError):
        Config.from_env({"REACHABLE_CONFIDENCE_FLOOR": "abc"})
    assert Config.from_env({"REACHABLE_CONFIDENCE_FLOOR": "0.8"}).confidence_floor == 0.8
