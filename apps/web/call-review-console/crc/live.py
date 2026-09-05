"""Read-only access to the CALL-E Calls API. This module can fetch a terminal call task by id and list its
events. It has no function that creates a call; the console never dials anything."""
from __future__ import annotations

import os

import httpx

BASE = os.getenv("CALLE_BASE_URL", "https://api.heycall-e.com")


def _key() -> str:
    k = os.getenv("CALLE_API_KEY", "")
    if not k:
        raise RuntimeError("CALLE_API_KEY is not set (live fetch is opt-in; fixtures work without it)")
    return k


def fetch_call(call_id: str) -> dict:
    r = httpx.get(f"{BASE}/v1/calls/{call_id}", headers={"Authorization": f"Bearer {_key()}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_events(call_id: str) -> dict:
    r = httpx.get(f"{BASE}/v1/calls/{call_id}/events", headers={"Authorization": f"Bearer {_key()}"}, timeout=30)
    r.raise_for_status()
    return r.json()
