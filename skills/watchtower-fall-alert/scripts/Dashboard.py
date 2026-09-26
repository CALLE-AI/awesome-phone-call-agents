"""
dashboard.py

Streamlit dashboard for Watchtower.

This is a pure display layer - it does NOT run the CV pipeline itself.
It reads from the FastAPI backend (fall_detector.py) which must already
be running, and now requires an API key on every request:

    - GET /detect?key=...  -> live annotated MJPEG video stream
    - GET /status?key=...  -> JSON status: current state, last event, decision
    - GET /history?key=... -> JSON event history

Run (in a separate terminal from fall_detector.py):

    pip install streamlit requests --break-system-packages
    export WATCHTOWER_API_KEY="the same key fall_detector.py is using"
    streamlit run dashboard.py

Then make sure fall_detector.py is running at the same time, e.g.:

    export WATCHTOWER_API_KEY="the same key"
    python fall_detector.py
"""

import os
import time

import requests
import streamlit as st

FASTAPI_URL = "http://localhost:5000"

WATCHTOWER_API_KEY = os.environ.get("WATCHTOWER_API_KEY")
if not WATCHTOWER_API_KEY:
    st.error(
        "WATCHTOWER_API_KEY is not set. This dashboard talks to an "
        "authenticated backend - set the same key fall_detector.py is "
        "using, e.g.:\n\n"
        "export WATCHTOWER_API_KEY=\"...\"\n\n"
        "then restart Streamlit."
    )
    st.stop()

AUTH_HEADERS = {"X-Watchtower-Key": WATCHTOWER_API_KEY}
AUTH_QUERY = {"key": WATCHTOWER_API_KEY}

st.set_page_config(page_title="Watchtower", page_icon="🛡️", layout="wide")

STATUS_LABELS = {
    "monitoring": "🟢 Monitoring",
    "fall_detected": "🟠 Fall Detected",
    "calling": "🟡 Calling Caregiver",
    "resolved": "🔵 Resolved",
    "error": "⚪ Backend unreachable",
}

st.title("🛡️ Watchtower")
st.caption("Home fall detection, backed by computer vision and CALL-E.")

video_col, status_col = st.columns([2, 1])

with video_col:
    st.subheader("Live feed")
    # The FastAPI backend streams annotated MJPEG frames at /detect. An
    # <img> tag can't set custom headers, so the key is passed as a
    # query parameter here instead - matching what fall_detector.py's
    # require_api_key() dependency accepts.
    st.markdown(
        f'<img src="{FASTAPI_URL}/detect?key={WATCHTOWER_API_KEY}" '
        f'style="width:100%; border-radius:8px;">',
        unsafe_allow_html=True,
    )

with status_col:
    st.subheader("Status")
    status_placeholder = st.empty()
    event_placeholder = st.empty()
    confidence_placeholder = st.empty()
    decision_placeholder = st.empty()
    updated_placeholder = st.empty()


def fetch_status() -> dict:
    try:
        resp = requests.get(f"{FASTAPI_URL}/status", headers=AUTH_HEADERS, timeout=3)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException:
        return {
            "status": "error",
            "last_event": None,
            "last_decision": None,
            "last_updated": None,
        }


def render_status(data: dict) -> None:
    status = data.get("status", "unknown")
    status_placeholder.markdown(f"### {STATUS_LABELS.get(status, status)}")

    last_event = data.get("last_event")
    if last_event:
        event_placeholder.markdown(
            f"**Last event:** Fall in `{last_event['room']}` "
            f"at `{last_event['timestamp']}`"
        )
        confidence_placeholder.markdown(
            f"**Confidence:** {last_event['confidence']}"
        )
    else:
        event_placeholder.markdown("**Last event:** None yet")
        confidence_placeholder.markdown("**Confidence:** -")

    decision = data.get("last_decision")
    decision_placeholder.markdown(f"**Caregiver decision:** {decision or '-'}")

    updated = data.get("last_updated")
    updated_placeholder.caption(f"Last updated: {updated or '-'}")


def fetch_history(limit: int = 20) -> list:
    try:
        resp = requests.get(
            f"{FASTAPI_URL}/history",
            params={"limit": limit},
            headers=AUTH_HEADERS,
            timeout=3,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException:
        return []


st.divider()
st.subheader("Event history")
history_placeholder = st.empty()


def render_history() -> None:
    rows = fetch_history()
    if not rows:
        history_placeholder.info("No fall events logged yet.")
        return

    history_placeholder.dataframe(
        rows,
        column_order=[
            "event_timestamp", "room", "confidence",
            "call_status", "decision", "updated_at",
        ],
        use_container_width=True,
        hide_index=True,
    )


# Simple polling loop - re-fetches /status and /history every 2 seconds
# and updates the placeholders in place, without a full Streamlit rerun.
# This keeps the dashboard "live" while the FastAPI backend does the
# real work.
while True:
    render_status(fetch_status())
    render_history()
    time.sleep(2)