"""FastMCP server exposing ringfence's case submission/lookup as agent tools.

There is no existing FastMCP *server* precedent elsewhere in this repo to
mirror (apps/python/batch-runner ships an MCP *client* that talks to CALL-E's
own hosted MCP endpoint, which is a different direction) — this follows
FastMCP's own standard server pattern instead. Wired to the same
``webhook.handle_submit``/``handle_get`` request-handling functions the HTTP
receiver uses, so there is exactly one implementation of the dial-target
invariant and the single-attempt-per-case rule, not a second copy here.

``ringfence_submit_case`` defaults to dry-run; a live call requires both
``live=True`` and ``confirm_live=True`` in the same call, mirroring the
CLI's ``--live``/``--confirm-live`` double gate. There is no live-call tool
exposed without that explicit double confirmation.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastmcp import FastMCP

from .webhook import CaseStore, DEFAULT_SECURITY_LOG_PATH, handle_get, handle_submit
from .verify_call import SecurityEventLog

mcp = FastMCP("ringfence")

_store = CaseStore()
_security_log = SecurityEventLog(DEFAULT_SECURITY_LOG_PATH)


def _live_client_factory() -> object:
    from calle import CalleClient

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise RuntimeError("CALLE_API_KEY is required for a live call")
    return CalleClient(api_key=api_key)


@mcp.tool
def ringfence_submit_case(case: dict, live: bool = False, confirm_live: bool = False) -> dict:
    """Submit a flagged transaction case and place (or preview) its
    independent verification call to the account holder's on-file number.

    ``case`` must match the ringfence Case schema: case_id,
    account_holder_name, on_file_phone, claimed_transaction_amount,
    claimed_recipient, claimed_payment_method, and optionally
    request_supplied_callback_number (never dialed, only logged).

    Dry-run by default. A real call requires both live=True AND
    confirm_live=True together — omitting either keeps this a preview.
    """
    if live and not confirm_live:
        return {
            "error": "live_requires_confirm_live",
            "detail": "pass confirm_live=True together with live=True to place a real call",
        }
    client_factory = _live_client_factory if (live and confirm_live) else None
    _, payload = handle_submit(
        _store,
        case,
        live=bool(live and confirm_live),
        security_log=_security_log,
        client_factory=client_factory,
    )
    return payload


@mcp.tool
def ringfence_get_case(case_id: str) -> dict:
    """Look up a previously submitted case's status and disposition by id."""
    _, payload = handle_get(_store, case_id)
    return payload


if __name__ == "__main__":
    mcp.run()
