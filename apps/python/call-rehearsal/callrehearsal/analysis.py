"""Rehearse a call plan against every realistic ending of the call.

The question this answers is not "did the call work". It is: when the call ends
the way calls actually end, what does the automation on the other side do?

A phone call is a real-world side effect and so is whatever the result triggers.
The failure that matters is a call that never reached a consenting human still
resolving to the branch that ships the order.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

from . import expressions
from .outcomes import OUTCOMES, Outcome
from .plan import CallPlan

CRITICAL = "critical"
HIGH = "high"
MEDIUM = "medium"
LOW = "low"

SEVERITY_ORDER = (CRITICAL, HIGH, MEDIUM, LOW)
_SEVERITY_RANK = {name: index for index, name in enumerate(SEVERITY_ORDER)}

_ROLE_FOR_RECORD = {
    "reachability": "reachability",
    "identity": "identity",
    "consent": "consent",
    "deferral": "deferral",
    "callback": "deferral",
}

_RECORD_SEVERITY = {
    "reachability": HIGH,
    "identity": HIGH,
    "consent": HIGH,
    "deferral": MEDIUM,
}

_TASK_TOPICS = {
    "reachability": ("voicemail", "answering machine", "voice mail", "no answer", "nobody answers"),
    "identity": (
        "identity",
        "verify",
        "speaking with",
        "speaking to",
        "confirm you are",
        "right person",
        "account holder",
    ),
    "consent": (
        "consent",
        "permission",
        "good time",
        "may i",
        "if they decline",
        "happy to continue",
        "willing to continue",
    ),
    "deferral": ("call back", "callback", "another time", "decide later", "reschedule"),
}


@dataclass(frozen=True)
class Finding:
    """One problem discovered while rehearsing."""

    code: str
    severity: str
    outcome: str
    summary: str
    detail: str


@dataclass(frozen=True)
class Rehearsal:
    """What happened when one outcome was rehearsed."""

    outcome: Outcome
    result: dict
    branch_taken: bool
    action: str
    side_effect: bool


def project(plan: CallPlan, outcome: Outcome) -> dict:
    """Build the structured result CALL-E would plausibly return for an outcome."""
    result: dict[str, object] = {}
    decision_field = plan.fields["decision"]
    if outcome.agreed is not None:
        result[decision_field] = outcome.agreed

    reachability_field = plan.field_for("reachability")
    if reachability_field:
        result[reachability_field] = "answered" if outcome.reached_human else outcome.identifier

    consent_field = plan.field_for("consent")
    if consent_field and outcome.consent_given is not None:
        result[consent_field] = outcome.consent_given

    identity_field = plan.field_for("identity")
    if identity_field and outcome.identity_verified is not None:
        result[identity_field] = outcome.identity_verified

    deferral_field = plan.field_for("deferral")
    if deferral_field:
        result[deferral_field] = "deferral" in outcome.records

    established = outcome.reached_human and (
        outcome.agreed is not None or outcome.identifier == "partial_answer"
    )
    if established:
        roles = set(plan.fields.values())
        for name, spec in plan.schema_properties.items():
            if name in roles or name in result:
                continue
            result[name] = _placeholder(spec)
    return result


def _placeholder(spec: object) -> object:
    kind = spec.get("type") if isinstance(spec, dict) else None
    if kind == "boolean":
        return True
    if kind in ("integer", "number"):
        return 1
    if kind == "array":
        return []
    if kind == "object":
        return {}
    return "stated-on-call"


def rehearse(plan: CallPlan) -> list[Rehearsal]:
    """Run the plan against every outcome in the library."""
    rehearsals = []
    for outcome in OUTCOMES:
        result = project(plan, outcome)
        taken = expressions.evaluate(plan.expression, result)
        branch = plan.branch_for(taken)
        rehearsals.append(
            Rehearsal(
                outcome=outcome,
                result=result,
                branch_taken=taken,
                action=branch.action,
                side_effect=branch.side_effect,
            )
        )
    return rehearsals


def analyse(plan: CallPlan, rehearsals: list[Rehearsal]) -> list[Finding]:
    """Collect every problem the rehearsal exposed."""
    findings: list[Finding] = []
    findings.extend(_unsafe_side_effects(rehearsals))
    findings.extend(_indistinguishable(plan, rehearsals))
    findings.extend(_unrecordable(plan))
    findings.extend(_unsatisfiable_required(plan, rehearsals))
    findings.extend(_silent_task(plan))
    findings.sort(key=lambda item: (_SEVERITY_RANK[item.severity], item.code, item.outcome))
    return findings


def _unsafe_side_effects(rehearsals: list[Rehearsal]) -> list[Finding]:
    findings = []
    for item in rehearsals:
        if not item.side_effect or item.outcome.is_confirmation:
            continue
        reason = _why_not_confirmation(item.outcome)
        findings.append(
            Finding(
                code="unsafe-side-effect",
                severity=CRITICAL,
                outcome=item.outcome.identifier,
                summary=f"'{item.action}' runs when {item.outcome.label.lower()}",
                detail=(
                    f"{item.outcome.description} {reason} The result "
                    f"{_render(item.result)} still resolves the decision rule to "
                    f"'{item.action}', which changes the real world."
                ),
            )
        )
    return findings


def _why_not_confirmation(outcome: Outcome) -> str:
    if not outcome.reached_human:
        return "No person was reached at all."
    if outcome.identity_verified is not True:
        return "The intended callee was never confirmed to be on the line."
    if outcome.consent_given is not True:
        return "The callee did not consent to continue."
    return "The callee never said yes."


def _indistinguishable(plan: CallPlan, rehearsals: list[Rehearsal]) -> list[Finding]:
    confirmed = next(
        (item for item in rehearsals if item.outcome.identifier == "human_confirmed"), None
    )
    if confirmed is None:
        return []
    findings = []
    for item in rehearsals:
        if item.outcome.identifier == "human_confirmed" or item.outcome.is_confirmation:
            continue
        if item.result == confirmed.result:
            findings.append(
                Finding(
                    code="indistinguishable-from-confirmation",
                    severity=HIGH,
                    outcome=item.outcome.identifier,
                    summary=f"{item.outcome.label} is indistinguishable from a real confirmation",
                    detail=(
                        f"{item.outcome.description} It produces exactly the same result "
                        f"as a verified human confirmation, {_render(item.result)}, so nothing "
                        "downstream, and no later audit, can tell the two apart."
                    ),
                )
            )
    return findings


def _unrecordable(plan: CallPlan) -> list[Finding]:
    findings = []
    seen: set[str] = set()
    for outcome in OUTCOMES:
        for record in outcome.records:
            role = _ROLE_FOR_RECORD[record]
            if role in seen or plan.field_for(role):
                continue
            seen.add(role)
            findings.append(
                Finding(
                    code="unrecordable-outcome",
                    severity=_RECORD_SEVERITY[role],
                    outcome=outcome.identifier,
                    summary=f"The result schema cannot record {role}",
                    detail=(
                        f"Outcomes such as '{outcome.label.lower()}' turn on {role}, but no "
                        f"field is declared for that role, so the distinction is lost before "
                        "the result reaches the automation."
                    ),
                )
            )
    return findings


def _unsatisfiable_required(plan: CallPlan, rehearsals: list[Rehearsal]) -> list[Finding]:
    findings = []
    for name in plan.required_fields:
        missing = [item.outcome for item in rehearsals if name not in item.result]
        if not missing:
            continue
        names = ", ".join(outcome.identifier for outcome in missing[:4])
        findings.append(
            Finding(
                code="unsatisfiable-required-field",
                severity=MEDIUM,
                outcome=missing[0].identifier,
                summary=f"Required field '{name}' cannot always be filled",
                detail=(
                    f"'{name}' is listed in result_schema.required, but the call cannot "
                    f"establish it for these outcomes: {names}. The result will either "
                    "violate its own schema or be filled with a value nobody said."
                ),
            )
        )
    return findings


def _silent_task(plan: CallPlan) -> list[Finding]:
    lowered = plan.task.lower()
    findings = []
    for topic, phrases in _TASK_TOPICS.items():
        if any(phrase in lowered for phrase in phrases):
            continue
        findings.append(
            Finding(
                code="task-silent-on-outcome",
                severity=LOW,
                outcome="-",
                summary=f"The task text gives the agent no instruction about {topic}",
                detail=(
                    f"Nothing in the task tells the agent what to do about {topic}, so the "
                    "behaviour on that path is whatever the model improvises."
                ),
            )
        )
    return findings


def worst_severity(findings: list[Finding]) -> str | None:
    """Return the highest severity present, or None when the plan is clean."""
    for severity in SEVERITY_ORDER:
        if any(finding.severity == severity for finding in findings):
            return severity
    return None


def _render(result: dict) -> str:
    if not result:
        return "{} (nothing was extracted)"
    parts = ", ".join(f"{key}={value!r}" for key, value in sorted(result.items()))
    return "{" + parts + "}"


def to_dict(plan: CallPlan, rehearsals: list[Rehearsal], findings: list[Finding]) -> dict:
    """Build the machine-readable report."""
    return {
        "plan": plan.name,
        "expression": plan.expression,
        "outcomes": [
            {
                "outcome": item.outcome.identifier,
                "label": item.outcome.label,
                "is_confirmation": item.outcome.is_confirmation,
                "result": {key: _jsonable(value) for key, value in item.result.items()},
                "branch": "on_true" if item.branch_taken else "on_false",
                "action": item.action,
                "side_effect": item.side_effect,
            }
            for item in rehearsals
        ],
        "findings": [asdict(finding) for finding in findings],
        "worst_severity": worst_severity(findings),
    }


def _jsonable(value: object) -> object:
    return value if isinstance(value, (str, int, float, bool, list, dict, type(None))) else str(value)
