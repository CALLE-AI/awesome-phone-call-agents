"""Public demo entry point (Render or similar PaaS): runs a local, in-
process fake CALL-E backend alongside web_server.py's HTTP server, so a
public URL can demonstrate --execute without ever touching a real
CALL-E credential or api.heycall-e.com.

SAFETY, hardcoded, not configurable by flag or environment variable:
  - web_allow_live is always False. There is no way to set it from this
    file's command line or environment.
  - The web server is always pointed at an internal FakeCalleServer
    bound to 127.0.0.1 - never a real base URL, and not reachable from
    outside this process regardless of the public port.
  - Only PORT is read from the environment (the platform-injected port
    to bind the public-facing server to). CALLE_API_KEY is never read
    here at all - resolve_api_key() only reads it when allow_live is
    True, which this file never allows.

Do not set CALLE_API_KEY in this service's environment on the hosting
platform - it would sit unused given the above, but there is no reason
for a real credential to exist in a public demo's configuration at all.
"""

from __future__ import annotations

import os
from http.server import ThreadingHTTPServer

from fake_server import FakeCalleServer
from web_server import Handler


def resolve_port() -> int:
    return int(os.environ.get("PORT", 8000))


def build_web_server(fake_base_url: str, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.web_base_url = fake_base_url  # type: ignore[attr-defined]
    server.web_allow_live = False  # type: ignore[attr-defined]  # hardcoded - see module docstring
    return server


def main() -> int:
    fake = FakeCalleServer()
    fake.__enter__()
    print(f"Internal fake CALL-E backend: {fake.base_url} (127.0.0.1 only, not public)", flush=True)

    port = resolve_port()
    server = build_web_server(fake.base_url, port)
    print(
        f"Public demo web UI on 0.0.0.0:{port} - dry-run and fake-server execute only, "
        "no real calls possible",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        fake.__exit__(None, None, None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
