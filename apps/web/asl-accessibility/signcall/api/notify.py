"""
Pushes run events to the frontend so the user can be told when a run needs an
answer or has finished. The server POSTs one JSON event to SIGNCALL_NOTIFY_URL;
a different deployment could point that at a text, email or push gateway.

Events (all carry "event" and "run_id"):

    {"event": "confirmation_requested", "proposal": {...}}
    {"event": "run_finished", "status": "succeeded" | "declined" | "failed",
     "result": {...} | null, "error": str | null, "reason": str | null}
    {"event": "run_cancelled", "status": "cancelled" | "cancel_failed",
     "cancellation": {...} | undefined, "error": str | undefined}

Delivery is best effort. A notifier that is down must never break a run, and
the same state is always available by polling GET /runs/{run_id}.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5.0

_warned_no_url = False


def send_event(event: dict) -> bool:
    """POSTs `event` to SIGNCALL_NOTIFY_URL, read on every call. Returns whether
    it was delivered; False (with a log line) when no URL is set or the
    receiver can't be reached."""
    global _warned_no_url
    url = os.environ.get("SIGNCALL_NOTIFY_URL")
    if not url:
        if not _warned_no_url:  # warn once, so a missing setting isn't silent
            logger.warning(
                "SIGNCALL_NOTIFY_URL is not set, so run events are not being "
                "pushed to anyone. Clients must poll GET /runs/{run_id}."
            )
            _warned_no_url = True
        return False
    try:
        httpx.post(url, json=event, timeout=TIMEOUT_SECONDS).raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning(
            "Could not deliver %r for run %s to %s: %s",
            event.get("event"), event.get("run_id"), url, exc,
        )
        return False
    return True
