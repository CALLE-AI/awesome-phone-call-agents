from __future__ import annotations

import sys

from . import checkin, db, review, seed as seeding
from .providers import FakeProvider

USAGE = "usage: python -m holdfor (init | run-due | serve)"


def cmd_init() -> None:
    conn = db.connect()
    db.init(conn)
    existing = conn.execute("SELECT COUNT(*) AS n FROM patient").fetchone()["n"]
    if existing:
        print(f"{db.default_path()}: already seeded ({existing} patients)")
    else:
        seeding.seed(conn)
        print(f"{db.default_path()}: schema applied, {len(seeding.PATIENTS)} patients seeded")
    conn.close()


def cmd_run_due() -> None:
    conn = db.connect()
    provider = FakeProvider()
    due = seeding.due_today(conn)
    if not due:
        print("Nothing due today.")
    for appointment_id in due:
        try:
            review_item_id = checkin.run(conn, provider, appointment_id)
        except checkin.Refused as refused:
            print(f"appointment {appointment_id}: refused ({refused.reason})")
        else:
            status = review.settle(conn, review_item_id)
            print(
                f"appointment {appointment_id}: review item {review_item_id} ({status})"
            )
    conn.close()


def cmd_serve() -> None:
    import uvicorn

    from .app import create_app

    uvicorn.run(create_app(), host="127.0.0.1", port=8000)


def main() -> int:
    commands = {"init": cmd_init, "run-due": cmd_run_due, "serve": cmd_serve}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(USAGE, file=sys.stderr)
        return 2
    commands[sys.argv[1]]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
