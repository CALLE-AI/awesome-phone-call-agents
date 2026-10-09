"""A second transport, over CALL-E's MCP surface via the `calle` CLI.

The REST Developer API is the primary path and the one Certa is built around:
it is the only surface that accepts `result_schema` and
`recipient_result_schema`, which is what turns an operator's columns into
typed answers.

This transport exists because that path can be unavailable. On a network whose
resolver does not return an address for `api.heycall-e.com`, every call fails
at DNS and the product is simply dead, which is a poor answer when a working
alternative exists. `plan_call` -> `run_call` -> `get_call_run` is reachable
through the CLI and places genuinely real calls.

It has one limitation that is surfaced rather than worked around. `plan_call`
accepts a phone, a goal, a language, a region and a timezone -- there is no
schema parameter -- so CALL-E returns a transcript and a summary, not typed
answers.

Certa does not fill that gap by extracting answers itself. The design is that
CALL-E performs extraction against a schema derived from the operator's own
columns; doing it here would be a different product wearing the same name. So
an MCP call carries its transcript as evidence and lands in **needs review**,
which is the existing fail-closed rule doing exactly what it was written for:
no structured result means a person reads it. The panel says which transport
is in use and what that costs.

`LiveTransport` is selected whenever the REST host resolves. Nothing else in
the system changes between the two.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any

from .transport import TransportError
from .types import redact

# Preserves install attribution for the skills.sh integration, exactly as
# CALL-E's installation guide specifies.
CLI_ENV = {
    "CALLE_SOURCE": "skills_sh",
    "CALLE_INTEGRATION": "skills_sh_skill",
    "CALLE_INTEGRATION_VERSION": "0.1.0",
}

PLAN_TIMEOUT = 180
RUN_TIMEOUT = 120
STATUS_TIMEOUT = 60

# MCP reports its own lifecycle vocabulary; map it onto the states the
# interpreter already understands.
_TERMINAL = {
    "completed": "completed",
    "succeeded": "completed",
    "success": "completed",
    "finished": "completed",
    "failed": "failed",
    "error": "failed",
    "canceled": "canceled",
    "cancelled": "canceled",
}


class McpTransport:
    """Places calls through the `calle` CLI. Implements the Transport protocol."""

    def __init__(self, binary: str = "calle", timezone: str = "") -> None:
        resolved = shutil.which(binary)
        if not resolved:
            raise TransportError(
                f"the {binary!r} CLI is not installed. Install it with "
                "`npm install -g @call-e/cli` and sign in with `calle auth login`."
            )
        self.binary = resolved
        self.timezone = timezone
        self.runs: dict[str, str] = {}

    # -- plumbing ------------------------------------------------------

    def _run(self, args: list[str], *, timeout: int) -> dict[str, Any]:
        try:
            proc = subprocess.run(
                [self.binary, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, **CLI_ENV},
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise TransportError(
                f"calle {' '.join(args[:2])} timed out after {timeout}s"
            ) from exc

        if proc.returncode != 0:
            # CLI output is provider-written and can echo the number dialed.
            detail = redact((proc.stderr or proc.stdout or "").strip()[:400])
            raise TransportError(f"calle {' '.join(args[:2])} failed: {detail}")
        try:
            payload = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise TransportError(
                f"calle {' '.join(args[:2])} returned output that is not JSON"
            ) from exc
        if payload.get("ok") is False:
            raise TransportError(f"calle reported failure: {redact(str(payload)[:300])}")
        return payload

    @staticmethod
    def _structured(payload: dict[str, Any]) -> dict[str, Any]:
        """Pull the structured body out of an MCP tool envelope."""
        result = payload.get("result") or {}
        content = result.get("structuredContent")
        if isinstance(content, dict):
            return content
        for item in result.get("content") or []:
            if item.get("type") == "text":
                try:
                    parsed = json.loads(item.get("text") or "")
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        return {}

    # -- Transport -----------------------------------------------------

    def create_call(self, payload: dict[str, Any], *, idempotency_key: str) -> dict[str, Any]:
        """Plan, then run. The plan step places no call; the run step does.

        MCP has no idempotency header, so a key seen before is refused here
        rather than quietly dialling a second time. That is weaker than the
        REST contract's server-side guarantee, and the README says so.
        """
        if idempotency_key in self.runs:
            return {"id": self.runs[idempotency_key], "replayed": True}

        recipients = payload.get("recipients") or []
        if not recipients:
            raise TransportError("no recipient to call")
        if len(recipients) > 1:
            raise TransportError(
                "MCP plan_call takes one destination at a time; the batch "
                "surface exists only on the REST API"
            )
        phones = recipients[0].get("phones") or []
        if not phones:
            raise TransportError("recipient carries no phone number")

        # The CLI takes --to-phone once per destination, so every number on the
        # recipient is passed. Dropping the extras and dialling only the first
        # would silently narrow an authorised intent.
        plan_args = ["call", "plan"]
        for phone in phones:
            plan_args += ["--to-phone", phone]
        plan_args += ["--goal", payload["task"]]
        if recipients[0].get("region"):
            plan_args += ["--region", recipients[0]["region"]]
        if recipients[0].get("locale"):
            plan_args += ["--language", recipients[0]["locale"]]
        if self.timezone:
            plan_args += ["--timezone", self.timezone]

        plan = self._structured(self._run(plan_args, timeout=PLAN_TIMEOUT))
        plan_id, confirm = plan.get("plan_id"), plan.get("confirm_token")
        if not plan.get("ready_to_run") or not plan_id or not confirm:
            questions = plan.get("clarifying_questions") or []
            raise TransportError(
                "CALL-E did not accept the plan"
                + (f": {questions}" if questions else "")
            )

        started = self._structured(
            self._run(
                ["call", "run", "--plan-id", str(plan_id),
                 "--confirm-token", str(confirm)],
                timeout=RUN_TIMEOUT,
            )
        )
        run_id = str(started.get("run_id") or started.get("id") or "")
        if not run_id:
            raise TransportError(
                "run_call returned no run id; use `calle call recover` before "
                "retrying, so an uncertain submission is not dialled twice"
            )
        self.runs[idempotency_key] = run_id
        return {"id": run_id}

    def get_call(self, call_id: str) -> dict[str, Any]:
        """Read a run and shape it like a REST call object.

        `structured_result` is deliberately absent: MCP cannot produce one, and
        inventing it here would mean Certa, not CALL-E, did the extraction.
        The interpreter's fail-closed rule then routes the call to a human,
        which is the correct outcome rather than a workaround.
        """
        payload = self._structured(
            self._run(["call", "status", "--run-id", call_id], timeout=STATUS_TIMEOUT)
        )
        raw_status = str(payload.get("status") or payload.get("state") or "").lower()
        status = _TERMINAL.get(raw_status, "in_progress")

        evidence: list[str] = []
        summary = payload.get("summary") or payload.get("call_summary")
        if isinstance(summary, str) and summary.strip():
            evidence.append(redact(summary.strip()))
        for turn in payload.get("transcript") or payload.get("transcript_turns") or []:
            if isinstance(turn, dict) and turn.get("text"):
                evidence.append(redact(f"{turn.get('speaker', 'unknown')}: {turn['text']}"))
            elif isinstance(turn, str):
                evidence.append(redact(turn))

        return {
            "id": call_id,
            "status": status,
            "evidence": evidence,
            "recipients": [{"structured_result": None}],
            "mcp_raw_status": raw_status,
            "transport": "mcp",
        }

    def list_events(self, call_id: str) -> dict[str, Any]:
        """MCP exposes no developer event stream; reconciliation re-reads status."""
        return {"object": "list", "data": []}
