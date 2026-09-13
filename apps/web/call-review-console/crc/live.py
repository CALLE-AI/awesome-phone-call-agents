"""Read-only access to the CALL-E Calls API. The API key is only ever sent to an
allow-listed https origin (see :mod:`crc.security`), so a tampered
``CALLE_BASE_URL`` cannot exfiltrate it. This module can fetch a terminal call task by id and list its
events. It has no function that creates a call; the console never dials anything.

Uses the official `calle-ai` SDK when it is installed (`pip install -e ".[live]"`), which returns the
call task as a plain dict; falls back to two GET requests over httpx otherwise."""
from __future__ import annotations

import os

import httpx

from .security import check_api_origin, safe_call_id

BASE = os.getenv("CALLE_BASE_URL", "https://api.heycall-e.com")


def _base() -> str:
    """The API origin, checked before any credential is attached to a request."""
    return check_api_origin(os.getenv("CALLE_BASE_URL", BASE))


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
    return CalleClient(api_key=_key(), base_url=_base(), timeout=30.0)


def fetch_call(call_id: str) -> dict:
    cid = safe_call_id(call_id)
    base = _base()
    sdk = _sdk()
    if sdk is not None:
        return dict(sdk.calls.get(cid))
    r = httpx.get(f"{base}/v1/calls/{cid}", headers={"Authorization": f"Bearer {_key()}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_events(call_id: str) -> dict:
    cid = safe_call_id(call_id)
    base = _base()
    sdk = _sdk()
    if sdk is not None:
        return dict(sdk.calls.list_events(cid))
    r = httpx.get(f"{base}/v1/calls/{cid}/events", headers={"Authorization": f"Bearer {_key()}"}, timeout=30)
    r.raise_for_status()
    return r.json()
