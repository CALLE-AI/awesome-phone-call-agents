"""The deterministic safety gate, re-exported for the CLI.

Every rule lives in `claimcall_core.safety`. It is ordinary Python with tests,
never a prompt, so no model output and no provider fallback can widen what it
permits.

What it refuses outright: emergency and consumer-helpline destinations, secrets
or government IDs anywhere in the spoken text, instruction-injection text
arriving through an invoice, a disclosure that hides the automation, a plan
with no result schema, an expired plan, and a plan edited after it was sealed.

What it holds for a human: a non-zero pre-authorised fee, and any goal that
reads like a commitment the owner did not grant.
"""

from __future__ import annotations

from claimcall_core.safety import (
    CHECKS_RUN,
    FORBIDDEN_ACTION_PATTERNS,
    INJECTION_PATTERNS,
    MAX_DISCLOSURES,
    SECRET_PATTERNS,
    evaluate,
)
from claimpilot_contracts import SafetyDecision, SafetyReport

__all__ = [
    "CHECKS_RUN",
    "FORBIDDEN_ACTION_PATTERNS",
    "INJECTION_PATTERNS",
    "MAX_DISCLOSURES",
    "SECRET_PATTERNS",
    "SafetyDecision",
    "SafetyReport",
    "evaluate",
    "render_report",
]


def render_report(report: SafetyReport) -> str:
    """Human-readable safety summary for the terminal."""
    symbol = {
        SafetyDecision.PASS: "PASS",
        SafetyDecision.HOLD: "HOLD",
        SafetyDecision.REJECT: "REJECT",
    }[report.decision]
    lines = [f"Safety gate: {symbol}  ({len(report.checks_run)} checks run)"]
    if not report.findings:
        lines.append("  No findings.")
    for finding in report.findings:
        lines.append(f"  [{finding.decision.value.upper()}] {finding.code}: {finding.message}")
    return "\n".join(lines)
