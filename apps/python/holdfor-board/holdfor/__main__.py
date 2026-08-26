from __future__ import annotations

import sys

from . import checkin, db, envfile, reextract, review, seed as seeding, window
from .extract import extract
from .models import CallResult, CallState
from .providers import LIVE_FLAG, default_provider

USAGE = (
    "usage: python -m holdfor "
    "(init | run-due | call <appointment_id> | read-back | serve)"
)


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
    now = window.clock()
    if window.pinned():
        # Never quietly. The Reading Window is the rule this appears to bend, and a
        # line saying which clock refused or allowed a call is the difference between
        # a test and a call nobody can account for.
        print(f"{window.PINNED} is set: this call is judged against {now:%a %d %b %H:%M}.")
    try:
        review_item_id = checkin.run(conn, provider, appointment_id, now=now)
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


def cmd_read_back(_: list[str]) -> int:
    """Read the bounded answers back out of transcripts already on disk.

    For calls that landed before the second pass existed, or before a key did. A
    settled Review Item is never re-extracted by `finish` — it returns the item that
    already exists, which is what keeps one Appointment to one Check-in Call — so
    without this the only way to see answers on an old call is to spend another one of
    the twenty dialling it again.

    Only ever fills gaps. An Item whose answers came from the agent is left alone, and
    so is one that already has them. Nothing here dials.
    """
    if not reextract.available():
        print(
            f"{reextract.KEY} is not set, so there is nothing to read answers with.",
            file=sys.stderr,
        )
        return 2

    try:
        import anthropic  # noqa: F401
    except ImportError:
        # The library is an optional extra, so a key on its own is not enough. Said
        # here rather than letting every row report "no answers came back", which is
        # true and tells nobody what to do about it.
        print(
            "The extract extra is not installed:  uv sync --extra extract",
            file=sys.stderr,
        )
        return 2

    conn = db.connect()
    rows = conn.execute(
        """
        SELECT review_item.id                   AS item,
               call_attempt.transcript_path     AS path,
               appointment.medication_changed   AS changed,
               patient.first_name               AS who
        FROM review_item
        JOIN call_attempt ON call_attempt.id = review_item.call_attempt_id
        JOIN appointment  ON appointment.id  = call_attempt.appointment_id
        JOIN patient      ON patient.id      = appointment.patient_id
        WHERE review_item.feeling IS NULL
          AND call_attempt.transcript_path IS NOT NULL
        ORDER BY review_item.id
        """
    ).fetchall()

    if not rows:
        print("Nothing to read back: every stored transcript already has answers.")
        conn.close()
        return 0

    for row in rows:
        turns = review.load_turns(row["path"])
        answers = reextract.structured_from(turns, bool(row["changed"]))
        if not answers:
            print(f"item {row['item']} ({row['who']}): no answers came back")
            continue
        # Through `extract`, not around it: the same bounds and the same verbatim
        # check on the quote that a call's own block would have faced.
        extraction = extract(
            CallResult(
                state=CallState.TERMINAL_VERIFIED,
                transcript=turns,
                structured=answers,
                outcome=None,
            ),
            bool(row["changed"]),
        )
        if extraction.feeling is None:
            print(f"item {row['item']} ({row['who']}): refused ({extraction.stop_reason})")
            continue
        conn.execute(
            """
            UPDATE review_item
            SET feeling = ?, medication_ok = ?, wants_seen = ?,
                carried_words_text = COALESCE(carried_words_text, ?),
                carried_words_turn = COALESCE(carried_words_turn, ?),
                answers_from = ?
            WHERE id = ?
            """,
            (
                extraction.feeling.value,
                extraction.medication_ok.value if extraction.medication_ok else None,
                extraction.wants_seen.value if extraction.wants_seen else None,
                extraction.carried_words_text,
                extraction.carried_words_turn,
                reextract.FROM_TRANSCRIPT,
                row["item"],
            ),
        )
        print(
            f"item {row['item']} ({row['who']}): {extraction.feeling.value}, "
            f"wants seen {extraction.wants_seen.value if extraction.wants_seen else '-'}"
        )
    conn.commit()
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
    "read-back": cmd_read_back,
    "serve": cmd_serve,
}


def main(argv: list[str] | None = None) -> int:
    # Before anything reads a setting. Every one of them is an environment variable,
    # and the two phone numbers sat in `.env` with nothing to read them: a server
    # launched from a shell that had not sourced the file refused every Rebooking Call
    # with `no_booking_line`, which is indistinguishable from a broken button. What is
    # already in the environment still wins, so a variable typed on the command line
    # cannot be countermanded by a file.
    envfile.load(envfile.DEFAULT)

    args = list(argv if argv is not None else sys.argv[1:])
    if not args or args[0] not in COMMANDS:
        print(USAGE, file=sys.stderr)
        return 2
    return COMMANDS[args[0]](args[1:])


if __name__ == "__main__":
    raise SystemExit(main())
