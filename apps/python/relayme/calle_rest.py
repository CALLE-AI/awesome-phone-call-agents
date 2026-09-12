#!/usr/bin/env python3
"""CALL-E REST API client for RelayMe.

An alternative to the `calle` CLI / MCP path. It talks directly to the documented
CALL-E REST API with a Bearer API key:

    GET  /v1/goals?limit=1     preflight (read-only, confirms the key works)
    POST /v1/calls             create one outbound call (CallTask)
    GET  /v1/calls/{id}        poll until terminal

This exists so RelayMe works in environments that use an API key rather than the
brokered OAuth login. Importing this module places no call. `create_call` places
a real call and consumes a CALL-E credit; it must only be invoked with an
authorized destination and explicit user intent.

Standard library only (urllib), so the app keeps its no-dependency footprint.
"""
from __future__ import annotations

import json
import time
import urllib.request
import urllib.error
from typing import Any

DEFAULT_API_BASE = "https://api.heycall-e.com"
TERMINAL_STATUSES = {"completed", "failed", "no_answer", "canceled", "cancelled",
                     "voicemail", "busy", "expired", "ended"}


class RestError(RuntimeError):
    pass


def _request(method: str, url: str, api_key: str, body: dict | None = None,
             timeout: int = 30) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            parsed = {"error": raw[:200]}
        return e.code, parsed
    except urllib.error.URLError as e:
        raise RestError(f"network error reaching {url}: {e.reason}")


def preflight(api_key: str, api_base: str = DEFAULT_API_BASE) -> bool:
    """Read-only check that the key works. Returns True on 2xx."""
    status, _ = _request("GET", f"{api_base}/v1/goals?limit=1", api_key)
    return 200 <= status < 300


def create_call(api_key: str, to_phone_e164: str, task: str, result_schema: dict,
                idempotency_key: str, region: str = "US", locale: str = "en-US",
                recipient_result_schema: dict | None = None,
                metadata: dict | None = None,
                api_base: str = DEFAULT_API_BASE) -> dict:
    """Create one outbound call. PLACES A REAL CALL. Returns the CallTask dict.

    Uses the documented recipients[] schema with explicit region/locale, which is
    required so CALL-E does not have to guess the destination region. Fails closed:
    a 2xx without a documented call id is reported as unknown-possibly-created.
    """
    body: dict[str, Any] = {
        "task": task,
        "recipients": [{
            "phones": [to_phone_e164],
            "region": region,
            "locale": locale,
        }],
        "result_schema": result_schema,
        "recipient_result_schema": recipient_result_schema or result_schema,
    }
    if metadata:
        body["metadata"] = metadata
    # Preflight first, exactly as the documented flow requires.
    if not preflight(api_key, api_base):
        raise RestError("preflight GET /v1/goals failed; not creating a call")

    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{api_base}/v1/calls", data=data, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Idempotency-Key", idempotency_key)
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            status = resp.status
            parsed = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            err = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            err = {"error": raw[:300]}
        return {"_outcome": "unknown_possibly_created", "_status": e.code,
                "_idempotency_key": idempotency_key, "_error": err}
    except urllib.error.URLError as e:
        raise RestError(f"network error creating call: {e.reason}")

    if not (200 <= status < 300) or not parsed.get("id"):
        return {"_outcome": "unknown_possibly_created", "_status": status,
                "_idempotency_key": idempotency_key, "_raw": parsed}
    return parsed


def parse_terminal(call: dict) -> tuple[dict, list[dict]]:
    """Map a terminal CALL-E result into (raw_result_for_classifier, transcript).

    Prefers the per-recipient structured_result and transcript_turns, falling back
    to task-level structured_result. Transcript turns use speaker bot|user, which
    we normalise to agent|callee for the thread builder.
    """
    recipients = call.get("recipients") or []
    rec = recipients[0] if recipients else {}
    structured = rec.get("structured_result") or call.get("structured_result") or {}
    transcript: list[dict] = []
    attempts = rec.get("attempts") or []
    if attempts:
        for turn in attempts[-1].get("transcript_turns", []):
            spk = turn.get("speaker")
            transcript.append({
                "speaker": "agent" if spk == "bot" else "callee",
                "text": turn.get("text", ""),
            })
    raw = dict(structured)
    raw.setdefault("disclosed_ai", True)
    if "outcome" not in raw:
        # Derive a coarse outcome from status when the schema didn't set one.
        status = (call.get("status") or "").lower()
        raw["outcome"] = "answered" if (call.get("task_completed") and structured) else (
            "voicemail" if status == "voicemail" else
            "no_answer" if status in {"no_answer", "busy", "expired"} else
            "needs_human")
    return raw, transcript


def poll_call(api_key: str, call_id: str, poll_seconds: int = 10, max_polls: int = 60,
              api_base: str = DEFAULT_API_BASE) -> dict:
    """Poll GET /v1/calls/{id} until terminal or the budget runs out."""
    for _ in range(max_polls):
        status_code, call = _request("GET", f"{api_base}/v1/calls/{call_id}", api_key)
        if not (200 <= status_code < 300):
            return {"status": "failed", "_poll_http": status_code}
        state = (call.get("status") or "").lower()
        if state in TERMINAL_STATUSES or call.get("structured_result"):
            return call
        time.sleep(poll_seconds)
    return {"status": "failed", "_reason": "polling budget exhausted"}
