"""Read-only access to the CALL-E Calls API. This module can fetch a terminal call task by id and list its
events. It has no function that creates a call; the console never dials anything.

Uses the official `calle-ai` SDK when it is installed (`pip install -e ".[live]"`), which returns the
call task as a plain dict; falls back to two GET requests over httpx otherwise."""
from __future__ import annotations

import os

import httpx

BASE = os.getenv("CALLE_BASE_URL", "https://api.heycall-e.com")


def _key() -> str:
    k = os.getenv("CALLE_API_KEY", "")
    if not k:
        raise RuntimeError("CALLE_API_KEY is not set (live fetch is opt-in; fixtures work without it)")
    return k


def _sdk():
    try:
        from calle import CalleClient
    except ImportError:
        return None
    return CalleClient(api_key=_key(), base_url=BASE, timeout=30.0)


def fetch_call(call_id: str) -> dict:
    sdk = _sdk()
    if sdk is not None:
        return dict(sdk.calls.get(call_id))
    r = httpx.get(f"{BASE}/v1/calls/{call_id}", headers={"Authorization": f"Bearer {_key()}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_events(call_id: str) -> dict:
    sdk = _sdk()
    if sdk is not None:
        return dict(sdk.calls.list_events(call_id))
    r = httpx.get(f"{BASE}/v1/calls/{call_id}/events", headers={"Authorization": f"Bearer {_key()}"}, timeout=30)
    r.raise_for_status()
    return r.json()
