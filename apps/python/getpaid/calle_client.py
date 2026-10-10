"""Thin wrapper around the CALL-E Developer API (Phase 1 beta REST surface).

Two modes, controlled by the CALLE_MODE env var:

  fixture (default) - no network calls at all. Returns a canned or randomly
      sampled result from fixtures/sample_results.json so the app is runnable
      and demoable with zero credentials, per this repo's "safe to try
      without a real call when possible" convention.

  live - places a real call via POST /v1/calls and polls
      GET /v1/calls/{call_id} until the call reaches a terminal state.
      Requires CALLE_API_KEY and CALLE_BASE_URL.

Reference: https://github.com/CALLE-AI/call-e-integrations (API preview)
  POST /v1/calls
  GET  /v1/calls/{call_id}
  GET  /v1/calls/{call_id}/events
"""
from __future__ import annotations

import json
import os
import random
import time
from pathlib import Path
from typing import Optional

import httpx

FIXTURES_PATH = Path(__file__).parent / "fixtures" / "sample_results.json"

RESULT_SCHEMA = {
    "type": "object",
    "required": ["payment_status"],
    "properties": {
        # "status" is a reserved field name in CALL-E's recipient_result_schema
        # (it collides with CALL-E's own call-lifecycle status), so this app's
        # outcome field is sent over the wire as "payment_status" and remapped
        # back to the internal "status" key in _live_call below.
        "payment_status": {
            "type": "string",
            "enum": [
                "paid",
                "promised",
                "disputed",
                "voicemail",
                "no_answer",
                "wrong_number",
                "declined",
            ],
        },
        "promised_date": {
            "type": "string",
            "description": "ISO date the client committed to pay by, if any. Omit if not applicable.",
        },
        "note": {
            "type": "string",
            "description": "One or two sentence plain-language summary of what was said.",
        },
    },
    "additionalProperties": False,
}


def build_task(invoice, follow_up: bool = False) -> str:
    tone = (
        "This is a second, gentle follow-up — the client previously said they'd pay by "
        f"{invoice.promised_date} and that date has passed. Stay warm and non-accusatory; "
        "assume good faith (things slip), but ask directly whether the invoice has now "
        "been paid or whether they need a new date."
        if follow_up
        else "This is a first, friendly check-in — do not imply the client is late or at fault."
    )
    return (
        f"You are calling on behalf of {invoice.freelancer_name}, an independent "
        f"contractor. Identify yourself honestly as an AI assistant calling on "
        f"{invoice.freelancer_name}'s behalf — never claim to be human. "
        f"Call {invoice.client_name} regarding invoice #{invoice.invoice_number} for "
        f"{invoice.amount} {invoice.currency}, due {invoice.due_date}. {tone} "
        "Ask whether the invoice has been paid, and if not, whether there's an updated "
        "timeline or an issue with the invoice they'd like to flag. Be brief and polite. "
        "If you reach voicemail, leave a short message with the invoice number and ask "
        f"them to call {invoice.freelancer_name} back. Do not negotiate the amount, offer "
        f"a discount, or make any commitment on {invoice.freelancer_name}'s behalf — you "
        "are only gathering information."
    )


class CalleClient:
    def __init__(self, mode: Optional[str] = None):
        self.mode = mode or os.environ.get("CALLE_MODE", "fixture")
        self.api_key = os.environ.get("CALLE_API_KEY")
        self.base_url = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
        if self.mode == "live" and not self.api_key:
            raise RuntimeError(
                "CALLE_MODE=live requires CALLE_API_KEY to be set. "
                "See README.md for how to get one."
            )

    def place_call(self, invoice, follow_up: bool = False) -> dict:
        """Places (or simulates) one call for an invoice. Returns a dict with
        at least: status, promised_date, note, calle_call_id, mode.
        """
        task = build_task(invoice, follow_up=follow_up)
        idempotency_key = f"{invoice.id}_{invoice.follow_up_count}"

        if self.mode == "fixture":
            return self._fixture_call(invoice)

        return self._live_call(invoice, task, idempotency_key)

    # -- fixture mode -----------------------------------------------------
    def _fixture_call(self, invoice) -> dict:
        samples = json.loads(FIXTURES_PATH.read_text())
        result = random.choice(samples)
        time.sleep(1.5)  # simulate call latency for a believable demo
        return {
            "status": result["status"],
            "promised_date": result.get("promised_date"),
            "note": result.get("note", ""),
            "calle_call_id": f"fixture_{invoice.id[:8]}",
            "mode": "fixture",
        }

    # -- live mode ----------------------------------------------------------
    def _live_call(self, invoice, task: str, idempotency_key: str) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        }
        payload = {
            "task": task,
            "recipients": [
                {
                    "phones": [invoice.client_phone],
                    "region": invoice.region,
                    "locale": invoice.locale,
                }
            ],
            "recipient_result_schema": RESULT_SCHEMA,
            "metadata": {"invoice_id": invoice.id, "invoice_number": invoice.invoice_number},
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(f"{self.base_url}/v1/calls", headers=headers, json=payload)
            resp.raise_for_status()
            call = resp.json()
            call_id = call["id"] if "id" in call else call.get("call_id")

            # Poll for a terminal result. Phase-1 API is synchronous-ish for
            # short calls but we poll defensively rather than assume.
            deadline = time.time() + 180
            while time.time() < deadline:
                r = client.get(f"{self.base_url}/v1/calls/{call_id}", headers=headers)
                r.raise_for_status()
                data = r.json()
                if data.get("status") in ("completed", "failed", "no_answer"):
                    break
                time.sleep(3)

        recipients = data.get("recipients") or []
        structured = {}
        if recipients:
            structured = recipients[0].get("structured_result") or recipients[0].get("structuredResult") or {}
        return {
            "status": structured.get("payment_status", "no_answer"),
            "promised_date": structured.get("promised_date"),
            "note": structured.get("note", ""),
            "calle_call_id": call_id,
            "mode": "live",
        }
