import time
from datetime import datetime, timezone

import cv2
from ultralytics import YOLO
import supervision as sv
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import uvicorn

from calle_trigger import handle_fall_event

model = YOLO("best.pt")
tracker = sv.ByteTrack()
app = FastAPI()
box_annotator = sv.BoxAnnotator(thickness=2)

# --- Fall event config -------------------------------------------------

ROOM = "living_room"

# Must match the class name your model was trained with for "fallen
# person". Confirmed against model.names: {0: 'non-fall', 1: 'fall'}
FALL_CLASS_NAME = "fall"

# Minimum confidence to trust a fall detection.
FALL_CONFIDENCE_THRESHOLD = 0.3

# How many consecutive frames the fall class must appear in before we
# trust it - cuts down one-frame false positives from motion blur etc.
CONSECUTIVE_FRAMES_REQUIRED = 5

# Once an event fires, don't fire again for this many seconds - avoids
# spamming CALL-E with repeat calls while the person is still on the
# ground in frame.
EVENT_COOLDOWN_SECONDS = 60

# --- State used by the fall-tracking logic ------------------------------

_consecutive_fall_frames = 0
_last_event_time = 0.0


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
        print(f"DEBUG fall confidence: {confidence:.2f}")
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
    cap = cv2.VideoCapture("awesome-phone-call-agents/skills/watchtower-fall-alert/assets/Make_a_video_of_an_old_person.mp4")
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        result = model(frame)[0]
        detections = sv.Detections.from_ultralytics(result)
        detections = tracker.update_with_detections(detections)

        event = check_for_fall(detections, result.names)
        if event is not None:
            print("FALL EVENT:", event)
            # Blocking call - fine for a hackathon demo since a real
            # fall is rare and worth waiting on. For production you'd
            # run this in a background thread/task instead so the video
            # stream doesn't stall while CALL-E is on the phone.
            handle_fall_event(event)

        annotated_frame = box_annotator.annotate(scene=frame, detections=detections)

        _, buffer = cv2.imencode('.jpg', annotated_frame)
        frame_byte = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_byte + b'\r\n')

    cap.release()


@app.get('/detect')
def get_frame():
    return StreamingResponse(generate_frame(),
                              media_type='multipart/x-mixed-replace; boundary=frame')

if __name__ == "__main__":
    uvicorn.run(app, host='0.0.0.0', port=5000)