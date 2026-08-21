from __future__ import annotations

import sqlite3
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import checkin, db, review
from .models import ReviewStatus
from .providers import default_provider

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).with_name("templates")))

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

    @app.post("/checkins/{appointment_id}", status_code=201)
    def place_checkin(
        appointment_id: int, conn: sqlite3.Connection = Depends(connection)
    ) -> dict:
        try:
            review_item_id = checkin.run(
                conn, app.state.provider, appointment_id, now=app.state.clock()
            )
        except checkin.Refused as refused:
            return JSONResponse(status_code=409, content={"refused": refused.reason})
        except checkin.AwaitingReconciliation as pending:
            # An attempt for this Appointment is unresolved. 409 rather than a
            # retryable error on purpose: the correct next step is a person
            # reading the provider's record, never this endpoint being called
            # again.
            return JSONResponse(
                status_code=409,
                content={"awaiting_reconciliation": pending.state},
            )
        except LookupError as missing:
            raise HTTPException(status_code=404, detail=str(missing))
        status = review.settle(conn, review_item_id)
        return {"review_item_id": review_item_id, "status": status}

    @app.get("/board")
    def board(conn: sqlite3.Connection = Depends(connection)) -> dict:
        return board_payload(conn)

    @app.get("/", response_class=HTMLResponse)
    def queue(request: Request, conn: sqlite3.Connection = Depends(connection)):
        return TEMPLATES.TemplateResponse(
            request=request, name="board.html", context=board_payload(conn)
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


async def _body(request: Request) -> dict:
    """Accept a JSON body or a submitted form. The rules are the same for both."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        return await request.json()
    form = await request.form()
    return {key: value for key, value in form.items()}


def _wants_html(request: Request) -> bool:
    content_type = request.headers.get("content-type", "")
    return not content_type.startswith("application/json")


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


def board_payload(conn: sqlite3.Connection) -> dict:
    """The queue lists only what needs a person. The counts cover the whole day.

    The ratio is the only number showing the practice got something back for the
    calls it placed, so it is counted from the rows rather than illustrated.
    """
    items = [dict(row) for row in conn.execute(BOARD_QUERY).fetchall()]
    for item in items:
        item["stop_condition"] = bool(item["stop_condition"])
    stamp = date.today().isoformat()
    todays = [item for item in items if item["created_at"].startswith(stamp)]
    return {
        "today": len(todays),
        # Both of these are counts of things that are not Review Items, which is
        # why they are read separately rather than derived from `items`.
        "live_calls": conn.execute(
            "SELECT COUNT(*) AS n FROM live_call"
        ).fetchone()["n"],
        "awaiting_reconciliation": conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM call_attempt
            LEFT JOIN review_item ON review_item.call_attempt_id = call_attempt.id
            WHERE review_item.id IS NULL
            """
        ).fetchone()["n"],
        "auto_closed": sum(
            1 for item in todays if item["status"] == ReviewStatus.AUTO_CLOSED
        ),
        "needs_review": sum(
            1 for item in todays if item["status"] == ReviewStatus.NEEDS_REVIEW
        ),
        "items": [
            item for item in items if item["status"] == ReviewStatus.NEEDS_REVIEW
        ],
    }
