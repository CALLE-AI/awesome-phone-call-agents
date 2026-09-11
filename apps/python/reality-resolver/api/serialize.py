"""Internal objects -> safe HTTP representations.

One rule, and it is the reason this module exists as its own file rather
than as dict literals inside the request handler: no internal object is
ever handed to json.dumps directly. Every field a client receives is
named here, explicitly, one at a time.

That rules out dataclasses.asdict() and repr() on engine objects. Both
are convenient and both are exactly wrong for this job - they serialize
whatever the object happens to hold today, so a field added upstream
later would start reaching clients without anyone deciding it should.
A Case, for instance, carries call_phone in the clear; it is masked here
and only here.

Phase 2 needs health, case metadata and errors. Later phases add
resolution payloads on the same rule.
"""

from __future__ import annotations

import re
from typing import Any

from client import mask_phone
from compliance.models import PreCallDecision
from evidence.engine import ReasoningResult
from evidence.model import Case, Evidence
from pipeline import Resolution
from verdict import Verdict

# Case files are authored server-side, not by any client, so this is not
# an injection boundary - it is a bound, so that one oversized claim in a
# case file cannot turn into an unbounded HTTP response. json.dumps
# already escapes control characters, which is the other half of the
# problem the CLI's sanitize_for_display() solves for a terminal.
MAX_TEXT_CHARS = 2000

# Status names, check names, rule names, jurisdiction ids: short by
# nature, so a long one means something is wrong upstream rather than
# that a client needs it all.
MAX_IDENTIFIER_CHARS = 128

TRUNCATION_MARKER = "...[truncated]"


def _text(value: str, max_chars: int = MAX_TEXT_CHARS) -> str:
    if len(value) <= max_chars:
        return value
    return value[: max(0, max_chars - len(TRUNCATION_MARKER))] + TRUNCATION_MARKER


def _hours(seconds: float) -> float | int:
    hours = seconds / 3600.0
    return int(hours) if hours.is_integer() else hours


def health_payload(mode: str, engine_version: str) -> dict[str, Any]:
    """Deliberately three flat fields. No base URL, no configuration
    dump, no build path, no environment echo - a health endpoint is the
    classic place those leak from.
    """
    return {"status": "ok", "mode": mode, "engine_version": engine_version}


def error_payload(code: str, message: str) -> dict[str, Any]:
    """The single error shape. `message` must be text this code wrote,
    never str(exc) from an unexpected failure and never a traceback.
    """
    return {"error": {"code": code, "message": message}}


def evidence_item(item: Evidence) -> dict[str, Any]:
    return {
        "source": _text(item.source),
        "type": item.type.value,
        "freshness_hours": _hours(item.freshness.total_seconds()),
        "claim": _text(item.claim),
        "ambiguity": item.ambiguity.value,
    }


def case_metadata(case: Case) -> dict[str, Any]:
    """Everything a client needs to display a case and choose one, and
    nothing else.

    Two omissions are deliberate. call_phone appears only masked, under a
    name that says so, so no client-side mistake can dial it or log it.
    call_task_hint is left out entirely: it is the operator instruction
    that seeds the task actually spoken on a call, and a client that has
    never needed it should not be handed it by default.
    """
    return {
        "name": _text(case.name),
        "use_case": _text(case.use_case),
        "deadline": case.deadline.isoformat().replace("+00:00", "Z"),
        "decision_deadline_threshold_hours": _hours(case.decision_deadline_threshold.total_seconds()),
        "decision_options": {str(k): _text(str(v)) for k, v in case.decision_options.items()},
        "evidence": [evidence_item(item) for item in case.evidence.items],
        "call_phone_masked": mask_phone(case.call_phone),
    }


def cases_payload(cases: tuple[Case, ...]) -> dict[str, Any]:
    return {"cases": [case_metadata(case) for case in cases]}


# --- engine text ------------------------------------------------------

# Rule reasons and compliance reasons are written by the engine for an
# operator reading a terminal, and one of them interpolates the number
# being dialled: dispatcher.py's jurisdiction_resolved failure quotes it
# verbatim. Rather than special-case that one string - which would break
# silently the next time a rule is written the same way - every reason
# this module emits is scrubbed by the same function.
#
# Same shape as client.PHONE_PATTERN and [0-9] for the same reason: for a
# str pattern \d matches every Unicode decimal digit, so a number written
# in Arabic-Indic or fullwidth digits would slip past a \d version of
# this and reach the client intact.
_PHONE_IN_TEXT = re.compile(r"\+[1-9][0-9]{6,14}")


def sanitize_reason(text: str, max_chars: int = MAX_TEXT_CHARS) -> str:
    """Engine explanation -> text safe to show, with any phone number
    masked. The sentence stays readable: only the digits are replaced,
    so "no jurisdiction mapped for '+44...'" still says what happened.
    """
    return _text(_PHONE_IN_TEXT.sub(lambda m: mask_phone(m.group(0)), text), max_chars)


# --- pipeline objects -------------------------------------------------


def reasoning_payload(reasoning: ReasoningResult) -> dict[str, Any]:
    """R1-R4 exactly as the engine scored them. Nothing is recomputed
    here and nothing may be recomputed downstream: decision_critical is
    the engine's own boolean, and call_decision is a label for it, not a
    second opinion.
    """
    return {
        "rules": [
            {
                "rule_name": _text(rule.rule_name, MAX_IDENTIFIER_CHARS),
                "triggered": rule.triggered,
                "reason": sanitize_reason(rule.reason),
            }
            for rule in reasoning.rules
        ],
        "decision_critical": reasoning.decision_critical,
    }


def compliance_payload(
    decision: PreCallDecision | None,
    applicable: PreCallDecision | None,
    exempted_checks: tuple[str, ...],
    next_legal_window: str | None,
) -> dict[str, Any] | None:
    """The full check list, which of it the use case exempted, and the
    verdict of the applicable subset.

    The unfiltered list is shown on purpose: a gate that says "allowed"
    is only meaningful next to what it looked at and what it set aside.
    jurisdiction_chain is a tuple of module ids - us_federal, fr - not
    anything derived from the recipient, so it is safe as-is.
    """
    if decision is None or applicable is None:
        return None
    return {
        "jurisdiction_chain": [_text(j, MAX_IDENTIFIER_CHARS) for j in decision.jurisdiction_chain],
        "checks": [
            {
                "check_name": _text(check.check_name, MAX_IDENTIFIER_CHARS),
                "passed": check.passed,
                "reason": sanitize_reason(check.reason),
                "confidence": check.confidence.value,
            }
            for check in decision.results
        ],
        "exempted_for_use_case": [_text(name, MAX_IDENTIFIER_CHARS) for name in exempted_checks],
        "allowed": applicable.allowed,
        "next_legal_window": sanitize_reason(next_legal_window) if next_legal_window else None,
    }


# The only keys of CALL-E's structured_result a client ever sees. The
# provider may add fields; they do not become public by appearing.
ALLOWED_RESULT_KEYS = (
    "subject_intent",
    "answered_by",
    "confidence_note",
    "manipulation_attempt_detected",
    "manipulation_attempt_note",
)


def call_payload(resolution: Resolution) -> dict[str, Any]:
    """Three facts and the structured result. Nothing else from the
    provider response crosses this line.

    Resolution.call is the raw object: it carries the recipient's number
    in the clear, every transcript turn, the 3.6k-character hardened
    task (which embeds the case's call_task_hint), per-attempt provider
    ids, and free-text summaries. None of that is projected here, and
    the omission is enforced by naming what is included rather than by
    listing what is not - a field added upstream is excluded by default.
    """
    call = resolution.call
    if call is None:
        return {"placed": resolution.call_placed, "provider_status": None, "result": None}

    raw_result = call.get("structured_result") or {}
    result = {
        key: (_text(value) if isinstance(value, str) else value)
        for key, value in raw_result.items()
        if key in ALLOWED_RESULT_KEYS
    } or None

    return {
        "placed": resolution.call_placed,
        "provider_status": _text(str(call.get("status")), MAX_IDENTIFIER_CHARS)
        if call.get("status") is not None
        else None,
        "result": result,
    }


def verdict_payload(verdict: Verdict | None) -> dict[str, Any] | None:
    """Status and action, and nothing invented when there is neither.

    evidence_cited is deliberately dropped: its last line embeds CALL-E's
    structured_result rendered with !r, so publishing it would route
    provider free text around every other check in this module. The
    client already has `evidence` and `call.result` separately.
    """
    if verdict is None:
        return None
    return {
        "status": _text(verdict.status, MAX_IDENTIFIER_CHARS),
        "action": _text(verdict.action, MAX_IDENTIFIER_CHARS),
    }


def resolution_payload(
    resolution: Resolution,
    resolution_id: str,
    state: str,
    mode: str,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The whole public view of one run.

    `state` and `verdict` are separate fields and never collapse into
    one. state is transport - did this request finish - and a technical
    failure is state "failed" with verdict null. It is never an engine
    outcome, so nothing here can turn a timeout, a provider error, or an
    unresolved call into a cancellation.
    """
    return {
        "id": _text(resolution_id, MAX_IDENTIFIER_CHARS),
        "state": _text(state, MAX_IDENTIFIER_CHARS),
        "mode": _text(mode, MAX_IDENTIFIER_CHARS),
        "case": {
            "name": _text(resolution.case.name),
            "use_case": _text(resolution.case.use_case),
            "decision_options": {
                str(k): _text(str(v)) for k, v in resolution.case.decision_options.items()
            },
        },
        "evidence": [evidence_item(item) for item in resolution.case.evidence.items],
        "reasoning": reasoning_payload(resolution.reasoning),
        "call_decision": "CALL_JUSTIFIED" if resolution.reasoning.decision_critical else "NO_CALL_NEEDED",
        "compliance": compliance_payload(
            resolution.compliance,
            resolution.applicable_compliance,
            resolution.exempted_checks,
            resolution.next_legal_window,
        ),
        "call": call_payload(resolution),
        "verdict": verdict_payload(resolution.verdict),
        "error": error,
    }
