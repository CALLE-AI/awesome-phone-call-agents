"""Run one attestation cycle.

The order is fixed and matters: mint the nonce, choose the prompts, build the
call, place it, wait, extract, grade. The grade is computed from the enrolment
record and the issued challenge, so a call cannot be graded against anything
other than what was actually asked.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from . import calle, extract, grading, nonce as nonce_mod, schema, task
from .models import Attestation, KnowledgePrompt, Nonce, Subject

#: How many enrolled prompts one call asks. Two keeps the call short for an
#: elderly caller while leaving the set unpredictable across cycles.
PROMPTS_PER_CALL = 2


@dataclass(frozen=True)
class Plan:
    """Everything a call would do, before anything is dialled."""

    subject: Subject
    cycle: str
    issued_nonce: Nonce
    prompts: tuple[KnowledgePrompt, ...]
    task_text: str
    result_schema: dict[str, Any]
    idempotency_key: str

    def masked_phone(self) -> str:
        """Never print a full number in a preview or a log."""
        tail = self.subject.phone_e164[-3:]
        return f"{self.subject.phone_e164[:4]}{'*' * 6}{tail}"


def choose_prompts(
    subject: Subject, cycle: str, count: int = PROMPTS_PER_CALL
) -> tuple[KnowledgePrompt, ...]:
    """Pick prompts deterministically per cycle, unpredictably across cycles.

    Seeding on subject and cycle means a retried run asks the same questions,
    so a retry cannot be used to fish for an easier set.
    """
    if not subject.prompts:
        return ()
    seed = f"{subject.subject_id}:{cycle}"
    picker = random.Random(hashlib.sha256(seed.encode()).hexdigest())
    pool = list(subject.prompts)
    # A co-resident-safe prompt is required for CONFIRMED_LIVE, so make sure one
    # is offered whenever the enrolment has any.
    safe = [p for p in pool if p.co_resident_safe]
    chosen: list[KnowledgePrompt] = []
    if safe:
        chosen.append(picker.choice(safe))
    remaining = [p for p in pool if p not in chosen]
    picker.shuffle(remaining)
    chosen.extend(remaining[: max(0, count - len(chosen))])
    return tuple(chosen)


def plan_call(
    subject: Subject,
    cycle: str,
    scheme_name: str,
    when: date | None = None,
    rng: random.Random | None = None,
) -> Plan:
    """Build the whole call without placing it. This is the dry-run product."""
    day = when or datetime.now(timezone.utc).date()
    issued = nonce_mod.mint(day, rng=rng)
    prompts = choose_prompts(subject, cycle)
    return Plan(
        subject=subject,
        cycle=cycle,
        issued_nonce=issued,
        prompts=prompts,
        task_text=task.build_task(subject, issued, prompts, scheme_name),
        result_schema=schema.result_schema(prompts),
        # Derived from the authorisation (subject + cycle), never from the
        # attempt, so a retry reuses the key instead of dialling again.
        idempotency_key=f"muster_{subject.subject_id}_{cycle}",
    )


def payload_for(plan: Plan) -> dict[str, Any]:
    """The exact body sent to POST /v1/calls."""
    return {
        "task": plan.task_text,
        "recipients": [{"phones": [plan.subject.phone_e164]}],
        "result_schema": plan.result_schema,
        "metadata": {
            "muster_subject_id": plan.subject.subject_id,
            "muster_cycle": plan.cycle,
        },
    }


def run_cycle(
    subject: Subject,
    cycle: str,
    scheme_name: str,
    client: calle.Client | None = None,
    when: date | None = None,
    rng: random.Random | None = None,
    timeout_seconds: float = 300.0,
    plan: Plan | None = None,
) -> tuple[Plan, Attestation]:
    """Place one attestation call and grade it.

    Defaults to `DryRunClient`, which places no call. `plan` may be supplied
    when it was built earlier, so a caller can script a demo response against
    the freshness challenge that was actually issued.
    """
    transport = client or calle.DryRunClient()
    plan = plan or plan_call(subject, cycle, scheme_name, when=when, rng=rng)
    created = transport.create_call(payload_for(plan), plan.idempotency_key)
    call_id = created.get("id", "")

    try:
        completed = calle.wait_for_result(
            transport, call_id, timeout_seconds=timeout_seconds
        )
    except calle.CalleError:
        # An unresolved outcome is not a decline and not a failure to be alive.
        completed = {"id": call_id, "status": "unknown", "structured_result": None}

    observed = extract.observations(completed, plan.prompts)
    attestation = grading.grade(
        subject=subject,
        observed=observed,
        issued_nonce=plan.issued_nonce,
        asked_prompts=plan.prompts,
        run_id=plan.idempotency_key,
        call_id=call_id or None,
    )
    return plan, attestation
