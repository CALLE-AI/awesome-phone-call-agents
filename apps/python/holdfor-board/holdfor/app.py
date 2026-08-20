from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from . import checkin, db
from .models import ReviewStatus
from .providers import FakeProvider

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


def create_app(db_path: str | None = None, provider=None) -> FastAPI:
    app = FastAPI(title="HoldFor board")
    app.state.db_path = db_path or db.default_path()
    app.state.provider = provider or FakeProvider()

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
            review_item_id = checkin.run(conn, app.state.provider, appointment_id)
        except checkin.Refused as refused:
            return JSONResponse(status_code=409, content={"refused": refused.reason})
        except LookupError as missing:
            raise HTTPException(status_code=404, detail=str(missing))
        return {"review_item_id": review_item_id}

    @app.get("/board")
    def board(conn: sqlite3.Connection = Depends(connection)) -> dict:
        return board_payload(conn)

    @app.get("/", response_class=HTMLResponse)
    def queue(request: Request, conn: sqlite3.Connection = Depends(connection)):
        return TEMPLATES.TemplateResponse(
            request=request, name="board.html", context=board_payload(conn)
        )

    return app


def board_payload(conn: sqlite3.Connection) -> dict:
    items = [dict(row) for row in conn.execute(BOARD_QUERY).fetchall()]
    for item in items:
        item["stop_condition"] = bool(item["stop_condition"])
    stamp = date.today().isoformat()
    todays = [item for item in items if item["created_at"].startswith(stamp)]
    return {
        "today": len(todays),
        "auto_closed": sum(
            1 for item in todays if item["status"] == ReviewStatus.AUTO_CLOSED
        ),
        "needs_review": sum(
            1 for item in todays if item["status"] == ReviewStatus.NEEDS_REVIEW
        ),
        "items": items,
    }
