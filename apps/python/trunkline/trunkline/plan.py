"""Build the CALL-E task for one bundle of claims against one payer line.

The plan is assembled from four separate sources and nothing else:

* the practice's own billing identifiers,
* the payer record, including any IVR path learned on an earlier call,
* the claims in the bundle,
* one ``Disclosure`` per patient, already narrowed to the workflow's envelope.

Before the plan is returned it is checked against the vault a second time: if any
value of a field on ``policy.NEVER_DISCLOSE`` appears anywhere in the task text,
the plan is refused. The envelope should already make that impossible; this is
the check that proves it on every single call.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from . import policy, redact, vault, workflows
from .models import Claim, Payer, Practice


@dataclass
class CallPlan:
    workflow: str
    practice_id: str
    payer_id: str
    claim_ids: List[str]
    task_text: str
    request: Dict[str, Any]
    idempotency_key: str
    disclosed_fields: Dict[str, List[str]] = field(default_factory=dict)
    projected_cost_usd: float = 0.0

    def redacted_request(self) -> Dict[str, Any]:
        """A copy of the request safe to print or store: no task text, no numbers."""
        recipients = []
        for item in self.request.get("recipients", []):
            entry = dict(item)
            entry["phones"] = [policy.mask_phone(p) for p in entry.get("phones", [])]
            recipients.append(entry)
        return {
            "task": "<%d characters, withheld: contains patient identifiers>" % len(self.task_text),
            "recipients": recipients,
            "result_schema": self.request.get("result_schema"),
            "metadata": self.request.get("metadata"),
        }


class PlanError(RuntimeError):
    pass


def _claim_block(index: int, claim: Claim, disclosure: vault.Disclosure) -> str:
    lines = ["Claim %d of this call:" % index]
    lines.append("  claim number: %s" % claim.claim_number)
    lines.append("  date of service: %s" % claim.date_of_service)
    if claim.procedure_code:
        lines.append("  procedure code: %s" % claim.procedure_code)
    for name in sorted(disclosure.values):
        label = name.replace("_", " ")
        lines.append("  %s: %s" % (label, disclosure.values[name]))
    return "\n".join(lines)


def _ivr_block(payer: Payer, practice: Practice) -> str:
    lines = [
        "Reaching a representative:",
        "  This is a health plan provider-services line. Work through the phone menu to reach a "
        "live claims representative. Use the keypad when the menu asks for entries.",
        "  If the menu asks for the provider NPI, enter %s." % practice.npi,
        "  If the menu asks whether you are a provider, answer that you are calling for a provider "
        "billing office.",
        "  Do not choose any option that ends the call in an automated self-service answer if a "
        "representative is offered.",
    ]
    if payer.ivr_path:
        lines.append(
            "  A previous call reached a representative with this menu path: %s. Try it first, and "
            "adapt if the menu has changed." % " then ".join(payer.ivr_path)
        )
    return "\n".join(lines)


def _hold_block(max_hold_minutes: int) -> str:
    return "\n".join([
        "Waiting on hold:",
        "  Hold time is expected and acceptable. Stay on the line.",
        "  Do not speak while hold music or a recorded message is playing. Wait silently until a "
        "person speaks to you.",
        "  If the menu or a recording announces an estimated wait longer than %d minutes, stay on "
        "the line anyway unless the total wait passes the limit below." % max_hold_minutes,
        "  If the total time on hold passes %d minutes, thank whoever is available, end the call, "
        "and report call_outcome as hold_timeout." % max_hold_minutes,
        "  If you are transferred, you may land in a second queue. The limit above covers all hold "
        "time on this call added together.",
    ])


def build_plan(
    *,
    workflow_name: str,
    practice: Practice,
    payer: Payer,
    claims: Sequence[Claim],
    data_dir: str,
    idempotency_key: str,
    max_hold_minutes: int = 25,
    projected_cost_usd: float = 0.0,
    webhook_url: Optional[str] = None,
    fixture_scenario: Optional[str] = None,
) -> CallPlan:
    if not claims:
        raise PlanError("a call plan needs at least one claim")
    workflow = workflows.get(workflow_name)
    for claim in claims:
        if claim.workflow != workflow_name:
            raise PlanError("claim %s is workflow %r, not %r" % (claim.id, claim.workflow, workflow_name))
        if claim.payer_id != payer.id:
            raise PlanError("claim %s does not belong to payer %s" % (claim.id, payer.id))
    if len(claims) > payer.claims_per_call_cap:
        raise PlanError(
            "%d claims exceeds the %s cap of %d per call"
            % (len(claims), payer.name, payer.claims_per_call_cap)
        )

    policy.validate_destination(payer.phone, payer.region)

    disclosures = {
        claim.id: vault.resolve_envelope(data_dir, claim.patient_ref, workflow_name) for claim in claims
    }

    header = [
        "You are calling %s on behalf of the billing office of %s, a medical practice."
        % (payer.name, practice.name),
        "Provider NPI %s. Tax ID ending %s." % (practice.npi, practice.tin_last4),
        "",
        "Goal: %s" % workflow.purpose,
        "",
        "For each claim listed below, ask the representative for:",
    ]
    header.extend("  - %s" % item for item in workflow.ask)

    body = [
        "",
        _ivr_block(payer, practice),
        "",
        _hold_block(max_hold_minutes),
        "",
        "Once a representative is on the line:",
        "  Identify the practice and give the provider NPI. Give the patient identifiers listed "
        "with each claim when the representative asks to verify them. Representatives often ask "
        "again after a transfer; give them again without being asked twice.",
        "  Work through the claims one at a time, in the order listed.",
        "  Repeat each claim number back so the record is unambiguous.",
        "  Before ending, ask for the call reference number and the representative's first name.",
        "",
    ]
    for index, claim in enumerate(claims, start=1):
        body.append(_claim_block(index, claim, disclosures[claim.id]))
        body.append("")

    footer = [
        "Rules you must follow for the whole call:",
        policy.boundaries_block(),
        "",
        "Reporting:",
        "  Return one entry in claims for every claim listed above, keyed by its claim number.",
        '  Any value the representative did not state clearly must be reported as "unknown". '
        "Do not infer, round, or fill in a value from context.",
        "  For each claim, put the representative's own words that support your answer in "
        "evidence_quote, quoted exactly as spoken.",
    ]

    task_text = "\n".join(header + body + footer)

    _assert_no_forbidden_disclosure(task_text, data_dir, [claim.patient_ref for claim in claims])

    metadata: Dict[str, Any] = {
        "workflow": workflow_name,
        "payer_id": payer.id,
        "practice_id": practice.id,
        "claim_ids": [claim.id for claim in claims],
        "idempotency_key": idempotency_key,
    }
    if fixture_scenario:
        metadata["fixture_scenario"] = fixture_scenario

    request: Dict[str, Any] = {
        "task": task_text,
        "recipients": [{"phones": [payer.phone], "region": payer.region, "locale": payer.locale}],
        "result_schema": workflow.schema,
        "metadata": metadata,
    }
    if webhook_url:
        request["webhook_url"] = webhook_url

    return CallPlan(
        workflow=workflow_name,
        practice_id=practice.id,
        payer_id=payer.id,
        claim_ids=[claim.id for claim in claims],
        task_text=task_text,
        request=request,
        idempotency_key=idempotency_key,
        disclosed_fields={claim.id: disclosures[claim.id].fields_disclosed for claim in claims},
        projected_cost_usd=projected_cost_usd,
    )


def _assert_no_forbidden_disclosure(task_text: str, data_dir: str, patient_refs: Sequence[str]) -> None:
    """Refuse to return a plan whose text carries a never-disclose identifier.

    This uses the same word-boundary matcher as the redactor rather than a plain
    substring search. A four-digit Social Security fragment lives inside plenty
    of unrelated claim numbers, and a guard that blocks every such call is a
    guard an operator will switch off.
    """
    for patient_ref in set(patient_refs):
        record = vault.get(data_dir, patient_ref) or {}
        for name in policy.NEVER_DISCLOSE:
            value = str(record.get(name, "")).strip()
            if value and redact.contains_any(task_text, [value]):
                raise PlanError(
                    "refusing to send a task containing the never-disclose field %r for %s"
                    % (name, patient_ref)
                )


def plan_preview(plan: CallPlan) -> str:
    """Operator-facing preview. Prints the task, since the operator owns this data."""
    return "\n".join([
        "workflow:        %s" % plan.workflow,
        "payer:           %s" % plan.payer_id,
        "claims:          %s" % ", ".join(plan.claim_ids),
        "disclosed fields: %s" % json.dumps(plan.disclosed_fields, sort_keys=True),
        "projected cost:  $%.2f" % plan.projected_cost_usd,
        "idempotency key: %s" % plan.idempotency_key,
        "",
        "--- task text sent to CALL-E ---",
        plan.task_text,
    ])
