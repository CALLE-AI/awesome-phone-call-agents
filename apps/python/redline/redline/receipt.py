"""Content-addressed, redaction-free release receipts.

A receipt contains hashes and bounded verdicts, never the task, context values,
transcript, phone number, evidence text, or provider payload. It is therefore
safe to attach to CI while still binding a verdict to the exact contract and
catalogue that produced it.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from redline import __version__
from redline.evaluate.engine import RunReport
from redline.scenario.model import Scenario
from redline.subject import SubjectUnderTest
from redline.verify import Verification

__all__ = [
    "RECEIPT_SCHEMA_VERSION",
    "build_run_receipt",
    "build_verification_receipt",
    "write_receipt",
]

RECEIPT_SCHEMA_VERSION = 1


def build_run_receipt(
    subject: SubjectUnderTest,
    scenarios: Sequence[Scenario],
    report: RunReport,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "schema_version": RECEIPT_SCHEMA_VERSION,
        "kind": "run",
        "tool": _tool_versions(),
        "subject": subject.name,
        "contract": _contract_hashes(subject),
        "catalogue_sha256": _catalogue_hash(scenarios),
        "evidence": _evidence_provenance(report),
        "summary": _run_summary(report),
        "results": _bounded_results(report),
    }
    return _address(body)


def build_verification_receipt(
    verification: Verification,
    scenarios: Sequence[Scenario],
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "schema_version": RECEIPT_SCHEMA_VERSION,
        "kind": "verification",
        "tool": _tool_versions(),
        "subject": verification.patch.before.name,
        "contract": {
            "before": _contract_hashes(verification.patch.before),
            "after": _contract_hashes(verification.patch.after),
        },
        "catalogue_sha256": _catalogue_hash(scenarios),
        "evidence": _evidence_provenance(verification.after),
        "delta": {
            "closed": list(verification.closed),
            "still_failing": list(verification.still_failing),
            "regressions": list(verification.regressions),
            "benign_total": verification.benign_total,
            "benign_regressions": list(verification.benign_regressions),
            "benign_repaired": list(verification.benign_repaired),
        },
        "before": _run_summary(verification.before),
        "after": _run_summary(verification.after),
    }
    return _address(body)


def write_receipt(payload: Mapping[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return path


def _contract_hashes(subject: SubjectUnderTest) -> dict[str, str]:
    return {
        "task_sha256": _hash_text(subject.goal),
        "result_schema_sha256": _hash_json(subject.result_schema),
        "recipient_result_schema_sha256": _hash_json(subject.recipient_result_schema),
        "context_sha256": _hash_json(dict(subject.context)),
        "data_policy_sha256": _hash_json(subject.data_policy.to_dict()),
    }


def _catalogue_hash(scenarios: Sequence[Scenario]) -> str:
    payload: list[dict[str, Any]] = []
    for scenario in sorted(scenarios, key=lambda item: item.id):
        item = asdict(scenario)
        item.pop("source_path", None)
        payload.append(item)
    return _hash_json(payload)


def _evidence_provenance(report: RunReport) -> dict[str, Any]:
    level = {
        "static": "declared_policy_model",
        "replay": "recorded_calle_payload",
        "live": "observed_call_with_operator_attestation",
    }.get(report.transport, "unknown")
    return {
        "transport": report.transport,
        "level": level,
        "ground_truth_declared_by": sorted(
            {result.record.ground_truth.declared_by for result in report.results}
        ),
        "real_calls_placed": report.real_calls_placed,
    }


def _run_summary(report: RunReport) -> dict[str, int]:
    return {
        "total": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "skipped": report.skipped,
        "critical_failures": len(report.critical_failures),
    }


def _bounded_results(report: RunReport) -> list[dict[str, Any]]:
    return [
        {
            "scenario_id": result.scenario.id,
            "status": str(result.status),
            "checks": [
                {"name": outcome.name, "status": str(outcome.status)}
                for outcome in result.outcomes
            ],
        }
        for result in sorted(report.results, key=lambda item: item.scenario.id)
    ]


def _tool_versions() -> dict[str, str]:
    try:
        calle_version = version("calle-ai")
    except PackageNotFoundError:  # pragma: no cover - dependency is normally present
        calle_version = "not-installed"
    return {"redline": __version__, "calle_ai": calle_version}


def _address(body: dict[str, Any]) -> dict[str, Any]:
    return {**body, "receipt_id": f"sha256:{_hash_json(body)}"}


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_json(value: Any) -> str:
    canonical = json.dumps(
        _normalise(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return _hash_text(canonical)


def _normalise(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _normalise(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        items = [_normalise(item) for item in value]
        return sorted(
            items,
            key=lambda item: json.dumps(
                item,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
        )
    if isinstance(value, (list, tuple)):
        return [_normalise(item) for item in value]
    if isinstance(value, Path):
        return value.name
    return value
