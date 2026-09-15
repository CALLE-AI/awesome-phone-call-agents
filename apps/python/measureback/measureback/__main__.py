"""Command line entry point for the local workbench and public fixture export."""

import argparse
import json
from pathlib import Path

from .server import create_server, example_report, export_site


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="measureback", description="Clarify spoken recipe measures and scale only sourced quantities.")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="Run the loopback-only recipe workbench")
    serve.add_argument("--port", type=int, default=8793)
    serve.add_argument("--live", action="store_true", help="Explicitly enable approved CALL E tasks; requires server-side CALLE_API_KEY")
    sample = commands.add_parser("example", help="Print an authored example recipe and computed report")
    sample.add_argument("--stage", choices=("unresolved", "clarified", "corrected"), default="corrected")
    sample.add_argument("--servings", type=int, choices=range(1, 13), default=6)
    export = commands.add_parser("export", help="Generate a public site containing authored examples only")
    export.add_argument("--output", type=Path, default=Path("artifacts/site"))
    args = parser.parse_args(argv)
    try:
        if args.command == "example":
            print(json.dumps(example_report(args.stage, args.servings), ensure_ascii=False, indent=2, allow_nan=False))
        elif args.command == "export":
            output = export_site(args.output)
            print(f"Exported authored examples and web assets to {output}")
        else:
            if not 1 <= args.port <= 65535:
                parser.error("--port must be between 1 and 65535")
            server = create_server(args.port, live=args.live)
            print(f"MeasureBack: http://127.0.0.1:{server.server_port}/", flush=True)
            print("Live CALL E tasks enabled; each requires its own explicit approval." if args.live else "Live calls disabled. Example, import and masked preview are available.", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
    except (ValueError, OSError) as exc:
        # These are local startup/export errors, not provider responses or secrets.
        parser.exit(2, f"MeasureBack could not complete this command: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
