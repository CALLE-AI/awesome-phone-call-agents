"""Allow ``python -m noshow_guard run`` to invoke the CLI.

This simply delegates to :func:`noshow_guard.cli.main`.
"""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
