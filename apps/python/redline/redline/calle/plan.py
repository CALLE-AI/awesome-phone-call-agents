"""Ask CALL-E to plan a call, which costs nothing and rings nobody.

``plan_call`` is the closest thing this platform has to a dry run. CALL-E's own
troubleshooting guide states that "planning does not place a call, so it is safe
to retry after adjusting the timeout", and a third-party integration note goes
further and calls it free. That second claim is the one REDLINE depends on, and
it is worth naming its status: **no CALL-E source says planning is billed, and
none says it is free either.** This module treats it as free and records every
invocation in the ledger, so if that turns out to be wrong the evidence is in
the run rather than in a surprise on an invoice.

Two things make this worth having beyond the cost saving.

**It exercises the real platform.** The submission criterion asks for CALL-E
"imported and actually called at runtime, not just referenced". A planning call
is a real authenticated round trip to the real service, and it can run in CI
for nothing.

**It shows what CALL-E did to your goal.** Planning enriches the goal with
fallback behaviour for no-answer and voicemail, and the plan's ``display_goal``
is the authoritative text -- not what you typed. That means REDLINE can read
back the goal *as the platform will actually run it* and check the defences on
that, rather than on the draft. Nobody else is looking at this.

The transport is the official CLI rather than a Python MCP client. The MCP path
needs OAuth or a broker-login exchange, and reimplementing that to reach one
free tool would be a large amount of security-sensitive code for no benefit;
`@call-e/cli` already holds a token cache at mode 0600 and never prints it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from redline.redact import redact
from redline.spend import SpendLedger

__all__ = [
    "PlanResult",
    "PlanningError",
    "cli_available",
    "plan_call",
]

#: The one MCP tool this module is allowed to invoke. `run_call` places a call
#: and must never be reachable from here; a test asserts on the command line
#: this module builds.
PLAN_TOOL = "plan_call"

#: Planning is slow -- 16 to 19 seconds observed, which is why the CLI's own
#: plan timeout is 150s where everything else is 15s.
DEFAULT_TIMEOUT_SECONDS = 180


class PlanningError(RuntimeError):
    """A plan could not be obtained. Never means a call was placed."""


@dataclass(frozen=True, slots=True)
class PlanResult:
    """What CALL-E says it would do, before doing anything."""

    accepted: bool
    """Whether CALL-E is willing to run this goal at all."""

    plan_id: str | None = None
    display_goal: str = ""
    """The goal as CALL-E rewrote it. Authoritative over what you sent."""

    clarifying_questions: tuple[str, ...] = ()
    refusal: str = ""
    """The content screen's own words when it declines, in prose. There is no
    stable code for this: `policy_violation` exists in the enum and is never
    returned, and `call_not_ready` covers at least three different causes."""

    raw: Mapping[str, Any] = field(default_factory=dict)

    @property
    def was_rewritten(self) -> bool:
        return bool(self.display_goal)


def cli_available() -> bool:
    """Whether the CALL-E CLI can be reached at all."""
    return shutil.which("npx") is not None or shutil.which("calle") is not None


def plan_call(
    goal: str,
    *,
    ledger: SpendLedger,
    to_phone: str | None = None,
    region: str | None = None,
    language: str | None = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    runner: Any = None,
) -> PlanResult:
    """Plan a call and return what CALL-E made of it. Places no call.

    ``runner`` exists so tests can drive this without a network or a CLI. It
    receives the argument list and returns a ``CompletedProcess``.
    """
    arguments: dict[str, Any] = {"user_input": goal, "goal": goal}
    if to_phone:
        arguments["to_phones"] = [to_phone]
    if region:
        arguments["region"] = region
    if language:
        arguments["language"] = language

    command = _build_command(arguments)
    ledger.record_dry(PLAN_TOOL, detail="planning only, no call placed")

    execute = runner or _run
    try:
        completed = execute(command, timeout_seconds)
    except FileNotFoundError as error:
        raise PlanningError(
            "the CALL-E CLI is not installed. Install Node and run "
            "`npx -y @call-e/cli auth login`, or stay on the offline "
            "transports which need nothing."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise PlanningError(
            f"planning timed out after {timeout_seconds}s. Planning does not "
            "place a call, so retrying is safe."
        ) from error

    if completed.returncode != 0:
        raise PlanningError(
            f"planning failed: {redact(completed.stderr.strip() or 'no output')}"
        )

    return _parse(completed.stdout)


def _build_command(arguments: Mapping[str, Any]) -> list[str]:
    """Build the CLI invocation.

    Written as an argument list, never a shell string: command injection
    through interpolated arguments is one of the documented rejection motives
    on the submission repository, and a goal is attacker-influenced text.
    """
    return [
        "npx",
        "-y",
        "@call-e/cli",
        "mcp",
        "call",
        PLAN_TOOL,
        "--args-json",
        json.dumps(arguments, ensure_ascii=False),
    ]


def _run(command: Sequence[str], timeout_seconds: int) -> Any:
    return subprocess.run(
        list(command),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )


def _parse(stdout: str) -> PlanResult:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise PlanningError(
            f"could not read the CLI's output as JSON: {redact(stdout[:200])}"
        ) from error

    # `mcp call` puts the tool's own output under result.structuredContent.
    content = payload
    for key in ("result", "structuredContent"):
        if isinstance(content, Mapping) and key in content:
            content = content[key]
    if not isinstance(content, Mapping):
        raise PlanningError("the CLI returned no structured content")

    refusal = _refusal_text(content)
    return PlanResult(
        accepted=not refusal and bool(content.get("plan_id")),
        plan_id=_optional_str(content.get("plan_id")),
        display_goal=_optional_str(content.get("display_goal")) or "",
        clarifying_questions=_string_tuple(content.get("clarifying_questions")),
        refusal=refusal,
        raw=dict(content),
    )


def _refusal_text(content: Mapping[str, Any]) -> str:
    """Find the content screen's refusal, wherever this version puts it.

    Deliberately tolerant. The refusal arrives as prose in an undocumented,
    unversioned shape, so a parser that insists on one field would report a
    refused goal as an accepted one -- the worst possible direction to be
    wrong in.
    """
    for key in ("refusal", "blocked_reason", "error", "message"):
        value = content.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(item for item in value if isinstance(item, str))
