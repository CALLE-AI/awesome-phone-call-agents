"""Planning-only adapter around the authenticated official CALL-E CLI."""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Sequence
from typing import Any

from quotewake_salesforce.domain.models import (
    CallPlanDecision,
    CallPlanRequest,
    CallPlanResult,
)
from quotewake_salesforce.structured_logging import log_event


class CallEPlanningError(RuntimeError):
    """Raised when CALL-E cannot safely produce a planning result."""


PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")


def _redact_remote_text(value: str) -> str:
    """Remove phone-like values from untrusted remote planning prose."""

    return PHONE_LIKE_PATTERN.sub("[phone-redacted]", value)


class CallEPlanningClient:
    """Call only CALL-E plan_call; this class has no call execution method."""

    def __init__(
        self,
        command: Sequence[str] = ("calle",),
        *,
        timeout_seconds: int = 120,
    ) -> None:
        if not command:
            raise ValueError("CALL-E CLI command cannot be empty.")
        self.command = tuple(command)
        self.timeout_seconds = timeout_seconds

    def _environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "CALLE_SOURCE": "quotewake_salesforce",
                "CALLE_INTEGRATION": "python_app",
                "CALLE_INTEGRATION_VERSION": "0.1.0",
            }
        )
        return environment

    def _run(
        self,
        arguments: Sequence[str],
        *,
        expect_json: bool,
        quote_id: str | None = None,
    ) -> dict[str, Any]:
        command = [*self.command, *arguments]
        operation = " ".join(arguments[:3])
        log_event(
            "call_e_cli_command_started",
            quote_id=quote_id,
            operation=operation,
            expect_json=expect_json,
        )
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                env=self._environment(),
            )
        except FileNotFoundError as exc:
            raise CallEPlanningError(
                "The official CALL-E CLI is not installed or is not on PATH."
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise CallEPlanningError(
                f"CALL-E CLI timed out after {self.timeout_seconds} seconds."
            ) from exc

        payload: dict[str, Any] = {}
        if expect_json:
            try:
                parsed = json.loads(completed.stdout)
            except json.JSONDecodeError as exc:
                raise CallEPlanningError(
                    "CALL-E CLI returned malformed JSON."
                ) from exc
            if not isinstance(parsed, dict):
                raise CallEPlanningError("CALL-E CLI did not return a JSON object.")
            payload = parsed

        if completed.returncode != 0 or payload.get("ok") is False:
            error = payload.get("error")
            code = error.get("code") if isinstance(error, dict) else None
            if code == "auth_required":
                raise CallEPlanningError(
                    "CALL-E authentication is required. Run 'calle auth login' and retry."
                )
            suffix = f" ({code})" if isinstance(code, str) and code else ""
            raise CallEPlanningError(f"CALL-E CLI command failed{suffix}.")
        log_event(
            "call_e_cli_command_completed",
            quote_id=quote_id,
            operation=operation,
            expect_json=expect_json,
        )
        return payload

    def verify_ready(self) -> None:
        """Verify CLI availability and an already usable login without interactive auth."""

        log_event("call_e_readiness_check_started")
        self._run(("--help",), expect_json=False)
        status = self._run(("auth", "status", "--json"), expect_json=True)
        if status.get("usable") is not True:
            raise CallEPlanningError(
                "CALL-E authentication is not usable. Run 'calle auth login' and retry."
            )
        tools_payload = self._run(("mcp", "tools", "--json"), expect_json=True)
        tools_result = tools_payload.get("result")
        tools = tools_result.get("tools") if isinstance(tools_result, dict) else None
        names = (
            {
                item.get("name")
                for item in tools
                if isinstance(item, dict) and isinstance(item.get("name"), str)
            }
            if isinstance(tools, list)
            else set()
        )
        if "plan_call" not in names:
            raise CallEPlanningError("CALL-E does not expose the required plan_call tool.")
        log_event("call_e_readiness_check_completed", plan_call_available=True)

    def plan(self, request: CallPlanRequest) -> CallPlanResult:
        """Create one remote CALL-E plan without invoking run_call."""

        log_event(
            "call_e_plan_request_started",
            quote_id=request.quote_id,
            language=request.language,
            region=request.region,
        )
        arguments = {
            "to_phones": [request.phone],
            "goal": request.goal,
            "user_input": request.user_input,
            "language": request.language,
            "region": request.region,
        }
        payload = self._run(
            (
                "mcp",
                "call",
                "plan_call",
                "--args-json",
                json.dumps(arguments, ensure_ascii=False, separators=(",", ":")),
                "--json",
            ),
            expect_json=True,
            quote_id=request.quote_id,
        )
        result = payload.get("result")
        if not isinstance(result, dict):
            raise CallEPlanningError("CALL-E plan_call returned no result object.")
        structured = result.get("structuredContent") or result.get("structured_content")
        if not isinstance(structured, dict):
            structured = result

        plan_id = structured.get("plan_id")
        ready_to_run = structured.get("ready_to_run")
        if not isinstance(plan_id, str) or not isinstance(ready_to_run, bool):
            raise CallEPlanningError(
                "CALL-E plan_call returned an incomplete structured result."
            )
        summary = structured.get("confirm_summary")
        if summary is not None and not isinstance(summary, str):
            summary = None
        if isinstance(summary, str):
            summary = _redact_remote_text(summary)
        raw_questions = structured.get("clarifying_questions")
        questions = (
            tuple(
                _redact_remote_text(item)
                for item in raw_questions
                if isinstance(item, str)
            )
            if isinstance(raw_questions, list)
            else ()
        )
        plan_result = CallPlanResult(
            quote_id=request.quote_id,
            decision=(
                CallPlanDecision.PLAN_READY
                if ready_to_run
                else CallPlanDecision.PLAN_INCOMPLETE
            ),
            ready_to_run=ready_to_run,
            plan_id=plan_id,
            confirm_summary=summary,
            clarifying_questions=questions,
        )
        log_event(
            "call_e_plan_request_completed",
            quote_id=request.quote_id,
            decision=plan_result.decision.value,
            ready_to_run=plan_result.ready_to_run,
            plan_id=plan_result.plan_id,
        )
        return plan_result
