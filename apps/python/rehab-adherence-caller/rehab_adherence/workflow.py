"""Run the course over a caller port and produce a durable ledger.

The workflow has no live/fixture branch: it takes a `CallPort`. That is what lets
the whole test suite and the demo run with no credentials and no calls, while the
live path is the same code.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from typing import Any

from .calle import CallPort, redact, safe_error
from .decide import Decision, Interpretation, decide, interpret, recommend
from .goal import build_result_schema, build_task, idempotency_key, reference
from .model import CourseFile, mask_phone


@dataclass(frozen=True)
class Row:
    """One patient, one decision, and the call result if a call happened."""

    patient_id: str
    masked_phone: str
    trajectory: str
    action: str
    reason: str
    blockers: tuple[str, ...]
    called: bool
    status: str | None = None
    outcome: str | None = None
    promised_date: str | None = None
    escalate_to_clinician: bool = False
    note: str | None = None
    call_id: str | None = None
    simulated: bool | None = None
    reference: str | None = None
    transcript: list[dict[str, str]] | None = None
    concession_spent: str | None = None
    barrier: str | None = None
    evidence_summary: str | None = None
    confidence: float | None = None
    recommendation: str | None = None
    replayed: bool = False
    signals: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["blockers"] = list(self.blockers)
        return payload


def build_call_arguments(course_file: CourseFile, patient_id: str, decision: Decision) -> dict[str, Any]:
    """The exact private payload CALL-E would receive; preview masks a copy."""
    patient = next(p for p in course_file.patients if p.id == patient_id)
    task = build_task(course_file.clinic, course_file.course, patient, decision)
    return {
        "task": task,
        "recipients": [{"phones": [patient.phone_e164], "locale": "en"}],
        "result_schema": build_result_schema(course_file.course),
        "metadata": {
            "workflow_type": "rehab_course_adherence",
            "course_id": course_file.course.id,
            "trajectory": decision.trajectory,
            "action": decision.action,
        },
        "idempotency_key": idempotency_key(course_file.course, patient, decision, task),
    }


def masked_call_arguments(course_file: CourseFile, patient_id: str, decision: Decision) -> dict[str, Any]:
    arguments = build_call_arguments(course_file, patient_id, decision)
    patient = next(p for p in course_file.patients if p.id == patient_id)
    arguments["recipients"] = [{"phones": [mask_phone(patient.phone_e164)], "locale": "en"}]
    arguments["task"] = redact(arguments["task"])
    return arguments


def plan(course_file: CourseFile, today: date) -> list[tuple[Decision, Row]]:
    """Classify every patient. Places no call and needs no port."""
    planned: list[tuple[Decision, Row]] = []
    for patient in course_file.patients:
        decision = decide(patient, course_file.course, course_file.policy, today)
        planned.append(
            (
                decision,
                Row(
                    patient_id=patient.id,
                    masked_phone=mask_phone(patient.phone_e164),
                    trajectory=decision.trajectory,
                    action=decision.action,
                    reason=decision.reason,
                    blockers=decision.blockers,
                    called=False,
                    reference=reference(course_file.clinic, course_file.course, patient),
                    signals=asdict(decision.signals),
                ),
            )
        )
    return planned


def run(course_file: CourseFile, today: date, port: CallPort) -> list[Row]:
    """Classify, call where the gate allows, and interpret every result.

    One call per eligible patient, serially. A failure on one patient records the
    reason and continues; it does not abandon the course.
    """
    rows: list[Row] = []
    for decision, row in plan(course_file, today):
        if not decision.will_call:
            rows.append(
                Row(**{**row.to_dict(), "blockers": tuple(row.blockers),
                       "recommendation": recommend(decision.trajectory, None, None, None)})
            )
            continue

        arguments = build_call_arguments(course_file, decision.patient_id, decision)
        try:
            result = port.place(arguments, patient_id=decision.patient_id)
        except Exception as exc:  # noqa: BLE001 - the outcome is unknown, not failed
            # A create or poll that raised may still have placed a call: the
            # request can reach the provider and the response be lost. Recording
            # called=False and moving on is how the same person gets dialled
            # twice, so an ambiguous outcome retains "unknown", keeps called
            # true, and stops the run. An interruption cannot recall a call that
            # was already accepted -- only a human reconciling the checkpoint
            # against the dashboard can establish what actually happened.
            rows.append(
                Row(
                    **{
                        **row.to_dict(),
                        "blockers": tuple(row.blockers),
                        "called": True,
                        "outcome": "unknown_possibly_placed",
                        "escalate_to_clinician": True,
                        "note": (
                            f"{safe_error(exc)} during create or poll — a call may have been "
                            "placed. Reconcile the checkpoint file against the CALL-E dashboard "
                            "before running this course again."
                        ),
                        "recommendation": (
                            "stop: reconcile this patient by hand before any further automated call"
                        ),
                    }
                )
            )
            break

        reading: Interpretation = interpret(
            result.get("status") or "",
            result.get("structured_result"),
            course_file.course,
            result.get("evidence"),
        )
        structured = result.get("structured_result") or {}
        barrier = structured.get("barrier") if isinstance(structured, dict) else None
        rows.append(
            Row(
                **{
                    **row.to_dict(),
                    "blockers": tuple(row.blockers),
                    "called": True,
                    "barrier": barrier,
                    "concession_spent": reading.concession_spent,
                    "evidence_summary": (
                        structured.get("evidence_summary") if isinstance(structured, dict) else None
                    ),
                    "confidence": result.get("completion_confidence"),
                    "recommendation": recommend(
                        decision.trajectory, reading.outcome, barrier, reading.concession_spent
                    ),
                    "status": result.get("status"),
                    "outcome": reading.outcome,
                    "promised_date": reading.promised_date.isoformat() if reading.promised_date else None,
                    "escalate_to_clinician": reading.escalate_to_clinician,
                    "note": reading.note,
                    "call_id": result.get("call_id"),
                    "simulated": result.get("simulated"),
                    "replayed": bool(result.get("replayed")),
                    "transcript": result.get("transcript") or [],
                }
            )
        )
    return rows
