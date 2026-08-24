from __future__ import annotations

import os
import sqlite3
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import checkin, db, rebooking, review, window
from .models import ReviewStatus
from .providers import default_provider

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


def create_app(db_path: str | None = None, provider=None, clock=None) -> FastAPI:
    """Build the board.

    `clock` returns the local time the Reading Window is judged against. It is
    injected so a test can sit inside the window deliberately rather than pass or
    fail on the hour the suite happens to run at; nothing in production passes it.
    """
    app = FastAPI(title="HoldFor board")
    app.state.db_path = db_path or db.default_path()
    app.state.provider = provider or default_provider()
    app.state.clock = clock or datetime.now

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
    def place_checkin(
        appointment_id: int,
        request: Request,
        conn: sqlite3.Connection = Depends(connection),
    ):
        """Place one Check-in Call, named in the path.

        The same work `POST /checkins` does for the whole day, for one Appointment.
        It exists so the board has a control that spends one call rather than
        however many are due, which is the only kind of dial worth practising with.
        """
        html = _from_form(request)
        try:
            review_item_id = checkin.run(
                conn, app.state.provider, appointment_id, now=app.state.clock()
            )
        except checkin.Refused as refused:
            if html:
                return RedirectResponse(
                    url=f"/?refused={refused.reason}", status_code=303
                )
            return JSONResponse(status_code=409, content={"refused": refused.reason})
        except checkin.AwaitingReconciliation as pending:
            # An attempt for this Appointment is unresolved. 409 rather than a
            # retryable error on purpose: the correct next step is a person
            # reading the provider's record, never this endpoint being called
            # again.
            if html:
                return RedirectResponse(
                    url=f"/?refused={pending.state}", status_code=303
                )
            return JSONResponse(
                status_code=409,
                content={"awaiting_reconciliation": pending.state},
            )
        except LookupError as missing:
            raise HTTPException(status_code=404, detail=str(missing))
        status = review.settle(conn, review_item_id)
        if html:
            return RedirectResponse(url="/?placed=1", status_code=303)
        return {"review_item_id": review_item_id, "status": status}

    @app.get("/board")
    def board(conn: sqlite3.Connection = Depends(connection)) -> dict:
        return board_payload(conn, app.state.provider, app.state.clock().date())

    @app.get("/", response_class=HTMLResponse)
    def queue(request: Request, conn: sqlite3.Connection = Depends(connection)):
        return TEMPLATES.TemplateResponse(
            request=request,
            name="board.html",
            context=board_payload(
                conn, app.state.provider, app.state.clock().date()
            ),
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
        payload = detail_payload(conn, review_item_id)
        return TEMPLATES.TemplateResponse(
            request=request,
            name="detail.html",
            context={**payload, "today": date.today().isoformat()},
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
        return RedirectResponse(f"/review-items/{review_item_id}/view", 303)
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
    }


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
        # Check-ins only. A Rebooking Call never has a Review Item of its own, so
        # without the kind a successful second call reports itself as a submission
        # nobody confirmed.
        "awaiting_reconciliation": conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM call_attempt
            LEFT JOIN review_item ON review_item.call_attempt_id = call_attempt.id
            WHERE review_item.id IS NULL AND call_attempt.kind = 'checkin'
            """
        ).fetchone()["n"],
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
