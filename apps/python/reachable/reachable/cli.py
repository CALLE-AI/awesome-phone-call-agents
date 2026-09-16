"""Command line entry point.

Nothing here places a call unless ``REACHABLE_LIVE_CALLS=1`` and the operator
types a confirmation for that specific call.
"""

from __future__ import annotations

import argparse
import builtins
import sys
from pathlib import Path

from .config import Config, ConfigError, load_env_file
from .phone import InvalidPhoneNumber, is_drama_number, mask, mask_display, validate_e164

APP_ROOT = Path(__file__).resolve().parent.parent


def print(*values: object, **kwargs) -> None:
    """Apply the shared display mask to every CLI output, not stored evidence."""
    builtins.print(*mask_display(values), **kwargs)


def _orchestrator(config: Config | None = None):
    from .web.app import build_orchestrator

    return build_orchestrator(config or Config.from_env())


def _fail(message: str) -> int:
    sys.stderr.write(f"error: {mask_display(message)}\n")
    return 2


# --------------------------------------------------------------------- config


def cmd_config(args: argparse.Namespace) -> int:
    """Show effective configuration. Secrets appear as set/unset, never a value."""
    try:
        config = Config.from_env()
    except ConfigError as exc:
        return _fail(str(exc))
    loaded = load_env_file()
    if loaded is not None:
        print(f"  env file               {loaded}")
    for key, value in config.redacted().items():
        print(f"  {key:<22} {value}")
    if not config.live_calls:
        print("\n  REACHABLE_LIVE_CALLS is not set: no call can be placed from this process.")
    return 0


# --------------------------------------------------------------------- import


def cmd_import(args: argparse.Namespace) -> int:
    try:
        orc = _orchestrator()
    except ConfigError as exc:
        return _fail(str(exc))
    report = orc.import_data(args.data_dir)
    print(report.summary())
    if report.rejected:
        print("\nRejected rows (row numbers match your spreadsheet):")
        for problem in report.rejected:
            print(f"  {problem.file}:{problem.row_number}  {problem.reason}  {problem.detail}")
    return 0 if report.ok else 1


# ------------------------------------------------------------------ workflows


def cmd_check_contacts(args: argparse.Namespace) -> int:
    try:
        orc = _orchestrator()
    except ConfigError as exc:
        return _fail(str(exc))
    orc.import_data()
    created = orc.start_contact_check(args.term)
    print(f"{len(created)} contact-check case(s) opened for term {args.term or orc.config.term_id}")
    for row in orc.store.decisions():
        print(f"  not calling {row['contact_id']}: {row['reason']}")
    return 0


def cmd_scan_register(args: argparse.Namespace) -> int:
    try:
        orc = _orchestrator()
    except ConfigError as exc:
        return _fail(str(exc))
    orc.import_data()
    created = orc.scan_register()
    print(f"{len(created)} trigger(s) detected")
    for case_id in created:
        case = orc.store.case(case_id)
        pupil = orc.dataset.pupils.get(case["pupil_id"])
        print(f"  {case_id}  {pupil.first_name if pupil else ''}  -> {case['state']}")
    return 0


def cmd_preview(args: argparse.Namespace) -> int:
    """Render exactly what would be said. Reads no credentials, dials nothing."""
    try:
        orc = _orchestrator()
    except ConfigError as exc:
        return _fail(str(exc))
    orc.import_data()
    try:
        preview = orc.preview(args.case)
    except Exception as exc:  # noqa: BLE001 - a render refusal is the answer
        return _fail(str(exc))
    print(preview.as_text())
    return 0


# --------------------------------------------------------------------- replay


def cmd_replay(args: argparse.Namespace) -> int:
    from . import scenarios

    paths = [Path(p) for p in args.scenario] or scenarios.available(APP_ROOT)
    failures = 0
    for path in paths:
        spec = scenarios.load(path)
        result = scenarios.replay(spec, app_root=APP_ROOT)
        print(f"\n{result.name}")
        print("-" * len(result.name))
        if result.description:
            print(result.description)
        print()
        width = max((len(s.action) for s in result.steps), default=6)
        for step in result.steps:
            print(f"  {step.action.ljust(width)}  {step.state:<22} {step.detail}")
        print(f"\n  calls placed  {result.calls_placed}")
        if result.refusals:
            print(f"  refusals      {', '.join(result.refusals)}")
        if result.failures:
            failures += 1
            for problem in result.failures:
                print(f"  MISMATCH      {problem}")
        else:
            print("  expectations  all met")
    print("\n(no network was used and no credential was read)")
    return 1 if failures else 0


def cmd_purge_transcripts(args: argparse.Namespace) -> int:
    """Delete transcripts past the retention period. Outcomes survive."""
    try:
        orc = _orchestrator()
    except ConfigError as exc:
        return _fail(str(exc))
    purged = orc.purge_expired_transcripts()
    print(
        f"  purged {purged} transcript(s) older than "
        f"{orc.config.transcript_retention_days} days"
    )
    return 0


# ----------------------------------------------------------------- live setup


def cmd_live_contact(args: argparse.Namespace) -> int:
    """Point one sample contact at a number you own, for a live recording.

    Deliberately a separate, confirmed command rather than a flag on a calling
    path: swapping a fixture number for a real telephone is the single most
    dangerous edit in this repository, and it should look like it.
    """
    try:
        number = validate_e164(args.number)
    except InvalidPhoneNumber as exc:
        return _fail(f"{exc.reason}; the number is rejected, never repaired")

    if is_drama_number(number):
        return _fail(
            "that is an Ofcom drama number, which cannot ring. Use a real number you own."
        )

    path = Path(args.data_dir or Config.from_env().data_dir) / "contacts.csv"
    if not path.exists():
        return _fail(f"no contacts.csv at {path}")

    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    header = lines[0].split(",")
    try:
        id_col = header.index("contact_id")
        phone_col = header.index("phone_e164")
        name_col = header.index("contact_name")
    except ValueError:
        return _fail("contacts.csv is missing contact_id, contact_name or phone_e164")

    target = None
    for index, line in enumerate(lines[1:], start=1):
        parts = line.split(",")
        if len(parts) > id_col and parts[id_col] == args.contact:
            target = (index, parts)
            break
    if target is None:
        return _fail(f"no contact {args.contact} in {path.name}")

    index, parts = target
    print(f"\n  file     {path}")
    print(f"  contact  {args.contact}  {parts[name_col]}")
    print(f"  from     {mask(parts[phone_col])}  (fictional)")
    print(f"  to       {mask(number)}  (a real telephone you say you own)\n")
    print("  This makes a live call to that number possible. Only do this for a")
    print("  number you own and have offered for testing.\n")

    if not args.yes:
        typed = input(mask_display(f"  Type {args.contact} to confirm: ")).strip()
        if typed != args.contact:
            print("  Cancelled. Nothing was changed.")
            return 1

    parts[phone_col] = number
    lines[index] = ",".join(parts)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  Updated. {args.contact} now points at {mask(number)}.")
    print("  Remember to put the fictional number back after recording.")
    return 0


# ---------------------------------------------------------------------- serve


def cmd_serve(args: argparse.Namespace) -> int:  # pragma: no cover - operator path
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        return _fail("the unauthenticated office dashboard must bind to loopback")

    import uvicorn

    from .web.app import create_app

    try:
        app = create_app()
    except ConfigError as exc:
        return _fail(str(exc))
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_fake_calle(args: argparse.Namespace) -> int:  # pragma: no cover
    from fake_calle.server import main as fake_main

    sys.argv = ["fake-calle", "--host", args.host, "--port", str(args.port)]
    return fake_main()


# --------------------------------------------------------------------- parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reachable",
        description=(
            "Keeps a school's emergency contacts reachable, and follows up unexplained "
            "absence by phone. No subcommand places a call unless REACHABLE_LIVE_CALLS=1 "
            "and a human confirms that specific call."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("config", help="show effective configuration, secrets redacted")
    p.set_defaults(func=cmd_config)

    p = sub.add_parser("import", help="import the five CSV files with a validation report")
    p.add_argument("--data-dir", default=None)
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("check-contacts", help="open a contact-check case per contact")
    p.add_argument("--term", default=None)
    p.set_defaults(func=cmd_check_contacts)

    p = sub.add_parser("scan-register", help="find consecutive unexplained sessions")
    p.set_defaults(func=cmd_scan_register)

    p = sub.add_parser("preview", help="render exactly what would be said; dials nothing")
    p.add_argument("case")
    p.set_defaults(func=cmd_preview)

    p = sub.add_parser("replay", help="replay scenarios end to end with no network")
    p.add_argument("scenario", nargs="*")
    p.set_defaults(func=cmd_replay)

    p = sub.add_parser(
        "purge-transcripts", help="delete transcripts past the retention period"
    )
    p.set_defaults(func=cmd_purge_transcripts)

    p = sub.add_parser(
        "live-contact",
        help="point one sample contact at a number you own, for a live recording",
    )
    p.add_argument("--contact", required=True, help="contact_id to repoint, e.g. C-2090")
    p.add_argument("--number", required=True, help="E.164 number you own")
    p.add_argument("--data-dir", default=None)
    p.add_argument("--yes", action="store_true", help="skip the typed confirmation")
    p.set_defaults(func=cmd_live_contact)

    p = sub.add_parser("serve", help="start the office dashboard on loopback")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("fake-calle", help="start the local fake CALL-E server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8787)
    p.set_defaults(func=cmd_fake_calle)

    return parser


def _use_utf8_output() -> None:
    """Make stdout and stderr carry the masking character on any console.

    Masked numbers are rendered with an ellipsis. A Windows console defaults to
    a legacy code page, which turns that into a replacement character and makes
    the validation report look corrupted -- the first thing somebody trying this
    app is likely to run. Reconfiguring is cheap; falling back quietly is fine
    where the stream does not support it.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):  # pragma: no cover - exotic streams
            pass


def main(argv: list[str] | None = None) -> int:
    _use_utf8_output()
    load_env_file()
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
