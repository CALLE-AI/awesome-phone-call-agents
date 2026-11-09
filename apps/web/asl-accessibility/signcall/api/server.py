"""
The HTTP API the frontend talks to.

    POST /runs               -> 202 {run_id, status, mock_mode, plan}
    GET  /runs/{id}          -> {status, proposal, result | error | reason, plan,
                                 started_at, finished_at}
    POST /runs/{id}/confirm  -> the user's answer: {"approved": true | false}
    POST /runs/{id}/cancel   -> 202; cancels an already-succeeded booking.
                                Optional body {"result": {...}, "patient_name": "..."}
                                supplies the booking's own details when this process
                                no longer remembers the run.
    GET  /health             -> mode flags and whether credentials are present

A run's status goes running -> awaiting_confirmation -> running -> one of
succeeded | declined | failed. A succeeded run can move on once more, only at
the user's request: succeeded -> cancelling -> cancelled | cancel_failed.

Design:

  - The POST body is the object schemas/user_input.schema.json defines. It is
    validated synchronously, so a malformed profile gets a 400 with the
    validator's message and no call is placed.
  - A run places many calls over several minutes, so it runs on a background
    thread and the caller polls.
  - Submitting consents to the search. Nothing is booked until a second
    answer: once a clinic slot and an interpreter are lined up the run pauses
    in awaiting_confirmation with a `proposal`, and waits for POST .../confirm.
    No answer within SIGNCALL_CONFIRM_TIMEOUT_SECONDS (default 900) counts as
    "no" and the run ends as declined.
  - This server keeps no durable storage. `_runs` is an in-memory dict that
    disappears on restart, while the frontend's database outlives it, so
    POST .../cancel accepts the booking's stored `result` and "adopts" a run
    this process has forgotten.

Run it from the directory above signcall/ (see the README), never with
--workers > 1 or --reload: the run lock, the run registry and the real-mode
line assignments are per-process.

    CALLE_MOCK_MODE=1 SIGNCALL_API_DEMO_MOCKS=1 \\
        uvicorn signcall.api.server:app --host 127.0.0.1 --port 8001
"""

from __future__ import annotations

import dataclasses
import os
import threading
import uuid
from datetime import datetime

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StrictBool

from ..calle import MOCK_MODE
from ..calle.run import TEST_LINES_ENV, clear_default_mock, register_default_mock
from ..workflow.appointment import cancel_appointment, describe_goal, run_interpreter_mesh
from ..workflow.confirmation import ApprovalFn, BookingDeclined, BookingProposal, NoMatchFound
from ..workflow.types import UserInput
from ..workflow.user_input import UserInputError, load_user_input
from . import demo_mocks, notify

ALLOW_REAL_CALLS = os.environ.get("SIGNCALL_API_ALLOW_REAL_CALLS") == "1"
USE_DEMO_MOCKS = os.environ.get("SIGNCALL_API_DEMO_MOCKS") == "1"
CONFIRM_TIMEOUT_SECONDS = float(os.environ.get("SIGNCALL_CONFIRM_TIMEOUT_SECONDS", "900"))

# CORS only stops another site's JavaScript from reading responses. It is not a
# security boundary: it does not stop anything from POSTing.
LOCALHOST_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1)(:\d+)?"

app = FastAPI(
    title="signcall",
    description="Receives a user-input profile and runs the Interpreter Mesh workflow.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=LOCALHOST_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# One run at a time. The real-mode line assignments and the mock registry are
# module-level state that every run resets, so overlapping runs would erase each
# other's assignments and a booking call could fail after the user approved it.
# The lock is held while a run waits for the user's answer.
_run_lock = threading.Lock()
_runs: dict[str, dict] = {}
_runs_guard = threading.Lock()
_active_run_id: str | None = None


@dataclasses.dataclass
class _Decision:
    """The user's answer to a pending confirmation, handed from the request
    thread that received it to the run thread waiting on it."""

    answered: threading.Event = dataclasses.field(default_factory=threading.Event)
    approved: bool = False


_decisions: dict[str, _Decision] = {}


class ConfirmRequest(BaseModel):
    approved: StrictBool


class CancelRequest(BaseModel):
    """Only needed when this process doesn't already have the run in memory.
    `result` is the dict a succeeded run's `result` field already is."""

    result: dict | None = None
    patient_name: str | None = None


def _assert_mode_is_deliberate() -> None:
    """Refuse to serve in real-call mode unless it was asked for explicitly and
    the phones to ring are configured. Submitting is the consent, so a single
    POST to a server that came up in real mode by accident would start placing
    real calls."""
    if MOCK_MODE:
        return
    if not ALLOW_REAL_CALLS:
        raise RuntimeError(
            "Refusing to start: this would serve in REAL-CALL mode, where one POST "
            "places real phone calls with no further confirmation. Set "
            "CALLE_MOCK_MODE=1 to serve safely, or SIGNCALL_API_ALLOW_REAL_CALLS=1 "
            "to say you meant it."
        )
    if not os.environ.get(TEST_LINES_ENV):
        raise RuntimeError(
            f"Refusing to start in real-call mode: {TEST_LINES_ENV} is not set. Clinic "
            f"and interpreter calls are only placed to phones you own; set it to one "
            f"or more comma-separated E.164 numbers."
        )


_assert_mode_is_deliberate()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _record(run_id: str, **fields) -> None:
    with _runs_guard:
        _runs[run_id].update(fields)


def _finish(run_id: str, **fields) -> None:
    """Records how a run ended, then tells whoever is listening."""
    _record(run_id, finished_at=_now(), **fields)
    notify.send_event({
        "event": "run_finished",
        "run_id": run_id,
        "status": fields["status"],
        "result": fields.get("result"),
        "error": fields.get("error"),
        "reason": fields.get("reason"),
    })


def _approver(run_id: str) -> ApprovalFn:
    """The approval callback for one run: publish the proposal, notify the
    frontend, and hold the run thread until the user answers or time runs out."""

    def approve(proposal: BookingProposal) -> bool:
        decision = _Decision()
        proposal_data = dataclasses.asdict(proposal)
        with _runs_guard:
            _decisions[run_id] = decision
            _runs[run_id].update(status="awaiting_confirmation", proposal=proposal_data)
        notify.send_event({
            "event": "confirmation_requested", "run_id": run_id, "proposal": proposal_data,
        })

        decision.answered.wait(timeout=CONFIRM_TIMEOUT_SECONDS)
        with _runs_guard:
            _decisions.pop(run_id, None)
            # An answer can land between the wait timing out and taking this
            # lock; it is set under the same lock, so it is visible here.
            answered = decision.answered.is_set()
        if not answered:
            raise BookingDeclined(
                f"No answer within {CONFIRM_TIMEOUT_SECONDS:g} seconds, so "
                f"nothing was booked."
            )
        return decision.approved

    return approve


def _execute(run_id: str, user: UserInput, gate: "threading.Event | None") -> None:
    """The background worker. Anything the workflow raises is recorded as a
    failed run; the HTTP response is long gone, so an uncaught exception here
    would vanish."""
    global _active_run_id
    try:
        if USE_DEMO_MOCKS:
            register_default_mock(demo_mocks.build_resolver(user, gate))
        result = run_interpreter_mesh(user, approve=_approver(run_id))
    except (BookingDeclined, NoMatchFound) as exc:
        _finish(run_id, status="declined", reason=str(exc))
    except Exception as exc:
        # Some exceptions (a timeout, for one) have an empty message.
        _finish(run_id, status="failed", error=str(exc) or type(exc).__name__,
                error_type=type(exc).__name__)
    else:
        _finish(run_id, status="succeeded", result=dataclasses.asdict(result))
    finally:
        if USE_DEMO_MOCKS:
            clear_default_mock()
        _active_run_id = None
        _run_lock.release()  # in finally so a raising run can never leave the server at 409


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "mock_mode": MOCK_MODE,
        "real_calls_allowed": ALLOW_REAL_CALLS and not MOCK_MODE,
        "demo_mocks": USE_DEMO_MOCKS,
        "notify_url_configured": bool(os.environ.get("SIGNCALL_NOTIFY_URL")),
        "confirm_timeout_seconds": CONFIRM_TIMEOUT_SECONDS,
        # Presence only, never the values.
        "calle_api_key_present": bool(os.environ.get("CALLE_API_KEY")),
        "apify_api_token_present": bool(os.environ.get("APIFY_API_TOKEN")),
        "test_lines_configured": bool(os.environ.get(TEST_LINES_ENV)),
        "active_run_id": _active_run_id,
    }


@app.post("/runs", status_code=202)
async def start_run(request: Request) -> JSONResponse:
    global _active_run_id

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    # Validated before anything is accepted, let alone dialled.
    try:
        user = load_user_input(payload)
    except UserInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not _run_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail=(
                f"A run is already in progress (run_id={_active_run_id}). This "
                f"service handles one run at a time, because concurrent runs "
                f"would place overlapping phone calls and corrupt each "
                f"other's call routing."
            ),
        )

    run_id = str(uuid.uuid4())
    plan = describe_goal(user)
    with _runs_guard:
        _runs[run_id] = {
            "run_id": run_id, "status": "running", "plan": plan,
            "mock_mode": MOCK_MODE, "started_at": _now(), "finished_at": None,
            "proposal": None, "result": None, "error": None, "error_type": None,
            "reason": None, "cancellation": None,
            # Keys starting with "_" are never returned by get_run(). The name is
            # kept so a later cancel has the patient's name without the UserInput.
            "_patient_name": user.name,
        }
    _active_run_id = run_id

    gate = _pending_gate.pop(0) if _pending_gate else None
    threading.Thread(
        target=_execute, args=(run_id, user, gate), name=f"signcall-run-{run_id[:8]}",
        daemon=False,  # a SIGINT mid-run must not kill the process between an
                       # interpreter confirming and the clinic being booked
    ).start()

    return JSONResponse(
        status_code=202,
        content={"run_id": run_id, "status": "running", "mock_mode": MOCK_MODE, "plan": plan},
    )


@app.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    with _runs_guard:
        run = _runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run with id {run_id}.")
    # Keys starting with "_" are internal bookkeeping and never leave the process.
    return {key: value for key, value in run.items() if not key.startswith("_")}


@app.post("/runs/{run_id}/confirm")
def confirm_run(run_id: str, body: ConfirmRequest) -> dict:
    """The user's answer to a run that is awaiting_confirmation. An unknown run
    is 404; one that isn't waiting (already answered, timed out or finished) is
    409, so a double click can't decide twice."""
    with _runs_guard:
        run = _runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail=f"No run with id {run_id}.")
        decision = _decisions.get(run_id)
        if run["status"] != "awaiting_confirmation" or decision is None or decision.answered.is_set():
            raise HTTPException(
                status_code=409,
                detail=f"Run {run_id} is not waiting for an answer (status: {run['status']}).",
            )
        decision.approved = body.approved
        run["status"] = "running"
        decision.answered.set()
    return {"run_id": run_id, "status": "running", "approved": body.approved}


def _execute_cancel(run_id: str) -> None:
    """The background worker for a cancel request. It places real calls, so it
    runs off the request thread and under the same lock as a booking run."""
    global _active_run_id
    try:
        if USE_DEMO_MOCKS:
            register_default_mock(demo_mocks.build_cancel_resolver())
        with _runs_guard:
            result = _runs[run_id]["result"]
            patient_name = _runs[run_id]["_patient_name"]
        cancellation = cancel_appointment(result, patient_name)
    except Exception as exc:
        _record(
            run_id, status="cancel_failed", finished_at=_now(),
            error=str(exc) or type(exc).__name__, error_type=type(exc).__name__,
        )
        notify.send_event({
            "event": "run_cancelled", "run_id": run_id, "status": "cancel_failed",
            "error": str(exc) or type(exc).__name__,
        })
    else:
        _record(run_id, status="cancelled", finished_at=_now(), cancellation=cancellation)
        notify.send_event({
            "event": "run_cancelled", "run_id": run_id, "status": "cancelled",
            "cancellation": cancellation,
        })
    finally:
        if USE_DEMO_MOCKS:
            clear_default_mock()
        _active_run_id = None
        _run_lock.release()


@app.post("/runs/{run_id}/cancel", status_code=202)
def cancel_run(run_id: str, body: CancelRequest | None = Body(default=None)) -> JSONResponse:
    """Cancels an already-succeeded booking: calls the clinic, then releases
    whoever was lined up to interpret it. Valid from `succeeded`, and
    retriable from `cancel_failed`. Refused from any other status and while a
    cancellation is already in flight.

    If this process has no memory of the run, `body.result` and
    `body.patient_name` let it adopt the run instead of returning 404. If it
    does remember the run, a supplied body still wins: the frontend's copy is
    the durable one."""
    global _active_run_id

    with _runs_guard:
        run = _runs.get(run_id)
        if run is None:
            if body is None or body.result is None or not body.patient_name:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"No run with id {run_id}, and no booking details were "
                        f"supplied to cancel it with. This server keeps no "
                        f"memory of a run across a restart; pass `result` and "
                        f"`patient_name` from your own stored record."
                    ),
                )
            run = _runs[run_id] = {
                "run_id": run_id, "status": "succeeded", "plan": None,
                "mock_mode": MOCK_MODE, "started_at": None, "finished_at": None,
                "proposal": None, "result": body.result, "error": None,
                "error_type": None, "reason": None, "cancellation": None,
                "_patient_name": body.patient_name,
            }
        elif run["status"] not in ("succeeded", "cancel_failed"):
            raise HTTPException(
                status_code=409,
                detail=f"Run {run_id} has nothing to cancel right now (status: {run['status']}).",
            )
        elif body is not None and body.result is not None:
            run["result"] = body.result
            if body.patient_name:
                run["_patient_name"] = body.patient_name

    if not _run_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail=(
                f"A run is already in progress (run_id={_active_run_id}). "
                f"Cancellation places calls through the same routing as "
                f"a booking run, so it has to wait its turn too."
            ),
        )

    with _runs_guard:
        run["status"] = "cancelling"
    _active_run_id = run_id

    threading.Thread(
        target=_execute_cancel, args=(run_id,), name=f"signcall-cancel-{run_id[:8]}",
        daemon=False,
    ).start()

    return JSONResponse(status_code=202, content={"run_id": run_id, "status": "cancelling"})


# Test-only hook: the harness pushes an Event here to hold the next run open
# long enough to show that a concurrent POST is refused. Empty in normal use.
_pending_gate: list = []
