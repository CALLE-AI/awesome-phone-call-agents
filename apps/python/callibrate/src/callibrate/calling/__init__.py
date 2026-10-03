"""The seam between Callibrate and a telephone. CALL-E lives on the far side of it.

The two caller implementations are exported lazily. Both of them depend on the
deterministic evidence reader, and the evidence reader depends on the models in
this package, so importing them eagerly here would make the two packages import
each other. Keeping the models and the interface at the top and resolving the
callers on first use keeps the dependency pointing one way: evidence never
imports a caller, and a caller always imports evidence.
"""

from __future__ import annotations

from typing import Any

from callibrate.calling.base import VerificationCaller
from callibrate.calling.models import (
    CONTACT_OUTCOMES,
    NO_CONTACT_OUTCOMES,
    SAFETY_OUTCOMES,
    CallError,
    CallEvidence,
    CallOutcome,
    Claim,
    Confirmation,
    SafetyEvent,
    SafetyEventKind,
    Turn,
)

_LAZY = {
    "CallEVerificationCaller": "callibrate.calling.calle",
    "render_call_goal": "callibrate.calling.calle",
    "render_user_input": "callibrate.calling.calle",
    "result_schema": "callibrate.calling.calle",
    "CalleAuth": "callibrate.calling.mcp",
    "CalleAuthRequired": "callibrate.calling.mcp",
    "CalleError": "callibrate.calling.mcp",
    "CalleMcpClient": "callibrate.calling.mcp",
    "PilotLineCaller": "callibrate.calling.pilot",
    "PILOT_SCRIPTS": "callibrate.calling.pilot",
}


def __getattr__(name: str) -> Any:
    module_name = _LAZY.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from importlib import import_module

    return getattr(import_module(module_name), name)


__all__ = [
    "CONTACT_OUTCOMES",
    "NO_CONTACT_OUTCOMES",
    "PILOT_SCRIPTS",
    "SAFETY_OUTCOMES",
    "CallError",
    "CallEVerificationCaller",
    "CallEvidence",
    "CallOutcome",
    "CalleAuth",
    "CalleAuthRequired",
    "CalleError",
    "CalleMcpClient",
    "Claim",
    "Confirmation",
    "PilotLineCaller",
    "SafetyEvent",
    "SafetyEventKind",
    "Turn",
    "VerificationCaller",
    "render_call_goal",
    "render_user_input",
    "result_schema",
]
