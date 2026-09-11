"""Export a run as JSON, for CI and for anything that is not a terminal.

Two commitments this format makes, both of which cost something and are worth
it:

* **It is redacted.** A report file is the easiest thing in the world to paste
  into a public issue, so every string in it goes through
  :mod:`redline.redact` -- including the raw upstream payload.
* **It says how the verdict was produced.** ``transport`` and
  ``ground_truth.declared_by`` travel with every result, because "declared by a
  static model" and "attested by an operator on a real call"
  are different claims and a consumer of this file cannot tell them apart
  otherwise.

The shape is versioned. Anything reading it should check ``schema_version``
before trusting a field.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from redline.evaluate.engine import RunReport, ScenarioResult
from redline.redact import redact, redact_payload
from redline.verify import Verification

__all__ = ["SCHEMA_VERSION", "report_to_dict", "verification_to_dict", "write_json"]

SCHEMA_VERSION = 1


def report_to_dict(report: RunReport, *, include_raw: bool = False) -> dict[str, Any]:
    """Serialise a run.

    ``include_raw`` attaches the upstream payload for each call. Off by default
    because it is large; redacted either way.
    """
    return {
        "schema_version": SCHEMA_VERSION,
        "subject": redact(report.subject_name),
        "transport": report.transport,
        "duration_seconds": round(report.duration_seconds, 3),
        "real_calls_placed": report.real_calls_placed,
        "summary": {
            "total": report.total,
            "passed": report.passed,
            "failed": report.failed,
            "skipped": report.skipped,
            "critical_failures": len(report.critical_failures),
        },
        "missing_defences": sorted(d.value for d in report.missing_defences),
        "results": [
            _result_to_dict(result, include_raw=include_raw)
            for result in report.results
        ],
    }


def _result_to_dict(result: ScenarioResult, *, include_raw: bool) -> dict[str, Any]:
    record = result.record
    payload: dict[str, Any] = {
        "scenario": {
            "id": result.scenario.id,
            "family": str(result.scenario.family),
            "severity": str(result.scenario.severity),
            "title": redact(result.scenario.title),
        },
        "status": str(result.status),
        "missing_defences": sorted(d.value for d in result.missing_defences),
        "checks": [
            {
                "assertion": outcome.name,
                "status": str(outcome.status),
                "detail": redact(outcome.detail),
                "because": redact(outcome.because),
                "turns": list(outcome.turns),
            }
            for outcome in result.outcomes
        ],
        "call": {
            "task_completed": record.task_completed,
            "completion_confidence": (
                {
                    "score": record.completion_confidence.score,
                    "label": record.completion_confidence.label,
                }
                if record.completion_confidence
                else None
            ),
            "structured_result": redact_payload(record.structured_result),
            "evidence": [redact(item) for item in record.evidence],
            "failure_code": record.failure_code,
            "duration_seconds": record.duration_seconds,
            "transcript": [
                {
                    "index": turn.index,
                    "speaker": str(turn.speaker),
                    "text": redact(turn.text),
                    "offset_seconds": turn.offset_seconds,
                }
                for turn in record.transcript
            ],
            "ground_truth": {
                "disposition": str(record.ground_truth.disposition),
                "human_confirmed": record.ground_truth.human_confirmed,
                # Named explicitly: a scripted truth is a measurement, an
                # operator's is testimony, and this file must not blur them.
                "declared_by": record.ground_truth.declared_by,
            },
        },
    }
    if include_raw:
        payload["call"]["raw"] = redact_payload(record.raw)
    return payload


def verification_to_dict(verification: Verification) -> dict[str, Any]:
    """Serialise a before/after verification."""
    patch = verification.patch
    return {
        "schema_version": SCHEMA_VERSION,
        "patch": {
            "goal_changed": patch.goal_changed,
            "schema_changed": patch.schema_changed,
            "defences_added": sorted(d.value for d in patch.defences_added),
            "goal_diff": redact(patch.goal_diff()),
            "remedies": [
                {
                    "kind": str(remedy.kind),
                    "summary": remedy.summary,
                    "rationale": remedy.rationale,
                    "defence": remedy.defence.value if remedy.defence else None,
                    "closes": list(remedy.closes),
                }
                for remedy in patch.remedies
            ],
        },
        "closed": list(verification.closed),
        "still_failing": list(verification.still_failing),
        "regressions": list(verification.regressions),
        # The price of the patch, in the same units as its benefit. Present
        # even when zero, so a consumer can tell "measured and none" from
        # "not measured".
        "benign": {
            "total": verification.benign_total,
            "regressions": list(verification.benign_regressions),
            "repaired": list(verification.benign_repaired),
        },
        "before": report_to_dict(verification.before),
        "after": report_to_dict(verification.after),
    }


def write_json(payload: Mapping[str, Any], path: Path) -> Path:
    """Write a report, creating the directory if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline= empty so the file carries LF on Windows too. See report/html.py.
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(
            json.dumps(payload, indent=2, sort_keys=False, ensure_ascii=False) + "\n"
        )
    return path
