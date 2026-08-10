import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

import cv2
from ultralytics import YOLO
import supervision as sv
from fastapi import FastAPI
from fastapi.responses import StreamingResponse, HTMLResponse
import uvicorn

from calle_trigger import handle_fall_event

model = YOLO("best.pt")
tracker = sv.ByteTrack()
app = FastAPI()
box_annotator = sv.BoxAnnotator(thickness=2)

# --- Database logging ----------------------------------------------------
# Lightweight SQLite logging, kept inline here rather than a separate
# module. Records every fall event and the eventual caregiver decision
# to watchtower.db (created automatically in the working directory).

DB_PATH = "watchtower.db"


@contextmanager
def _db_connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Creates the events table if it doesn't already exist. Safe to
    call every time the app starts - it's a no-op if the table exists."""
    with _db_connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS fall_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT NOT NULL,
                confidence REAL NOT NULL,
                event_timestamp TEXT NOT NULL,
                decision TEXT,
                call_status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def log_event(event: dict) -> int:
    """Inserts a new fall event row and returns its id, so it can be
    updated later once CALL-E returns a decision."""
    now = datetime.now(timezone.utc).isoformat()
    with _db_connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO fall_events
                (room, confidence, event_timestamp, call_status, created_at, updated_at)
            VALUES (?, ?, ?, 'calling', ?, ?)
            """,
            (event["room"], event["confidence"], event["timestamp"], now, now),
        )
        return cursor.lastrowid


def update_event_result(event_id: int, decision: str) -> None:
    """Call once handle_fall_event() returns, to record the final
    decision and mark the event as resolved."""
    now = datetime.now(timezone.utc).isoformat()
    with _db_connect() as conn:
        conn.execute(
            """
            UPDATE fall_events
            SET decision = ?, call_status = 'resolved', updated_at = ?
            WHERE id = ?
            """,
            (decision, now, event_id),
        )


def mark_event_failed(event_id: int, reason: str = "unknown") -> None:
    """Call if handle_fall_event() raises - records that the call
    attempt failed rather than leaving the row stuck at 'calling'."""
    now = datetime.now(timezone.utc).isoformat()
    with _db_connect() as conn:
        conn.execute(
            """
            UPDATE fall_events
            SET decision = ?, call_status = 'failed', updated_at = ?
            WHERE id = ?
            """,
            (reason, now, event_id),
        )


def get_recent_events(limit: int = 20) -> list[dict]:
    """Returns the most recent events, newest first - used by the
    /history endpoint for the dashboard's event log table."""
    with _db_connect() as conn:
        rows = conn.execute(
            """
            SELECT id, room, confidence, event_timestamp, decision,
                   call_status, created_at, updated_at
            FROM fall_events
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


init_db()

# --- Fall event config -------------------------------------------------

ROOM = "living_room"

# Must match the class name your model was trained with for "fallen
# person". Confirmed against model.names: {0: 'non-fall', 1: 'fall'}
FALL_CLASS_NAME = "fall"

# Minimum confidence to trust a fall detection.
FALL_CONFIDENCE_THRESHOLD = 0.6

# How many consecutive frames the fall class must appear in before we
# trust it - cuts down one-frame false positives from motion blur etc.
CONSECUTIVE_FRAMES_REQUIRED = 5

# Once an event fires, don't fire again for this many seconds - avoids
# spamming CALL-E with repeat calls while the person is still on the
# ground in frame.
EVENT_COOLDOWN_SECONDS = 60
STATUS_COOL_DOWN_SECONDS = 10
# --- State used by the fall-tracking logic ------------------------------

_consecutive_fall_frames = 0
_last_event_time = 0.0


# --- Shared status state for the dashboard -------------------------------
# Polled by the "/status" endpoint. Kept as a plain dict for simplicity -
# fine for a single-camera hackathon demo; a real multi-room deployment
# would want a proper state store instead of a module-level global.

status_state = {
    "status": "monitoring",       # monitoring | fall_detected | calling | resolved
    "last_event": None,             # last fall_detected event dict, or None
    "last_decision": None,          # "dismiss" | "escalate" | "unknown" | None
    "last_updated": datetime.now(timezone.utc).isoformat(),
}


def _update_status(**kwargs):
    status_state.update(kwargs)
    status_state["last_updated"] = datetime.now(timezone.utc).isoformat()


def check_for_fall(detections: sv.Detections, class_names: dict) -> dict | None:
    """
    Inspects the current frame's detections for a fall class above the
    confidence threshold. Returns an event dict once the fall has been
    seen for enough consecutive frames and we're outside the cooldown
    window - otherwise returns None.
    """
    global _consecutive_fall_frames, _last_event_time

    fall_seen_this_frame = False
    fall_confidence = 0.0

    for class_id, confidence in zip(detections.class_id, detections.confidence):
        name = class_names.get(int(class_id), "")
        if name == FALL_CLASS_NAME and confidence >= FALL_CONFIDENCE_THRESHOLD:
            fall_seen_this_frame = True
            fall_confidence = max(fall_confidence, float(confidence))

    if fall_seen_this_frame:
        _consecutive_fall_frames += 1
    else:
        _consecutive_fall_frames = 0
        return None

    if _consecutive_fall_frames < CONSECUTIVE_FRAMES_REQUIRED:
        return None

    now = time.time()
    if now - _last_event_time < EVENT_COOLDOWN_SECONDS:
        return None

    _last_event_time = now
    _consecutive_fall_frames = 0  # reset so the next fall needs its own run of frames

    return {
        "event": "fall_detected",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "confidence": round(fall_confidence, 2),
        "room": ROOM,
    }


def generate_frame():
    cap = cv2.VideoCapture(0)

    # Lower capture resolution - fewer pixels to process per frame.
    # 640x480 is plenty for fall detection; drop further (e.g. 480x360)
    # if still slow.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    # Only run YOLO on every Nth frame. A fall unfolds over multiple
    # seconds, not milliseconds, so we don't need to inspect every
    # single frame - this is the single biggest speed win on CPU.
    FRAME_SKIP = 3
    frame_count = 0

    last_detections = None
    last_result_names = {}

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1

        if frame_count % FRAME_SKIP == 0:
            # imgsz=320 trades some accuracy for a large speed gain vs
            # the default 640. Raise it back up (e.g. 480) if fall
            # detection starts missing things at this size.
            result = model(frame, imgsz=320, verbose=False)[0]
            detections = sv.Detections.from_ultralytics(result)
            detections = tracker.update_with_detections(detections)
            last_detections = detections
            last_result_names = result.names

            event = check_for_fall(detections, result.names)
            if event is not None:
                print("FALL EVENT:", event)
                _update_status(status="fall_detected", last_event=event)
                event_id = log_event(event)

                try:
                    _update_status(status="calling")
                    decision = handle_fall_event(event)
                    _update_status(status="resolved", last_decision=decision)
                    update_event_result(event_id, decision)
                except Exception as exc:
                    print(f"[Watchtower] handle_fall_event failed: {exc}")
                    _update_status(status="resolved", last_decision="unknown")
                    mark_event_failed(event_id, reason=str(exc))
        else:
            # Reuse the last frame's detections/boxes for the skipped
            # frames so the video still shows bounding boxes on every
            # frame, just not re-computed every time.
            detections = last_detections

        if detections is not None:
            annotated_frame = box_annotator.annotate(scene=frame, detections=detections)
        else:
            annotated_frame = frame

        # Reset the displayed status back to "monitoring" once we're
        # well past the last event's cooldown window. Without this, the
        # dashboard stays stuck on "resolved" (or "calling", if the call
        # itself failed) forever, even though the CV pipeline is still
        # actively watching for the next fall in the background.
        if status_state["status"] != "monitoring" and _last_event_time:
            if time.time() - _last_event_time >= STATUS_COOL_DOWN_SECONDS:
                _update_status(status="monitoring")

        _, buffer = cv2.imencode('.jpg', annotated_frame)
        frame_byte = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_byte + b'\r\n')

    cap.release()


@app.get('/detect')
def get_frame():
    return StreamingResponse(generate_frame(),
                              media_type='multipart/x-mixed-replace; boundary=frame')


@app.get('/status')
def get_status():
    return status_state


@app.get('/history')
def get_history(limit: int = 20):
    return get_recent_events(limit=limit)


DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Watchtower</title>
    <style>
        body {
            background: #0e1116;
            color: #e6e6e6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            margin: 0;
            padding: 2rem;
        }
        h1 {
            font-size: 1.4rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .layout {
            display: flex;
            gap: 2rem;
            flex-wrap: wrap;
        }
        .video-panel img {
            border-radius: 8px;
            border: 1px solid #2a2f3a;
            max-width: 640px;
            width: 100%;
        }
        .status-panel {
            background: #161a22;
            border: 1px solid #2a2f3a;
            border-radius: 8px;
            padding: 1.25rem;
            min-width: 280px;
            flex: 1;
        }
        .badge {
            display: inline-block;
            padding: 0.3rem 0.8rem;
            border-radius: 999px;
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .badge.monitoring { background: #16331f; color: #4ade80; }
        .badge.fall_detected { background: #3a1f16; color: #fb923c; }
        .badge.calling { background: #33270f; color: #facc15; }
        .badge.resolved { background: #16233a; color: #60a5fa; }

        .row { margin-top: 1rem; }
        .label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            color: #8a93a6;
            margin-bottom: 0.2rem;
        }
        .value { font-size: 0.95rem; }
    </style>
</head>
<body>
    <h1>🛡️ Watchtower <span id="status-badge" class="badge monitoring">Monitoring</span></h1>

    <div class="layout">
        <div class="video-panel">
            <img src="/detect" alt="Live camera feed" />
        </div>

        <div class="status-panel">
            <div class="row">
                <div class="label">Last event</div>
                <div class="value" id="last-event">None yet</div>
            </div>
            <div class="row">
                <div class="label">Confidence</div>
                <div class="value" id="last-confidence">-</div>
            </div>
            <div class="row">
                <div class="label">Caregiver decision</div>
                <div class="value" id="last-decision">-</div>
            </div>
            <div class="row">
                <div class="label">Last updated</div>
                <div class="value" id="last-updated">-</div>
            </div>
        </div>
    </div>

    <script>
        const statusLabels = {
            monitoring: "Monitoring",
            fall_detected: "Fall Detected",
            calling: "Calling Caregiver",
            resolved: "Resolved",
        };

        async function pollStatus() {
            try {
                const res = await fetch("/status");
                const data = await res.json();

                const badge = document.getElementById("status-badge");
                badge.textContent = statusLabels[data.status] || data.status;
                badge.className = "badge " + data.status;

                document.getElementById("last-event").textContent =
                    data.last_event ? `Fall in ${data.last_event.room} at ${data.last_event.timestamp}` : "None yet";

                document.getElementById("last-confidence").textContent =
                    data.last_event ? data.last_event.confidence : "-";

                document.getElementById("last-decision").textContent =
                    data.last_decision || "-";

                document.getElementById("last-updated").textContent =
                    new Date(data.last_updated).toLocaleTimeString();
            } catch (err) {
                console.error("Status poll failed:", err);
            }
        }

        setInterval(pollStatus, 2000);
        pollStatus();
    </script>
</body>
</html>
"""


@app.get('/', response_class=HTMLResponse)
def dashboard():
    return DASHBOARD_HTML


if __name__ == "__main__":
    uvicorn.run(app, host='0.0.0.0', port=5000)