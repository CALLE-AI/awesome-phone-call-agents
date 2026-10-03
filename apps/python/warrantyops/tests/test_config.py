"""Runtime configuration: refused loudly, never defaulted.

The live configuration is read from the environment only. These tests pin
the refusal surface itself — the error type, the origin parse, and the two
repository-root guards — so a configuration mistake is a named refusal
before any client exists, not a defaulted value on the wire.
"""

from __future__ import annotations

from warrantyops.config import (
    ConfigError,
    ConfigRefusal,
    _origin,
    artifact_dir_refusals,
    find_repository_root,
)


def test_a_config_error_carries_its_named_refusals():
    error = ConfigError((ConfigRefusal.MISSING_API_KEY,))
    assert "MISSING_API_KEY" in str(error)
    assert error.refusals == (ConfigRefusal.MISSING_API_KEY,)


def test_an_originless_url_has_no_origin():
    assert _origin("notaurl") == ""
    assert _origin("https://API.heycall-e.com/path") == "https://api.heycall-e.com"


def test_a_directory_without_repository_markers_is_no_root(tmp_path):
    assert find_repository_root(start=tmp_path) is None


def test_without_a_repository_root_any_artifact_dir_passes_the_path_check(
    tmp_path, monkeypatch
):
    from warrantyops import config as config_module

    monkeypatch.setattr(config_module, "find_repository_root", lambda: None)
    assert artifact_dir_refusals(tmp_path / "artifacts") == ()
