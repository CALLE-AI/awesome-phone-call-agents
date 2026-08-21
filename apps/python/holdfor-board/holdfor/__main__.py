from __future__ import annotations

import sys

from . import checkin, db, review, seed as seeding
from .providers import LIVE_FLAG, default_provider

USAGE = "usage: python -m holdfor (init | run-due | call <appointment_id> | serve)"


def cmd_init(_: list[str]) -> int:
    conn = db.connect()
    db.init(conn)
    existing = conn.execute("SELECT COUNT(*) AS n FROM patient").fetchone()["n"]
    if existing:
        print(f"{db.default_path()}: already seeded ({existing} patients)")
    else:
        seeding.seed(conn)
        print(f"{db.default_path()}: schema applied, {len(seeding.PATIENTS)} patients seeded")
    conn.close()
    return 0


def place(conn, provider, appointment_id: int) -> None:
    """One appointment, one line of output, whichever provider is in hand."""
    try:
        review_item_id = checkin.run(conn, provider, appointment_id)
    except checkin.Refused as refused:
        print(f"appointment {appointment_id}: refused ({refused.reason})")
    except checkin.AwaitingReconciliation as pending:
        print(
            f"appointment {appointment_id}: {pending.state} — reconcile by hand, "
            "do not re-run"
        )
    except LookupError as missing:
        print(f"appointment {appointment_id}: {missing}", file=sys.stderr)
    else:
        # Auto-closing is an active step, never the default. If this line were
        # dropped the call would still be safe: it would wait for a person.
        status = review.settle(conn, review_item_id)
        print(f"appointment {appointment_id}: review item {review_item_id} ({status})")


def cmd_run_due(_: list[str]) -> int:
    """Work through everything due today, but never over a live provider.

    Fanning out is right against fixtures and wrong against a phone network. Seven
    appointments come due on a normal weekday, which is more than a third of the
    twenty-call budget in one command that differs from the safe one only by an
    environment variable somebody left set in a shell.

    This is not a budget cap. `call` may be run as often as you like. It removes
    the case where nobody chose to spend the calls.
    """
    conn = db.connect()
    provider = default_provider()
    due = seeding.due_today(conn)

    if getattr(provider, "live", False):
        print(
            f"{LIVE_FLAG} is set and {len(due)} appointment(s) are due. "
            f"run-due will not place {len(due)} real calls.",
            file=sys.stderr,
        )
        print(
            "Dial one at a time:  python -m holdfor call <appointment_id>",
            file=sys.stderr,
        )
        if due:
            print(f"Due today: {', '.join(str(one) for one in due)}", file=sys.stderr)
        conn.close()
        return 2

    if not due:
        print("Nothing due today.")
    for appointment_id in due:
        place(conn, provider, appointment_id)
    conn.close()
    return 0


def cmd_call(args: list[str]) -> int:
    """Place exactly one Check-in Call, named on the command line.

    The only route to a live call. Two calibration calls are two commands, each
    one typed on purpose with a number in it.
    """
    if len(args) != 1 or not args[0].isdigit():
        print("usage: python -m holdfor call <appointment_id>", file=sys.stderr)
        return 2

    conn = db.connect()
    provider = default_provider()
    if getattr(provider, "live", False):
        print(f"{LIVE_FLAG} is set: this places a REAL call.", file=sys.stderr)
    place(conn, provider, int(args[0]))
    conn.close()
    return 0


def cmd_serve(_: list[str]) -> int:
    import uvicorn

    from .app import create_app

    uvicorn.run(create_app(), host="127.0.0.1", port=8000)
    return 0


COMMANDS = {
    "init": cmd_init,
    "run-due": cmd_run_due,
    "call": cmd_call,
    "serve": cmd_serve,
}


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if not args or args[0] not in COMMANDS:
        print(USAGE, file=sys.stderr)
        return 2
    return COMMANDS[args[0]](args[1:])


if __name__ == "__main__":
    raise SystemExit(main())
