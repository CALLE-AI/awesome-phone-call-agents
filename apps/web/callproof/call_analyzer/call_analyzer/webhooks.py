from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any
from uuid import uuid4

import httpx


def signed_headers(body: bytes, secret: str, *, timestamp: int | None = None) -> dict[str, str]:
    timestamp = timestamp or int(time.time())
    signed_payload = f"{timestamp}.".encode() + body
    signature = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-CallProof-Event-Id": str(uuid4()),
        "X-CallProof-Timestamp": str(timestamp),
        "X-CallProof-Signature": f"v1={signature}",
    }


def deliver(url: str, payload: dict[str, Any], secret: str) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return httpx.post(url, content=body, headers=signed_headers(body, secret), timeout=10)

