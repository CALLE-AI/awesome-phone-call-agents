from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .calle_client import CalleHTTPClient
from .evidence import classify_failure, verify_outcome
from .models import Evidence, RecoveryResult, RecoveryTask
from .safety import assert_safe_live_task, mask_phone, require_explicit_approval

PARTY = {
    "claim_status": "claims_department",
    "billing": "billing_contact",
    "renewal": "renewal_contact",
    "policy_service": "servicing_contact",
}

class RecoveryStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text())

    def get(self, recovery_id: str) -> dict[str, Any] | None:
        return self._read().get(recovery_id)

    def put(self, result: RecoveryResult) -> None:
        data = self._read()
        data[result.recovery_id] = result.to_dict()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2))

def recovery_id_for(task: RecoveryTask) -> str:
    raw = "|".join([
        task.task_type,
        task.destination,
        task.policy_or_claim_reference or "",
        task.task_description.strip(),
    ])
    return "irc_" + hashlib.sha256(raw.encode()).hexdigest()[:12]

def preview(task: RecoveryTask, recovery_id: str, mode: str) -> str:
    party = PARTY.get(task.task_type, "human clarification")
    return (
        f"Task: {task.task_description}\n"
        f"Intent: {task.task_type}\n"
        f"Party: {party}\n"
        f"Destination: {mask_phone(task.destination)}\n"
        f"Intended outcome: {task.intended_outcome}\n"
        f"Mode: {mode}\n"
        f"Recovery ID: {recovery_id}"
    )

def dry_run(task: RecoveryTask, recovery_id: str, fixture_transcript: str) -> RecoveryResult:
    if task.task_type == "ambiguous":
        return RecoveryResult(
            recovery_id=recovery_id,
            status="human_escalation_required",
            intent=task.task_type,
            task=task.task_description,
            party_contacted="unknown",
            evidence=Evidence("fixture", False),
            confidence="low",
            human_escalation_required=True,
            mode="dry_run",
            reason="intent requires human clarification",
        )

    ok, outcome, reason = verify_outcome(task.task_type, fixture_transcript)
    if ok:
        result = RecoveryResult(
            recovery_id=recovery_id,
            status="recovered",
            intent=task.task_type,
            task=task.task_description,
            party_contacted=PARTY[task.task_type],
            outcome=outcome,
            evidence=Evidence("phone_call", True),
            confidence="high",
            human_escalation_required=False,
            mode="dry_run",
        )
    else:
        status, escalate, failure_reason = classify_failure("completed", None, fixture_transcript)
        if reason in {"renewal decision is ambiguous", "claim status not sufficiently verified",
                      "billing resolution not sufficiently verified", "policy-service outcome not sufficiently verified"}:
            status = "ambiguous"
            failure_reason = reason
        result = RecoveryResult(
            recovery_id=recovery_id,
            status=status,
            intent=task.task_type,
            task=task.task_description,
            party_contacted=PARTY[task.task_type],
            outcome=outcome,
            evidence=Evidence("phone_call", False),
            confidence="low",
            human_escalation_required=escalate,
            mode="dry_run",
            reason=failure_reason,
        )
    return result

def live_recovery(
    task: RecoveryTask,
    client: CalleHTTPClient,
    store: RecoveryStore,
    approved: bool,
) -> RecoveryResult:
    assert_safe_live_task(task)
    require_explicit_approval(approved)

    rid = recovery_id_for(task)
    existing = store.get(rid)
    if existing and existing.get("status") in {
        "recovered", "partially_recovered", "no_answer", "refused"
    }:
        return RecoveryResult(**existing, evidence=Evidence(**existing["evidence"]))

    schema = {
        "status": "recovered|partially_recovered|no_answer|refused|ambiguous|human_escalation_required",
        "intent": task.task_type,
        "outcome": "only transcript-supported fields",
        "evidence": {"source": "phone_call", "verified": "boolean"},
        "confidence": "high|medium|low",
        "human_escalation_required": "boolean",
    }

    planned_id = client.plan_call(task.task_description, task.destination, schema)
    # A provider may assign a different plan identifier. Preserve the returned identifier.
    client.run_call(planned_id)
    run = client.get_call_run(planned_id)

    if run.status.lower() not in {"completed", "complete", "succeeded", "success"}:
        status, escalate, reason = classify_failure(run.status, run.failure_code, run.transcript)
        result = RecoveryResult(
            recovery_id=planned_id,
            status=status,
            intent=task.task_type,
            task=task.task_description,
            party_contacted=PARTY[task.task_type],
            evidence=Evidence("phone_call", False),
            confidence="low",
            human_escalation_required=escalate,
            reason=reason,
        )
        store.put(result)
        return result

    ok, outcome, reason = verify_outcome(task.task_type, run.transcript)
    if ok:
        result = RecoveryResult(
            recovery_id=planned_id,
            status="recovered",
            intent=task.task_type,
            task=task.task_description,
            party_contacted=PARTY[task.task_type],
            outcome=outcome,
            evidence=Evidence("phone_call", True),
            confidence="high",
            human_escalation_required=False,
        )
    else:
        result = RecoveryResult(
            recovery_id=planned_id,
            status="ambiguous",
            intent=task.task_type,
            task=task.task_description,
            party_contacted=PARTY[task.task_type],
            outcome=outcome,
            evidence=Evidence("phone_call", False),
            confidence="low",
            human_escalation_required=True,
            reason=reason,
        )
    store.put(result)
    return result
