"""Command line entry point.

Nothing here places a call unless ``REACHABLE_LIVE_CALLS=1`` and a human types a
confirmation for that specific call.
"""

from __future__ import annotations

import argparse
import sys

from .config import Config, ConfigError

APP_NAME = "reachable"


def cmd_config(args: argparse.Namespace) -> int:
    """Show effective configuration. Secrets appear as set/unset, never a value."""
    try:
        config = Config.from_env()
    except ConfigError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    for key, value in config.redacted().items():
        print(f"  {key:<22} {value}")
    if not config.live_calls:
        print("\n  REACHABLE_LIVE_CALLS is not set: no call can be placed from this process.")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:  # pragma: no cover - operator entry point
    import uvicorn

    from .web.app import create_app

    try:
        app = create_app()
    except ConfigError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=APP_NAME,
        description=(
            "Keeps a school's emergency contacts reachable, and follows up unexplained "
            "absence by phone. No subcommand places a call unless REACHABLE_LIVE_CALLS=1 "
            "and a human confirms that specific call."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    config_cmd = sub.add_parser("config", help="show effective configuration, secrets redacted")
    config_cmd.set_defaults(func=cmd_config)

    serve = sub.add_parser("serve", help="start the office dashboard on loopback")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
