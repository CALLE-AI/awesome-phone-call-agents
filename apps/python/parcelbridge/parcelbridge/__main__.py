"""``python -m parcelbridge`` entry point.

This module exists so the bundle can be invoked with
``python -m parcelbridge`` (no ``.cli`` qualifier). It
forwards to :func:`parcelbridge.cli.main`. For the
canonical entry point with subcommands, prefer
``python -m parcelbridge.cli demo --offline``.
"""

from parcelbridge.cli import main

if __name__ == "__main__":
    raise SystemExit(main())