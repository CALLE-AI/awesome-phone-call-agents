"""Owns the fake CALL-E backend the API talks to.

Named backend.py rather than config.py because it is not configuration:
it is a lifecycle, with a start and a stop and a thread in between. The
one value it produces - a base URL - is deliberately not configurable,
which is the whole point.

Why the API runs its own: the base_url handed to pipeline.resolve()
decides which host a call reaches. If that value could come from a
request, from an environment variable read per request, or from
anywhere a client can influence, the API would have a route to the real
provider. It comes from here, from a server this process started on
loopback, and from nowhere else. There is no live backend to select
because none is implemented.

Lifecycle is separate from the HTTP server's on purpose. create_server()
does not start this, and stopping the HTTP server does not stop it -
whoever starts it stops it, so a test that forgets leaves a visible
failure rather than a listener nobody owns.
"""

from __future__ import annotations

from fake_server import FakeCalleServer


class BackendNotRunningError(RuntimeError):
    """Asking for a base URL before start(). Raised rather than returning
    a placeholder: a wrong URL here is a call to the wrong host.
    """


class FakeCallBackend:
    """A FakeCalleServer on a loopback port, run in a daemon thread.

    start() and stop() are both idempotent, so a double stop in a
    finally: block is harmless. Thread management is FakeCalleServer's
    own, driven here through its context-manager protocol rather than
    reimplemented - fake_server.py is not modified.
    """

    def __init__(self) -> None:
        self._server: FakeCalleServer | None = None

    @property
    def running(self) -> bool:
        return self._server is not None

    @property
    def base_url(self) -> str:
        if self._server is None:
            raise BackendNotRunningError("the fake backend has not been started")
        return self._server.base_url

    @property
    def creates(self) -> int:
        """How many calls the fake server was asked to create. Tests use
        it to prove a request placed no call at all.
        """
        if self._server is None:
            raise BackendNotRunningError("the fake backend has not been started")
        return self._server.creates

    def start(self) -> None:
        if self._server is not None:
            return
        server = FakeCalleServer()
        server.__enter__()
        self._server = server

    def stop(self) -> None:
        if self._server is None:
            return
        server, self._server = self._server, None
        server.__exit__(None, None, None)
