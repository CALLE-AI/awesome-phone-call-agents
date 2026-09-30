"""Place one notification call and capture what it established.

The order is fixed and matters: build the script, prove it stays inside the
disclosure budget, build the schema, place the call, wait, extract, grade. The
grade is computed from what came back and from what was already on file for
that institution, never from the model's opinion of either.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import calle, capture as capture_mod, extract, schema, task
from .models import CaptureResult, Estate, Institution, PriorCall


@dataclass(frozen=True)
class Plan:
    """Everything a call would do, before anything is dialled."""

    estate: Estate
    institution: Institution
    task_text: str
    result_schema: dict[str, Any]
    idempotency_key: str

    def masked_phone(self) -> str:
        """Never print a full number in a preview or a log."""
        return self.institution.masked_phone()


def plan_call(estate: Estate, institution: Institution) -> Plan:
    """Build the whole call without placing it. This is the dry-run product."""
    return Plan(
        estate=estate,
        institution=institution,
        task_text=task.build_task(estate, institution),
        result_schema=schema.result_schema(),
        # Derived from the estate and the institution, never from the attempt,
        # so a retried run reuses the key instead of ringing the bereavement
        # team a second time.
        idempotency_key=f"afterword_{estate.estate_id}_{institution.institution_id}",
    )


def payload_for(plan: Plan) -> dict[str, Any]:
    """The exact body sent to POST /v1/calls."""
    return {
        "task": plan.task_text,
        "recipients": [{"phones": [plan.institution.phone_e164]}],
        "result_schema": plan.result_schema,
        "metadata": {
            "afterword_estate_id": plan.estate.estate_id,
            "afterword_institution_id": plan.institution.institution_id,
        },
    }


def run_institution(
    estate: Estate,
    institution: Institution,
    priors: tuple[PriorCall, ...] = (),
    client: calle.Client | None = None,
    timeout_seconds: float = 300.0,
    plan: Plan | None = None,
) -> tuple[Plan, CaptureResult]:
    """Place one call to one institution and capture the requirement.

    Defaults to `DryRunClient`, which places no call. `plan` may be supplied
    when it was built earlier, so a caller can script a demo response against
    the script that was actually composed.
    """
    transport = client or calle.DryRunClient()
    plan = plan or plan_call(estate, institution)
    created = transport.create_call(payload_for(plan), plan.idempotency_key)
    call_id = created.get("id", "")

    try:
        completed = calle.wait_for_result(
            transport, call_id, timeout_seconds=timeout_seconds
        )
    except calle.CalleError:
        # An unresolved call established nothing. It is not a refusal and it is
        # not an answer.
        completed = {"id": call_id, "status": "unknown", "structured_result": None}

    observed = extract.observations(completed)
    result = capture_mod.capture(
        estate=estate,
        institution=institution,
        observed=observed,
        run_id=plan.idempotency_key,
        priors=priors,
        call_id=call_id or None,
    )
    return plan, result
