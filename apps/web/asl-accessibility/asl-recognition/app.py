"""
FastAPI server for the ASL booking app. It serves the camera UI (static/), a
WebSocket that turns camera frames into signed words, the Gemini-backed parsing
endpoints, the profile and booking storage, and the hand-off to the signcall
workflow server.

    uvicorn app:app --host 127.0.0.1 --port 8000

Run it from this folder: model, label map and static paths are relative. The
browser only grants camera access on localhost or https.
"""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, HTTPException, Path as PathParam, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import db
from gemini_client import extract_card_fields, parse_booking_transcript
from infer import DEFAULT_CHECKPOINT, DEFAULT_LABEL_MAP, classify_features
from segmenter import SignSegmenter
from utils_landmarks import Landmarkers

# Settings come from asl-recognition/.env (see .env.example); variables already
# set in the shell win.
load_dotenv(Path(__file__).resolve().parent / ".env")

# The signcall workflow's POST /runs endpoint, where booking requests are sent.
BOOKING_WORKFLOW_URL = os.environ.get("BOOKING_WORKFLOW_URL", "")

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

app = FastAPI(title="ASL-to-text inference + booking app")

# Open CORS and no authentication: this is a local demo, not a deployable service.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    db.init_db()


CHECKPOINT = DEFAULT_CHECKPOINT
LABEL_MAP = DEFAULT_LABEL_MAP


@app.get("/health")
def health():
    return {
        "status": "ok" if Path(CHECKPOINT).exists() else "missing_checkpoint",
        "checkpoint": CHECKPOINT,
    }


@app.websocket("/ws/stream")
async def stream_endpoint(websocket: WebSocket):
    """Live sign recognition. The browser sends one JPEG frame per binary
    message; each connection owns its own Landmarkers and SignSegmenter.

      server -> client (JSON):
        {"type": "status", "signing": true|false}
        {"type": "word", "word": "...", "confidence": 0.0-1.0}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()

    if not Path(CHECKPOINT).exists() or not Path(LABEL_MAP).exists():
        await websocket.send_json({"type": "error", "message": f"missing {CHECKPOINT} or {LABEL_MAP} on the server"})
        await websocket.close()
        return

    landmarkers = Landmarkers()
    segmenter = SignSegmenter()
    was_active = False

    try:
        while True:
            data = await websocket.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                continue  # skip a corrupt frame rather than drop the connection

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            feat = landmarkers.process_frame(rgb)
            segment = segmenter.add_frame(feat)

            is_active = segmenter.is_active()
            if is_active != was_active:
                await websocket.send_json({"type": "status", "signing": is_active})
                was_active = is_active

            if segment is not None:
                try:
                    results = classify_features(segment, checkpoint=CHECKPOINT,
                                                label_map_path=LABEL_MAP, topk=1)
                except Exception as e:
                    await websocket.send_json({"type": "error", "message": f"inference failed: {e}"})
                    continue
                if results:
                    word, confidence = results[0]
                    await websocket.send_json({"type": "word", "word": word, "confidence": confidence})
    except WebSocketDisconnect:
        pass
    finally:
        landmarkers.close()


@app.post("/extract-card")
async def extract_card_endpoint(image: UploadFile = File(...)):
    """One ID or insurance card photo in, best-effort structured fields out.
    Fields not visible on the card come back empty; the user fills them in on
    the verify screen."""
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set on the server")
    image_bytes = await image.read()
    mime_type = image.content_type or "image/jpeg"
    try:
        fields = extract_card_fields(image_bytes, mime_type=mime_type)
    except Exception as e:
        raise HTTPException(500, f"card extraction failed: {e}")
    return fields


@app.post("/parse-booking")
async def parse_booking_endpoint(payload: dict = Body(...)):
    """Confirmed transcript in, structured availability out. Today's date is
    injected server-side so "Tuesday" resolves to a real calendar date."""
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set on the server")
    transcript = (payload or {}).get("transcript", "").strip()
    if not transcript:
        raise HTTPException(400, "transcript is required")
    today = date.today()
    try:
        parsed = parse_booking_transcript(
            transcript, today_iso=today.isoformat(), today_weekday=today.strftime("%A"),
        )
    except Exception as e:
        raise HTTPException(500, f"booking parse failed: {e}")
    return parsed


@app.get("/profile/{user_id}")
def get_profile_endpoint(user_id: str = PathParam(...)):
    """An unknown user_id is a normal first visit, so it returns exists=false, not a 404."""
    profile = db.get_profile(user_id)
    return {"exists": profile is not None, "profile": profile}


@app.post("/profile/{user_id}")
def save_profile_endpoint(user_id: str = PathParam(...), profile: dict = Body(...)):
    """Upsert of the full profile object (never a partial patch)."""
    db.save_profile(user_id, profile)
    return {"status": "saved"}


def _format_phone_e164(raw: str, *, who: str) -> str:
    """'(555) 123-4567' / '15551234567' -> '+15551234567'. The error names the
    bad field because the frontend shows it to the user as is."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        raise ValueError(f"{who} phone number needs to be a 10-digit US number")
    return f"+1{digits}"


def _format_time_12h(hhmm: str) -> str:
    """'14:00' -> '2PM', '16:30' -> '4:30PM' (the workflow's time format)."""
    try:
        h, m = hhmm.split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        raise ValueError(f"'{hhmm}' is not a valid time")
    period = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    minute_part = "" if m == 0 else f":{m:02d}"
    return f"{h12}{minute_part}{period}"


def _weekday_name(date_str: str) -> str:
    """Recomputed from the date; display labels from the client are not trusted."""
    try:
        return WEEKDAY_NAMES[date.fromisoformat(date_str).weekday()]
    except ValueError:
        raise ValueError(f"'{date_str}' is not a valid date (expected YYYY-MM-DD)")


@app.post("/submit-booking")
def submit_booking_endpoint(payload: dict = Body(...)):
    """Reshapes the confirm screen's payload into the signcall workflow's input
    schema and starts a run. Only the run id and its progress are stored, not
    the request."""
    if not BOOKING_WORKFLOW_URL:
        raise HTTPException(500, "BOOKING_WORKFLOW_URL is not set on the server")

    required = ["user_id", "name", "phone", "dob", "zipcode", "insurance_name",
                "insurance_id", "clinic_type", "availability", "has_interpreter"]
    missing = [f for f in required if payload.get(f) in (None, "", [])]
    if missing:
        raise HTTPException(400, f"missing required field(s): {', '.join(missing)}")

    try:
        dob = date.fromisoformat(payload["dob"])
    except ValueError:
        raise HTTPException(400, f"'{payload['dob']}' is not a valid date of birth (expected YYYY-MM-DD)")
    today = date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    try:
        workflow_payload = {
            "name": payload["name"],
            "date_of_birth": payload["dob"],
            "age": age,
            "phone_number": _format_phone_e164(payload["phone"], who="Your"),  # -> "Your phone number ..."
            "zipcode": payload["zipcode"],
            "appointment_type": payload["clinic_type"],
            "insurance": {
                "provider_name": payload["insurance_name"],
                "policy_number": payload["insurance_id"],
            },
            "availability": [
                {
                    "day": _weekday_name(a["date"]),
                    "date": a["date"],
                    "time": _format_time_12h(a["time"]),
                }
                for a in payload["availability"]
            ],
            "has_interpreter": bool(payload["has_interpreter"]),
        }
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))

    if not workflow_payload["has_interpreter"]:
        try:
            workflow_payload["family_members"] = [
                {
                    "name": m["name"],
                    "relation": m["relation"],
                    "phone_number": _format_phone_e164(m["phone"], who=f"{m.get('name') or 'Family member'}'s"),
                }
                for m in (payload.get("family") or [])
            ]
        except (KeyError, ValueError) as e:
            raise HTTPException(400, str(e))

    body = json.dumps(workflow_payload).encode("utf-8")
    req = urllib.request.Request(
        BOOKING_WORKFLOW_URL, data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            reason = json.loads(raw).get("detail", raw)
        except (json.JSONDecodeError, AttributeError):
            reason = raw
        if e.code == 409:
            # The workflow runs one booking at a time; this is retryable.
            raise HTTPException(409, f"A booking is already being processed by the workflow -- try again shortly. ({reason})")
        raise HTTPException(502, f"booking workflow rejected the request ({e.code}): {reason}"[:400])
    except urllib.error.URLError as e:
        raise HTTPException(502, f"could not reach the booking workflow at {BOOKING_WORKFLOW_URL}: {e.reason}")

    try:
        run = json.loads(resp_body)
    except json.JSONDecodeError:
        return {"status": "sent", "workflow_response": resp_body[:2000]}

    # The workflow reports by run id alone, so tie the run to this browser.
    if run.get("run_id"):
        db.register_booking(run["run_id"], payload["user_id"])

    # `plan` is the consent disclosure for the search; it must reach the user.
    return {
        "status": "sent",
        "run_id": run.get("run_id"),
        "run_status": run.get("status"),
        "mock_mode": run.get("mock_mode"),
        "plan": run.get("plan"),
    }


def _workflow_url(*parts: str) -> str:
    """A run's own endpoints hang off BOOKING_WORKFLOW_URL (POST /runs)."""
    return "/".join([BOOKING_WORKFLOW_URL.rstrip("/"), *parts])


def _booking_for(run_id: str, user_id) -> dict:
    """The booking if it belongs to this browser; otherwise the same 404, so a
    run id alone reveals nothing."""
    booking = db.get_booking(run_id)
    if booking is None or not user_id or booking["user_id"] != user_id:
        raise HTTPException(404, "No such booking.")
    return booking


def _sync_from_workflow(booking: dict) -> dict:
    """Notifications normally update a run, but one can be lost (no
    SIGNCALL_NOTIFY_URL, or this server was down). For an unfinished run, ask
    the workflow directly. Best effort: any failure keeps the stored state."""
    if booking["status"] not in ("running", "awaiting_confirmation", "cancelling") or not BOOKING_WORKFLOW_URL:
        return booking
    try:
        with urllib.request.urlopen(_workflow_url(booking["run_id"]), timeout=5) as resp:
            run = json.loads(resp.read().decode("utf-8"))
    except (OSError, ValueError):  # unreachable, HTTP error, or not JSON
        return booking

    status = run.get("status")
    if status == "awaiting_confirmation" and isinstance(run.get("proposal"), dict):
        db.record_proposal(booking["run_id"], run["proposal"])
    elif status in ("succeeded", "declined", "failed"):
        db.record_outcome(
            booking["run_id"], status,
            result=run.get("result"), error=run.get("error"), reason=run.get("reason"),
        )
    elif status in ("cancelled", "cancel_failed"):
        db.record_cancellation(
            booking["run_id"], status,
            cancellation=run.get("cancellation"), error=run.get("error"),
        )
    else:
        return booking
    return db.get_booking(booking["run_id"])


@app.post("/notifications")
def receive_notification_endpoint(payload: dict = Body(...)):
    """Receives the workflow's events (its SIGNCALL_NOTIFY_URL points here).
    They are stored and shown by the open page. Nothing authenticates the
    sender beyond the run id being unguessable.

    Events, from the workflow's api/notify.py:
      confirmation_requested  {run_id, proposal}
      run_finished            {run_id, status, result, error, reason}
      run_cancelled           {run_id, status, cancellation, error}"""
    run_id = payload.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        raise HTTPException(400, "run_id is required")

    event = payload.get("event")
    if event == "confirmation_requested":
        proposal = payload.get("proposal")
        if not isinstance(proposal, dict):
            raise HTTPException(400, "proposal must be an object")
        db.record_proposal(run_id, proposal)
    elif event == "run_finished":
        status = payload.get("status")
        if status not in ("succeeded", "declined", "failed"):
            raise HTTPException(400, f"unknown run status {status!r}")
        db.record_outcome(
            run_id, status,
            result=payload.get("result"), error=payload.get("error"), reason=payload.get("reason"),
        )
    elif event == "run_cancelled":
        status = payload.get("status")
        if status not in ("cancelled", "cancel_failed"):
            raise HTTPException(400, f"unknown cancellation status {status!r}")
        db.record_cancellation(run_id, status, cancellation=payload.get("cancellation"), error=payload.get("error"))
    else:
        raise HTTPException(400, f"unknown event {event!r}")
    return {"status": "received"}


@app.get("/bookings/{run_id}")
def get_booking_endpoint(run_id: str, user_id: str = Query(...)):
    """What the progress, confirm and outcome screens poll. `status` is one of
    running, awaiting_confirmation, succeeded, declined, failed, cancelling,
    cancelled, cancel_failed."""
    booking = _sync_from_workflow(_booking_for(run_id, user_id))
    return {
        key: booking[key]
        for key in ("run_id", "status", "proposal", "result", "error", "reason", "cancellation")
    }


@app.post("/bookings/{run_id}/confirm")
def confirm_booking_endpoint(run_id: str, payload: dict = Body(...)):
    """The user's yes or no to the proposal; nothing is booked before this."""
    approved = payload.get("approved")
    if not isinstance(approved, bool):
        raise HTTPException(400, "approved must be true or false")
    booking = _booking_for(run_id, payload.get("user_id"))
    if booking["status"] != "awaiting_confirmation":
        raise HTTPException(409, "This request is no longer waiting for your answer.")
    if not BOOKING_WORKFLOW_URL:
        raise HTTPException(500, "BOOKING_WORKFLOW_URL is not set on the server")

    req = urllib.request.Request(
        _workflow_url(run_id, "confirm"), data=json.dumps({"approved": approved}).encode("utf-8"),
        method="POST", headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            pass
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Already answered, or the workflow timed out waiting.
            raise HTTPException(409, "This request is no longer waiting for your answer -- it may have timed out.")
        raise HTTPException(502, f"booking workflow rejected your answer ({e.code})")
    except urllib.error.URLError as e:
        raise HTTPException(502, f"could not reach the booking workflow at {BOOKING_WORKFLOW_URL}: {e.reason}")

    db.resolve_confirmation(run_id, approved)
    return {"status": "running" if approved else "declined"}


@app.post("/bookings/{run_id}/cancel")
def cancel_booking_endpoint(run_id: str, payload: dict = Body(...)):
    """Cancels a booked appointment, from the outcome screen or the upcoming
    list. The workflow keeps runs in memory only, so the stored `result` and
    the patient's name are sent along for it to adopt the run if it has
    forgotten it. The frontend then polls GET /bookings/{run_id}."""
    user_id = payload.get("user_id")
    booking = _booking_for(run_id, user_id)
    if booking["status"] not in ("succeeded", "cancel_failed"):
        raise HTTPException(409, "This booking has nothing to cancel right now.")
    if not booking["result"]:
        raise HTTPException(500, "This booking has no stored details to cancel it with.")
    if not BOOKING_WORKFLOW_URL:
        raise HTTPException(500, "BOOKING_WORKFLOW_URL is not set on the server")

    profile = db.get_profile(user_id)
    patient_name = (profile or {}).get("name")
    if not patient_name:
        raise HTTPException(500, "No profile on file to get the patient's name from.")

    body = json.dumps({"result": booking["result"], "patient_name": patient_name}).encode("utf-8")
    req = urllib.request.Request(
        _workflow_url(run_id, "cancel"), data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            pass
    except urllib.error.HTTPError as e:
        if e.code == 409:
            raise HTTPException(409, "This booking is already being cancelled, or was already cancelled.")
        raise HTTPException(502, f"booking workflow rejected the cancellation ({e.code})")
    except urllib.error.URLError as e:
        raise HTTPException(502, f"could not reach the booking workflow at {BOOKING_WORKFLOW_URL}: {e.reason}")

    db.record_cancelling(run_id)
    return {"status": "cancelling"}


@app.get("/appointments/upcoming")
def list_upcoming_endpoint(user_id: str = Query(...)):
    """This browser's booked future appointments, soonest first, read from
    storage without syncing. Only what the list shows plus the run_id the
    cancel button needs; the cancel endpoint reads the full result itself."""
    appointments = []
    for booking in db.list_upcoming(user_id):
        result = booking["result"]
        contact = result.get("clinic_contact") or {}
        interpreter = result.get("interpreter") or {}
        appointments.append({
            "run_id": booking["run_id"],
            "date": result["appointment_slot"]["date"],
            "time": result["appointment_slot"]["time"],
            "clinic": contact.get("name"),
            "address": contact.get("address"),
            "zipcode": contact.get("zipcode"),
            "interpreter": {k: interpreter.get(k) for k in ("tier", "name", "relation")},
        })
    return {"appointments": appointments}


class RevalidatingStaticFiles(StaticFiles):
    """`no-cache` makes the browser revalidate on each load, so a stale
    index.html is never paired with a newer app.js."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Mounted last so it doesn't shadow the routes above.
app.mount("/", RevalidatingStaticFiles(directory="static", html=True), name="static")