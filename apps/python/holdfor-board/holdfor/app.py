from __future__ import annotations

import os
import sqlite3
import threading
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import checkin, db, rebooking, review, window
from .models import CallState, ReviewStatus
from .providers import POLL_BUDGET_SECONDS, default_provider

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).with_name("templates")))

# The handset of whoever is sitting at the board. Named so a calibration call can be
# aimed at a phone in the room and seen to be aimed there, before anybody presses Run.
# The number is compared and then discarded: what reaches the template is a mask and a
# flag, never the digits.
MY_HANDSET = "HOLDFOR_MY_HANDSET"

BOARD_QUERY = """
SELECT review_item.id                 AS id,
       review_item.feeling            AS feeling,
       review_item.medication_ok      AS medication_ok,
       review_item.wants_seen         AS wants_seen,
       review_item.carried_words_text AS carried_words_text,
       review_item.carried_words_turn AS carried_words_turn,
       review_item.stop_condition     AS stop_condition,
       review_item.stop_reason        AS stop_reason,
       review_item.status             AS status,
       review_item.created_at         AS created_at,
       call_attempt.state             AS call_state,
       call_attempt.transcript_path   AS transcript_path,
       appointment.id                 AS appointment_id,
       appointment.seen_on            AS seen_on,
       appointment.appointment_type   AS appointment_type,
       patient.first_name             AS first_name,
       patient.surname                AS surname
FROM review_item
JOIN call_attempt ON call_attempt.id = review_item.call_attempt_id
JOIN appointment  ON appointment.id  = call_attempt.appointment_id
JOIN patient      ON patient.id      = appointment.patient_id
ORDER BY review_item.created_at DESC, review_item.id DESC
"""


DUE_QUERY = """
SELECT appointment.id               AS appointment_id,
       appointment.seen_on          AS seen_on,
       appointment.appointment_type AS appointment_type,
       patient.first_name           AS first_name,
       patient.surname              AS surname,
       patient.phone_e164           AS phone_e164,
       patient.consent_to_call      AS consent_to_call
FROM appointment
JOIN patient ON patient.id = appointment.patient_id
WHERE NOT EXISTS (
    SELECT 1 FROM call_attempt
    WHERE call_attempt.appointment_id = appointment.id
      AND call_attempt.kind = 'checkin'
)
ORDER BY appointment.id
"""


UNFINISHED_QUERY = """
SELECT call_attempt.id         AS attempt_id,
       call_attempt.state      AS state,
       call_attempt.updated_at AS updated_at,
       appointment.id          AS appointment_id,
       patient.first_name      AS first_name,
       patient.surname         AS surname,
       patient.phone_e164      AS phone_e164
FROM call_attempt
JOIN appointment  ON appointment.id = call_attempt.appointment_id
JOIN patient      ON patient.id     = appointment.patient_id
LEFT JOIN review_item ON review_item.call_attempt_id = call_attempt.id
WHERE review_item.id IS NULL
  AND call_attempt.kind = 'checkin'
ORDER BY call_attempt.id
"""

# A call still worth waiting for is one that was submitted and is bound to a run.
# `.value` on both, because a StrEnum member does not hash as its own string and a
# set of members would silently match nothing a query returns.
STILL_RINGING = frozenset({CallState.RESERVED.value, CallState.ACCEPTED.value})

# How long past its own poll budget an attempt may look like a call in progress.
# Beyond this nothing is coming: the worker holding it died, or the process did, and
# it is an attempt for a person to reconcile — which is what every unfinished attempt
# was before the board stopped waiting for the poll.
RINGING_GRACE = timedelta(seconds=POLL_BUDGET_SECONDS + 60)


def masked(number: str) -> str:
    """Enough of a number to recognise, not enough to read off a recording.

    The board is on screen in a recorded demo and every number dialled belongs to
    somebody on this team. Convention follows apps/python/leash/README.md.
    """
    if len(number) < 8:
        return "*" * len(number)
    return number[:5] + "*" * (len(number) - 7) + number[-2:]


def due_checkins(conn, today):
    """Whose Check-in Call is still to be placed, and how many consent gates out.

    The weekend shift lives in `window.due_date`, which is Python, so the date
    comparison happens here rather than in the query.
    """
    rows = [dict(row) for row in conn.execute(DUE_QUERY).fetchall()]
    due = [r for r in rows if window.due_date(r["seen_on"]) == today]
    withheld = sum(1 for r in due if not r["consent_to_call"])
    mine = os.environ.get(MY_HANDSET) or None
    callable_now = []
    for row in due:
        if not row["consent_to_call"]:
            continue
        row["phone_masked"] = masked(row["phone_e164"])
        row["yours"] = mine is not None and row["phone_e164"] == mine
        del row["phone_e164"]
        callable_now.append(row)
    return callable_now, withheld


def unfinished(conn) -> tuple[list[dict], int]:
    """The Check-in Calls with no Review Item, split by whether one is still coming.

    These used to be one number. Handing the poll to a worker makes them two
    different questions, and getting it wrong is worse than not asking: a call
    placed thirty seconds ago is a phone ringing, and telling a Reviewer to go and
    reconcile it against the provider by hand would be a lie about a call she can
    still hear.

    The masking rule is the one `due_checkins` follows. What reaches the page is a
    mask; the digits are read here and dropped.
    """
    now = datetime.now(timezone.utc)
    ringing, unreconciled = [], 0
    for row in conn.execute(UNFINISHED_QUERY).fetchall():
        row = dict(row)
        still_going = (
            row["state"] in STILL_RINGING
            and now - datetime.fromisoformat(row["updated_at"]) < RINGING_GRACE
        )
        if not still_going:
            unreconciled += 1
            continue
        row["phone_masked"] = masked(row.pop("phone_e164"))
        ringing.append(row)
    return ringing, unreconciled


def in_the_background(work) -> None:
    """Wait for a phone call somewhere a browser is not.

    A daemon thread rather than a task on the event loop, because the work is a
    blocking poll with a five-minute budget and its own SQLite connection, and
    because it must not be cancelled by the request that started it going away.
    Nothing is lost if the process dies mid-call: the attempt stays unfinished,
    which the board reads as needing a person.
    """
    threading.Thread(target=work, daemon=True).start()


def create_app(
    db_path: str | None = None, provider=None, clock=None, background=None
) -> FastAPI:
    """Build the board.

    `clock` returns the local time the Reading Window is judged against. It is
    injected so a test can sit inside the window deliberately rather than pass or
    fail on the hour the suite happens to run at; nothing in production passes it.

    `background` is where a placed call goes to be waited for. Injected for the same
    reason as the clock: a test that runs it inline can assert on what the call
    produced instead of on when a thread got round to it.
    """
    app = FastAPI(title="HoldFor board")
    app.state.db_path = db_path or db.default_path()
    app.state.provider = provider or default_provider()
    app.state.clock = clock or datetime.now
    app.state.background = background or in_the_background

    def connection(request: Request) -> sqlite3.Connection:
        conn = db.connect(request.app.state.db_path)
        try:
            yield conn
        finally:
            conn.close()

    @app.post("/checkins", status_code=201)
    async def place_due_checkins(request: Request):
        """Place today's Check-in Calls from the board.

        The scheduler was cut on the basis that calls fire from a button here, so
        this is that button. One attempt each: an Appointment already carrying a
        checkin attempt is not in `due` and cannot be reached from this route.
        """
        return await run_in_threadpool(
            _place_due_now,
            app.state.db_path,
            app.state.provider,
            app.state.clock(),
            _wants_html(request),
        )

    @app.post("/checkins/{appointment_id}", status_code=201)
    async def place_checkin(appointment_id: int, request: Request):
        """Place one Check-in Call, named in the path.

        A browser gets the board back as soon as the call is out of the door. The
        poll that waits for an 82-year-old to finish a sentence runs behind the
        page, and the page says a call is in progress and refreshes itself until it
        lands. Holding the response open instead meant a spinner for the length of a
        conversation and a board that only told the truth after a manual reload.

        A JSON caller still waits and still gets the Review Item back, because it
        asked for the outcome rather than for a page.
        """
        return await run_in_threadpool(
            _place_one_now,
            app.state.db_path,
            app.state.provider,
            app.state.clock(),
            appointment_id,
            _from_form(request),
            app.state.background,
        )

    @app.get("/board")
    def board(conn: sqlite3.Connection = Depends(connection)) -> dict:
        return board_payload(conn, app.state.provider, app.state.clock().date())

    @app.get("/", response_class=HTMLResponse)
    def queue(
        request: Request,
        opened: int | None = Query(default=None, alias="open"),
        conn: sqlite3.Connection = Depends(connection),
    ):
        """The queue, and optionally one item read over the top of it.

        `?open=` rather than a page of its own so the row a Reviewer came from is
        still behind her when she decides. The item is fetched only when asked for:
        the transcript is a file read, and the board reloads itself every few seconds
        while a call is in the air.
        """
        context = board_payload(conn, app.state.provider, app.state.clock().date())
        if opened is not None:
            context = {**context, **sheet_payload(conn, opened)}
        return TEMPLATES.TemplateResponse(
            request=request, name="board.html", context=context
        )

    @app.get("/review-items/{review_item_id}")
    def detail(
        review_item_id: int, conn: sqlite3.Connection = Depends(connection)
    ) -> dict:
        return detail_payload(conn, review_item_id)

    @app.get("/review-items/{review_item_id}/view", response_class=HTMLResponse)
    def detail_page(
        review_item_id: int,
        request: Request,
        conn: sqlite3.Connection = Depends(connection),
    ):
        return TEMPLATES.TemplateResponse(
            request=request,
            name="detail.html",
            context=detail_payload(conn, review_item_id),
        )

    # The three writing endpoints read their body before touching the database, so
    # they are async, and an async handler runs on the event loop while a sync
    # dependency runs in a worker thread. A SQLite connection cannot cross that line.
    # Each write therefore opens its own connection inside the same worker that uses
    # it, rather than borrowing one from a dependency.

    @app.post("/review-items/{review_item_id}/release", status_code=201)
    async def release(review_item_id: int, request: Request):
        body = await _body(request)
        return await run_in_threadpool(
            _release_now,
            app.state.db_path,
            review_item_id,
            body,
            _wants_html(request),
        )

    @app.post("/review-items/{review_item_id}/close", status_code=201)
    async def close(review_item_id: int, request: Request):
        return await run_in_threadpool(
            _terminate_now,
            app.state.db_path,
            review_item_id,
            ReviewStatus.CLOSED,
            _wants_html(request),
        )

    @app.post("/releases/{release_id}/run", status_code=201)
    async def run_rebooking(release_id: int, request: Request):
        """Place the one call a Release granted. Pressing this twice never rings twice."""
        return await run_in_threadpool(
            _run_rebooking_now,
            app.state.db_path,
            app.state.provider,
            release_id,
            _wants_html(request),
        )

    @app.post("/review-items/{review_item_id}/manual", status_code=201)
    async def manual(review_item_id: int, request: Request):
        return await run_in_threadpool(
            _terminate_now,
            app.state.db_path,
            review_item_id,
            ReviewStatus.RANG_MANUALLY,
            _wants_html(request),
        )

    return app


def _release_now(db_path: str, review_item_id: int, body: dict, html: bool):
    conn = db.connect(db_path)
    try:
        release_id = review.release(conn, review_item_id, body)
    except review.Rejected as rejected:
        return JSONResponse(
            status_code=rejected.status, content={"error": rejected.code}
        )
    except LookupError as missing:
        raise HTTPException(status_code=404, detail=str(missing))
    finally:
        conn.close()
    if html:
        # Back to the queue, not back to the item. The Release has moved it out of
        # what needs a person and into "Released, awaiting the call", where the Run
        # button is — and the form she just submitted would otherwise still be sitting
        # there offering to grant a second one.
        return RedirectResponse("/", 303)
    return JSONResponse(status_code=201, content={"release_id": release_id})


def _terminate_now(
    db_path: str, review_item_id: int, status: ReviewStatus, html: bool
):
    conn = db.connect(db_path)
    try:
        settled = review.terminate(conn, review_item_id, status)
    except review.Rejected as rejected:
        return JSONResponse(
            status_code=rejected.status, content={"error": rejected.code}
        )
    except LookupError as missing:
        raise HTTPException(status_code=404, detail=str(missing))
    finally:
        conn.close()
    if html:
        return RedirectResponse("/", 303)
    return JSONResponse(status_code=201, content={"status": settled})


def _run_rebooking_now(db_path: str, provider, release_id: int, html: bool):
    conn = db.connect(db_path)
    try:
        outcome = rebooking.run(conn, provider, release_id)
    except rebooking.Refused as refused:
        if html:
            # The reason travels in the query string rather than being swallowed: a
            # missing booking line looks exactly like a broken button otherwise.
            return RedirectResponse(f"/?refused={refused.reason}", 303)
        return JSONResponse(status_code=409, content={"refused": refused.reason})
    except review.Rejected as rejected:
        return JSONResponse(
            status_code=rejected.status, content={"error": rejected.code}
        )
    except LookupError as missing:
        raise HTTPException(status_code=404, detail=str(missing))
    finally:
        conn.close()
    if html:
        return RedirectResponse("/", 303)
    return JSONResponse(status_code=201, content=outcome)


async def _body(request: Request) -> dict:
    """Accept a JSON body or a submitted form. The rules are the same for both."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        return await request.json()
    form = await request.form()
    return {key: value for key, value in form.items()}


def _place_one_now(db_path, provider, now, appointment_id, html, background):
    conn = db.connect(db_path)
    try:
        return _place_one(
            conn, db_path, provider, now, appointment_id, html, background
        )
    finally:
        conn.close()


def _place_one(conn, db_path, provider, now, appointment_id, html, background):
    try:
        attempt_id = checkin.start(conn, provider, appointment_id, now=now)
    except checkin.Settled as settled:
        # This Appointment's call already happened. Read it back rather than place
        # a second one.
        return _settled(conn, settled.review_item_id, html)
    except checkin.Refused as refused:
        return _stopped(refused.reason, html)
    except checkin.AwaitingReconciliation as pending:
        # An attempt for this Appointment is unresolved. 409 rather than a
        # retryable error on purpose: the correct next step is a person reading
        # the provider's record, never this endpoint being called again.
        return _stopped(pending.state, html, key="awaiting_reconciliation")
    except LookupError as missing:
        raise HTTPException(status_code=404, detail=str(missing))

    if html:
        # Submitted, bound, and nobody has picked up yet. A board is more use than a
        # spinner, so it goes back now and the waiting happens on its own connection.
        background(lambda: _finish_now(db_path, provider, attempt_id))
        return RedirectResponse(url="/", status_code=303)

    try:
        review_item_id = checkin.finish(conn, provider, attempt_id)
    except checkin.AwaitingReconciliation as pending:
        return _stopped(pending.state, html, key="awaiting_reconciliation")
    return _settled(conn, review_item_id, html)


def _finish_now(db_path: str, provider, attempt_id: int) -> None:
    """Wait for one placed call where no request is waiting for the answer.

    Its own connection, opened in the thread that uses it: a SQLite connection
    cannot cross that line. Nothing is retried and nothing is raised onward — an
    attempt this cannot finish stays unfinished, and the board already knows how to
    say so.
    """
    conn = db.connect(db_path)
    try:
        review.settle(conn, checkin.finish(conn, provider, attempt_id))
    except checkin.AwaitingReconciliation:
        pass
    finally:
        conn.close()


def _settled(conn, review_item_id: int, html: bool):
    status = review.settle(conn, review_item_id)
    if html:
        return RedirectResponse(url="/?placed=1", status_code=303)
    return {"review_item_id": review_item_id, "status": status}


def _stopped(reason: str, html: bool, key: str = "refused"):
    if html:
        return RedirectResponse(url=f"/?refused={reason}", status_code=303)
    return JSONResponse(status_code=409, content={key: reason})


def _place_due_now(db_path: str, provider, now, html: bool):
    """Walk today's due Appointments once, and report rather than raise.

    A refusal on one Patient must not stop the rest: consent and the Reading
    Window are per-Patient facts, not a failure of the run.
    """
    conn = db.connect(db_path)
    placed, refused = 0, []
    try:
        due, _ = due_checkins(conn, now.date())
        for row in due:
            try:
                review_item_id = checkin.run(
                    conn, provider, row["appointment_id"], now=now
                )
            except (checkin.Refused, checkin.AwaitingReconciliation) as stopped:
                refused.append(getattr(stopped, "reason", None) or stopped.state)
                continue
            review.settle(conn, review_item_id)
            placed += 1
    finally:
        conn.close()
    if html:
        query = f"?placed={placed}"
        if refused:
            query += "&refused=" + refused[0]
        return RedirectResponse(url="/" + query, status_code=303)
    return {"placed": placed, "refused": refused}


def _wants_html(request: Request) -> bool:
    content_type = request.headers.get("content-type", "")
    return not content_type.startswith("application/json")


# Form encodings, named. `_wants_html` cannot serve here: it treats a request with no
# content type as a browser, and this endpoint answered callers with no content type in
# JSON before it had a button. Opting in by encoding leaves that contract alone.
FORM_TYPES = ("application/x-www-form-urlencoded", "multipart/form-data")


def _from_form(request: Request) -> bool:
    content_type = request.headers.get("content-type", "")
    return content_type.startswith(FORM_TYPES)


def detail_payload(conn: sqlite3.Connection, review_item_id: int) -> dict:
    item = review.fetch(conn, review_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No review item {review_item_id}")
    turns = review.load_turns(item["transcript_path"])
    row = dict(item)
    row["stop_condition"] = bool(row["stop_condition"])
    return {
        "item": row,
        "turns": [asdict(turn) for turn in turns],
        "anchors": review.anchors(item, turns),
        # The default the Release form offers. Not `today`, which the board already
        # uses for how many calls went out: the sheet renders inside that context and
        # the shorter name would quietly turn a count into a date.
        "today_iso": date.today().isoformat(),
    }


def sheet_payload(conn: sqlite3.Connection, review_item_id: int) -> dict:
    """The same Review Item, named for a sheet that sits over the board."""
    payload = detail_payload(conn, review_item_id)
    payload["open_item"] = payload.pop("item")
    return payload


def board_payload(
    conn: sqlite3.Connection, provider=None, due_on: date | None = None
) -> dict:
    """The queue lists only what needs a person. The counts cover the whole day.

    The ratio is the only number showing the practice got something back for the
    calls it placed, so it is counted from the rows rather than illustrated.

    Two dates, and they are not the same question. The counts filter rows by when
    they were written, which is the real clock in `db.now_iso()` and nothing else.
    `due_on` asks which Appointments come due, which is the clock the endpoints are
    judged against — passed in, so the day the board describes is the day its own
    buttons act on.
    """
    items = [dict(row) for row in conn.execute(BOARD_QUERY).fetchall()]
    for item in items:
        item["stop_condition"] = bool(item["stop_condition"])
    stamp = date.today().isoformat()
    todays = [item for item in items if item["created_at"].startswith(stamp)]
    due, withheld = due_checkins(conn, due_on or date.today())
    ringing, unreconciled = unfinished(conn)
    return {
        # Whether pressing a button on this page spends one of twenty calls. The
        # board says so before it is pressed rather than after.
        "live": bool(getattr(provider, "live", False)),
        "due": due,
        "due_without_consent": withheld,
        "today": len(todays),
        # Both of these are counts of things that are not Review Items, which is
        # why they are read separately rather than derived from `items`.
        "live_calls": conn.execute(
            "SELECT COUNT(*) AS n FROM live_call"
        ).fetchone()["n"],
        # A call on the phone right now. The page refreshes itself while this is not
        # empty, and stops when it empties, so a settled board sits still.
        "in_flight": ringing,
        "awaiting_reconciliation": unreconciled,
        "auto_closed": sum(
            1 for item in todays if item["status"] == ReviewStatus.AUTO_CLOSED
        ),
        "needs_review": sum(
            1 for item in todays if item["status"] == ReviewStatus.NEEDS_REVIEW
        ),
        # Settled without a person, and counted separately because they mean
        # opposite things: she refused, or she was never reached. Without these the
        # counts do not reconcile against `today` and a refusal is invisible.
        # See docs/adr/0006.
        "declined": sum(
            1 for item in todays if item["status"] == ReviewStatus.DECLINED
        ),
        "not_reached": sum(
            1 for item in todays if item["status"] == ReviewStatus.NOT_REACHED
        ),
        # The one outcome the whole board exists to reach. Counted for the same
        # reason as the two above: without it a booked item leaves `needs_review`
        # and lands nowhere, which reads as the row having been lost.
        "booked": sum(
            1 for item in todays if item["status"] == ReviewStatus.BOOKED
        ),
        "items": [
            item for item in items if item["status"] == ReviewStatus.NEEDS_REVIEW
        ],
        # A released item is on neither list: not waiting for a person, not settled
        # either. Without this it is invisible, and nothing can place its call.
        # See docs/adr/0006, amendment.
        "awaiting_call": [
            dict(row) for row in review.released_awaiting_call(conn)
        ],
    }
