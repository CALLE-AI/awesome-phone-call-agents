"""In-memory rate limiting for live call attempts: a per-IP sliding window,
plus a hard global cap across all visitors combined.

Plain in-process state is enough for a single free-tier instance demo — it
doesn't need to survive restarts and there's only one process.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock

MAX_LIVE_CALLS_PER_WINDOW = 1
WINDOW_SECONDS = 24 * 60 * 60

# Hard ceiling on real CALL-E calls across ALL visitors combined, for the
# life of the process. Real credits are extremely limited (see README) —
# this is the backstop that prevents the demo from ever draining the
# account, no matter how many people try it or how the per-IP limit is
# configured. Override via env var only if you've deliberately decided to
# spend more of the remaining balance.
MAX_TOTAL_LIVE_CALLS = int(os.environ.get("MAX_TOTAL_LIVE_CALLS", "1"))

_log: dict[str, list[float]] = defaultdict(list)
_lock = Lock()

_total_lock = Lock()
_total_calls_placed = 0


class RateLimitExceeded(Exception):
    pass


class GlobalCapReached(Exception):
    pass


def check_and_record(ip: str) -> None:
    """Raises RateLimitExceeded if `ip` already has MAX_LIVE_CALLS_PER_WINDOW
    live calls within the last WINDOW_SECONDS; otherwise records this call."""
    now = time.time()
    cutoff = now - WINDOW_SECONDS
    with _lock:
        fresh = [t for t in _log[ip] if t > cutoff]
        if len(fresh) >= MAX_LIVE_CALLS_PER_WINDOW:
            _log[ip] = fresh
            raise RateLimitExceeded()
        fresh.append(now)
        _log[ip] = fresh


def total_calls_placed() -> int:
    """Read-only peek, for a cheap up-front check and for reporting via
    /api/mode. Not authoritative on its own — see check_and_record_global."""
    with _total_lock:
        return _total_calls_placed


def check_and_record_global() -> None:
    """Atomically checks and increments the global count. This is the
    authoritative gate: call it immediately before actually placing a real
    call so the counter only ever reflects calls that truly went out."""
    global _total_calls_placed
    with _total_lock:
        if _total_calls_placed >= MAX_TOTAL_LIVE_CALLS:
            raise GlobalCapReached()
        _total_calls_placed += 1


def reset() -> None:
    """Test helper: clears all tracked state (per-IP log and global count)."""
    global _total_calls_placed
    with _lock:
        _log.clear()
    with _total_lock:
        _total_calls_placed = 0
