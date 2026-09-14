"""CALL-E MCP provider via the local `calle` CLI (plan_call -> run_call -> get_call_run).

Why this exists: the Developer API and SDK are labelled beta, while the MCP surface is the most
exercised CALL-E integration path. The trade-off is that `plan_call` takes a natural-language goal
and returns no typed result, so this provider returns `structured_result=None` and the orchestrator's
reconcile step extracts the typed fields from the transcript. Hard requirements are still enforced:
an unextractable field stays "unknown" and the candidate is never assigned.

Every CLI invocation goes through `subprocess` with an argv list (no shell). The CLI reads its own
OAuth cache from ~/.calle-mcp; no token ever passes through this process.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
from typing import Any

from app.calls.provider import CallOutcome, CallRequest, EventSink, ProviderEvent
from app.config import Settings

# Attribution goes through the environment: the installed CLI (0.5.x) rejects the --source flags.
ATTRIBUTION_ENV = {"CALLE_SOURCE": "buddye", "CALLE_INTEGRATION": "buddye_app", "CALLE_INTEGRATION_VERSION": "0.1.0"}
TERMINAL = {"COMPLETED", "FAILED", "NO_ANSWER", "NO ANSWER", "DECLINED", "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED"}


def build_plan_argv(bin_: str, req: CallRequest) -> list[str]:
    goal = (
        req.task
        + "\n\nAt the end of the call, state the answers to each verification item clearly in your final summary, "
        + "using the words yes, no, or unknown for each, and quote the exact sentence of acceptance if any."
    )
    return [bin_, "call", "plan", "--to-phone", req.phone, "--goal", goal, "--region", req.region]


def build_run_argv(bin_: str, plan_id: str, confirm_token: str) -> list[str]:
    return [bin_, "call", "run", "--plan-id", plan_id, "--confirm-token", confirm_token]


def build_status_argv(bin_: str, run_id: str) -> list[str]:
    return [bin_, "call", "status", "--run-id", run_id]


def structured(envelope: dict[str, Any], key: str = "result") -> dict[str, Any]:
    return dict((envelope.get(key) or {}).get("structuredContent") or {})


def outcome_from_status(run_id: str, status_obj: dict[str, Any]) -> CallOutcome:
    status = str(status_obj.get("status", "")).upper().replace(" ", "_")
    transcript_raw = status_obj.get("transcript") or []
    transcript: list[dict[str, Any]] = []
    for t in transcript_raw:
        if isinstance(t, dict):
            transcript.append({"speaker": t.get("speaker") or t.get("role") or "unknown", "text": t.get("text") or t.get("content") or "", "offset_seconds": t.get("offset_seconds")})
        else:
            transcript.append({"speaker": "unknown", "text": str(t), "offset_seconds": None})
    summary = status_obj.get("summary")
    if status == "COMPLETED":
        # MCP has no typed result; the reconciler will extract from transcript + summary.
        return CallOutcome(provider_call_id=run_id, status="INVALID_RESULT", structured_result=None, transcript=transcript, summary=summary, raw=status_obj)
    if status in {"NO_ANSWER", "VOICEMAIL", "BUSY"}:
        return CallOutcome(provider_call_id=run_id, status="NO_ANSWER", structured_result=None, transcript=transcript, summary=summary, failure_code=status.lower(), raw=status_obj)
    return CallOutcome(provider_call_id=run_id, status="FAILED", structured_result=None, transcript=transcript, summary=summary, failure_code=status.lower() or "unknown", raw=status_obj)


class CalleMcpProvider:
    name = "calle_mcp"

    def __init__(self, settings: Settings, runner=None) -> None:
        self.settings = settings
        self._run = runner or self._default_runner

    @staticmethod
    def _default_runner(argv: list[str]) -> dict[str, Any]:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=200, check=False, env={**os.environ, **ATTRIBUTION_ENV})  # noqa: S603
        try:
            return json.loads(proc.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"calle CLI returned non-JSON output (exit {proc.returncode})") from exc

    async def place(self, req: CallRequest, on_event: EventSink) -> CallOutcome:
        bin_ = self.settings.CALLE_CLI_BIN
        if req.existing_provider_call_id:
            run_id = req.existing_provider_call_id
            await on_event(ProviderEvent(type="call.resumed", message="Re-attached to in-flight MCP run", provider_call_id=run_id))
        else:
            plan_env = await asyncio.to_thread(self._run, build_plan_argv(bin_, req))
            plan = structured(plan_env)
            if not plan_env.get("ok") or not plan.get("plan_id"):
                return CallOutcome(provider_call_id=None, status="FAILED", structured_result=None, failure_code="plan_call_failed", failure_message=str(plan_env.get("message") or plan_env.get("error") or "plan_call failed"), raw=plan_env)
            await on_event(ProviderEvent(type="mcp.plan_call", message="plan_call returned a plan", details={"plan_id": plan.get("plan_id"), "ready_to_run": plan.get("ready_to_run")}))
            if plan.get("ready_to_run") is False:
                return CallOutcome(provider_call_id=None, status="FAILED", structured_result=None, failure_code="plan_not_ready", failure_message=str(plan.get("clarification_question") or "plan_call needs clarification"), raw=plan_env)
            run_env = await asyncio.to_thread(self._run, build_run_argv(bin_, str(plan["plan_id"]), str(plan.get("confirm_token", ""))))
            run_id = str(run_env.get("run_id") or structured(run_env, "run_result").get("run_id") or "")
            if not run_env.get("ok") or not run_id:
                return CallOutcome(provider_call_id=None, status="FAILED", structured_result=None, failure_code="run_call_failed", failure_message=str(run_env.get("message") or "run_call failed"), raw=run_env)
            await on_event(ProviderEvent(type="mcp.run_call", message="run_call accepted", provider_call_id=run_id, details={"run_id": run_id}))
        # poll get_call_run
        deadline = asyncio.get_event_loop().time() + self.settings.CALLE_CALL_TIMEOUT_S
        last_status = None
        await asyncio.sleep(min(60.0, self.settings.CALLE_POLL_INTERVAL_S * 4))
        while True:
            env = await asyncio.to_thread(self._run, build_status_argv(bin_, run_id))
            status_obj = structured(env)
            status = str(status_obj.get("status", "")).upper()
            if status and status != last_status:
                last_status = status
                await on_event(ProviderEvent(type=f"mcp.status.{status.lower()}", message=f"get_call_run status: {status}", status=status, provider_call_id=run_id))
            if status in TERMINAL:
                return outcome_from_status(run_id, status_obj)
            if asyncio.get_event_loop().time() > deadline:
                return CallOutcome(provider_call_id=run_id, status="FAILED", structured_result=None, failure_code="timeout", failure_message="poll timeout; run_id retained", raw=status_obj)
            await asyncio.sleep(max(5.0, self.settings.CALLE_POLL_INTERVAL_S))
