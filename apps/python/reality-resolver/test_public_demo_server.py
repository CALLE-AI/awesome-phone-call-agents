"""Unit tests for public_demo_server.py's safety-critical properties:
allow_live is hardcoded False regardless of environment, and the port
comes from PORT (Render/Heroku convention) with a sane default.

No test here calls serve_forever() or binds to a public-facing port for
real - build_web_server() is tested directly and closed immediately.
"""

from __future__ import annotations

import public_demo_server
from fake_server import FakeCalleServer


def test_resolve_port_honors_port_env_var(monkeypatch) -> None:
    monkeypatch.setenv("PORT", "12345")
    assert public_demo_server.resolve_port() == 12345


def test_resolve_port_defaults_without_env_var(monkeypatch) -> None:
    monkeypatch.delenv("PORT", raising=False)
    assert public_demo_server.resolve_port() == 8000


def test_build_web_server_hardcodes_allow_live_false(monkeypatch) -> None:
    # Even a real-looking key in the environment must have no effect:
    # build_web_server() never reads CALLE_API_KEY, and allow_live is
    # hardcoded regardless of what is set here.
    monkeypatch.setenv("CALLE_API_KEY", "iams_live_should_never_be_reachable_from_public_demo")

    with FakeCalleServer() as fake:
        server = public_demo_server.build_web_server(fake.base_url, port=0)
        try:
            assert server.web_allow_live is False
            assert server.web_base_url == fake.base_url
        finally:
            server.server_close()
