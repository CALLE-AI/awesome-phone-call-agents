"""Run offline app tests; forbid external sockets before importing app code."""

import os
from pathlib import Path
import sys
import unittest


def deny_external_network(event: str, args: tuple[object, ...]) -> None:
    """Allow only local event-loop sockets, never a provider connection or DNS."""

    if event == "socket.getaddrinfo":
        host = args[0]
    elif event in {"socket.connect", "socket.sendto", "socket.bind"}:
        address = args[-1]
        if not isinstance(address, tuple):
            return  # Local Unix-domain event-loop socket, where supported.
        host = address[0]
    elif event in {"socket.gethostbyname", "socket.gethostbyaddr"}:
        host = args[0]
    else:
        return
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise RuntimeError("External network access is forbidden during app tests")


def main() -> int:
    for name in ("CALLE_API_KEY", "CALLE_RECIPIENT_E164", "CALLE_HUMAN_CONFIRMATION"):
        if name in os.environ:
            del os.environ[name]
    os.environ["CALL_PROVIDER"] = "fake"
    os.environ["ALLOW_REAL_CALLS"] = "false"
    sys.dont_write_bytecode = True
    sys.addaudithook(deny_external_network)
    app_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(app_root / "src"))
    sys.path.insert(0, str(app_root))
    suite = unittest.defaultTestLoader.discover(str(app_root / "tests"))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
