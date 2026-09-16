"""One call, end to end: decide, plan, dial, verify, scrub, persist.

The order of operations matters more than any single step. A claim is marked
``pending_call`` and written to disk *before* the request leaves the machine, so
a process that dies mid-call leaves evidence that a call may exist. Nothing
redials a claim in that state; ``reconcile`` resolves it against CALL-E instead.

Scrubbing happens between verification and persistence. The verifier needs the
real transcript to check that a quote was actually spoken; the ledger must never
hold the identifiers in it. So the transcript is used, then scrubbed, then
stored.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence

from . import audit, authz, client as calle_client, hold as hold_mod, plan as plan_mod, policy, redact, vault, verify, workqueue
from .hold import CostModel
from .models import (
    ANSWERED,
    CLOSED,
    NEEDS_HUMAN,
    OUTCOME_ANSWERED,
    OUTCOME_NOT_ON_FILE,
    OUTCOME_PARTIAL,
    OUTCOME_UNUSABLE,
    PENDING_CALL,
    PENDING_RECONCILIATION,
    QUEUED,
    UNKNOWN,
    CallRecord,
    Claim,
    Ledger,
    new_id,
    now_iso,
    save_ledger,
)

MODE_PREVIEW = "preview"
MODE_FIXTURE = "fixture"
MODE_LIVE = "live"
MODES = (MODE_PREVIEW, MODE_FIXTURE, MODE_LIVE)

KILL_SWITCH_FILENAME = "KILL_SWITCH"
SUBMISSION_UNKNOWN = "submission_unknown"
UNRESOLVED_CALL_STATUSES = ("submitting", SUBMISSION_UNKNOWN, "in_progress")


class EngineError(RuntimeError):
    pass


@dataclass
class Config:
    max_hold_minutes: int = 25
    hold_budget_minutes: int = 240
    max_calls_per_run: int = 25
    max_share_of_claim: float = 0.25
    cost: CostModel = field(default_factory=CostModel)
    webhook_url: str = ""
    ignore_window: bool = False


@dataclass
class Context:
    data_dir: str
    ledger: Ledger
    config: Config = field(default_factory=Config)
    fixtures_dir: str = ""
    actor: str = "cli"

    def save(self) -> None:
        save_ledger(self.data_dir, self.ledger)


@dataclass
class RunOutcome:
    bundle: workqueue.Bundle
    plan: Optional[plan_mod.CallPlan] = None
    call: Optional[CallRecord] = None
    suppressed: List[str] = field(default_factory=list)
    hold_profile: Optional[hold_mod.HoldProfile] = None

    @property
    def placed(self) -> bool:
        return self.call is not None and bool(self.call.calle_call_id)


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------

def kill_switch_path(data_dir: str) -> str:
    return os.path.join(data_dir, KILL_SWITCH_FILENAME)


def kill_switch_engaged(data_dir: str) -> bool:
    return os.path.exists(kill_switch_path(data_dir))


def local_now(tz_name: str) -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(tz_name))
    except Exception:
        return datetime.now(timezone.utc)


def suppression_for(
    ctx: Context,
    bundle: workqueue.Bundle,
    mode: str,
    *,
    today: Optional[date] = None,
) -> List[str]:
    """Every named reason this bundle may not be called right now."""
    reasons: List[str] = []
    payer = ctx.ledger.payer(bundle.payer_id)

    if mode == MODE_LIVE and any(
        record.mode == MODE_LIVE and record.status in UNRESOLVED_CALL_STATUSES
        for record in ctx.ledger.calls
    ):
        reasons.append("pending_reconciliation")

    if kill_switch_engaged(ctx.data_dir):
        reasons.append("kill_switch")

    for claim in bundle.claims:
        if claim.state != QUEUED:
            reasons.append("claim_not_queued")
            break

    for claim in bundle.claims:
        if claim.state == PENDING_RECONCILIATION:
            reasons.append("pending_reconciliation")
            break

    for claim in bundle.claims:
        if policy.days_until(claim.filing_deadline, today) <= 0:
            reasons.append("filing_deadline_passed")
            break

    for claim in bundle.claims:
        if not vault.exists(ctx.data_dir, claim.patient_ref):
            reasons.append("no_vault_record")
            break

    if not ctx.config.ignore_window:
        if not policy.within_window(local_now(payer.timezone), payer.call_window):
            reasons.append("outside_call_window")

    budget_used_minutes = ctx.ledger.hold_seconds_used / 60.0
    if budget_used_minutes >= ctx.config.hold_budget_minutes:
        reasons.append("hold_budget_exhausted")

    if ctx.ledger.calls_placed >= ctx.config.max_calls_per_run:
        reasons.append("daily_call_cap")

    projected = ctx.config.cost.projected()
    if hold_mod.cost_cap_exceeded(
        claim_value_usd=bundle.total_value,
        projected_cost_usd=projected,
        max_share_of_claim=ctx.config.max_share_of_claim,
    ):
        reasons.append("cost_cap_exceeded")

    if mode == MODE_LIVE:
        record = authz.load(ctx.data_dir, payer.id)
        reason = authz.check(record, phone=payer.phone, today=today)
        if reason:
            reasons.append(reason)

    seen: List[str] = []
    for reason in reasons:
        if reason not in seen:
            seen.append(reason)
    return seen


# ---------------------------------------------------------------------------
# Running a bundle
# ---------------------------------------------------------------------------

def run_bundle(
    ctx: Context,
    bundle: workqueue.Bundle,
    *,
    mode: str = MODE_FIXTURE,
    api_key: str = "",
    base_url: str = calle_client.OFFICIAL_ORIGIN,
    fixture_scenario: Optional[str] = None,
    today: Optional[date] = None,
    sleep: Callable[[float], None] = time.sleep,
    first_poll_delay: Optional[float] = None,
) -> RunOutcome:
    if mode not in MODES:
        raise EngineError("mode must be one of: %s" % ", ".join(MODES))

    payer = ctx.ledger.payer(bundle.payer_id)
    practice = ctx.ledger.practice(bundle.claims[0].practice_id)

    reasons = suppression_for(ctx, bundle, mode, today=today)
    if reasons:
        return RunOutcome(bundle=bundle, suppressed=reasons)

    idempotency_key = "trunkline_%s" % new_id("call").split("_", 1)[1]
    plan = plan_mod.build_plan(
        workflow_name=bundle.workflow,
        practice=practice,
        payer=payer,
        claims=bundle.claims,
        data_dir=ctx.data_dir,
        idempotency_key=idempotency_key,
        max_hold_minutes=ctx.config.max_hold_minutes,
        projected_cost_usd=ctx.config.cost.projected(),
        webhook_url=ctx.config.webhook_url or None,
        fixture_scenario=fixture_scenario if mode == MODE_FIXTURE else None,
    )

    if mode == MODE_PREVIEW:
        return RunOutcome(bundle=bundle, plan=plan)

    record = CallRecord(
        id=new_id("tlcall"),
        practice_id=practice.id,
        payer_id=payer.id,
        workflow=bundle.workflow,
        claim_ids=bundle.claim_ids,
        mode=mode,
        status="submitting",
        idempotency_key=idempotency_key,
    )
    ctx.ledger.calls.append(record)
    for claim in bundle.claims:
        claim.state = PENDING_CALL
        claim.call_ids.append(record.id)
        claim.updated_at = now_iso()
    ctx.save()

    audit.record(
        ctx.data_dir,
        actor=ctx.actor,
        action="call.planned",
        subject=record.id,
        detail={
            "mode": mode,
            "workflow": bundle.workflow,
            "payer_id": payer.id,
            "destination": policy.mask_phone(payer.phone),
            "claims": bundle.claim_ids,
            "disclosed_fields": plan.disclosed_fields,
            "projected_cost_usd": plan.projected_cost_usd,
        },
    )

    api = calle_client.CalleClient(
        api_key=api_key,
        base_url=base_url,
        allow_local_fake=(mode == MODE_FIXTURE),
    )

    try:
        created = api.create_call(plan.request, idempotency_key)
    except calle_client.CalleError:
        for claim in bundle.claims:
            claim.state = PENDING_RECONCILIATION
            claim.updated_at = now_iso()
        record.status = SUBMISSION_UNKNOWN
        record.outcome = UNKNOWN
        ctx.save()
        audit.record(
            ctx.data_dir, actor=ctx.actor, action="call.submission_unknown",
            subject=record.id, detail={"mode": mode},
        )
        raise calle_client.CalleError(
            "CALL-E submission outcome is unknown; reconcile local call %s before another live call"
            % record.id
        ) from None

    record.calle_call_id = str(created.get("id", "")).strip()
    if not record.calle_call_id:
        for claim in bundle.claims:
            claim.state = PENDING_RECONCILIATION
            claim.updated_at = now_iso()
        record.status = SUBMISSION_UNKNOWN
        record.outcome = UNKNOWN
        ctx.save()
        audit.record(
            ctx.data_dir, actor=ctx.actor, action="call.submission_unknown",
            subject=record.id, detail={"mode": mode},
        )
        raise calle_client.CalleError(
            "CALL-E submission outcome is unknown; reconcile local call %s before another live call"
            % record.id
        )
    record.status = "in_progress"
    ctx.ledger.calls_placed += 1
    for claim in bundle.claims:
        claim.state = PENDING_RECONCILIATION
        claim.updated_at = now_iso()
    ctx.save()
    audit.record(
        ctx.data_dir,
        actor=ctx.actor,
        action="call.placed",
        subject=record.id,
        detail={"calle_call_id": record.calle_call_id, "mode": mode},
    )

    delay = first_poll_delay
    if delay is None:
        delay = 0.0 if mode == MODE_FIXTURE else calle_client.FIRST_POLL_DELAY_SECONDS
    payload = api.wait(
        record.calle_call_id,
        first_delay=delay,
        poll_seconds=0.0 if mode == MODE_FIXTURE else calle_client.POLL_INTERVAL_SECONDS,
        sleep=sleep,
    )

    profile = ingest_terminal(ctx, record, payload)
    return RunOutcome(bundle=bundle, plan=plan, call=record, hold_profile=profile)


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def ingest_terminal(ctx: Context, record: CallRecord, payload: Dict[str, Any]) -> hold_mod.HoldProfile:
    """Verify, scrub, then persist. Shared by polling and by webhook delivery."""
    claims = [ctx.ledger.claim(cid) for cid in record.claim_ids]

    turns = hold_mod.transcript_turns(payload)
    profile = hold_mod.derive(turns)
    verified = verify.verify(payload, record.workflow, claims, turns)

    secrets: List[str] = []
    for claim in claims:
        secrets.extend(vault.all_secrets_for(ctx.data_dir, claim.patient_ref))
    patterns = redact.build_patterns(secrets)
    payer = ctx.ledger.payer(record.payer_id)
    phone_patterns = redact.build_phone_patterns([payer.phone])

    record.status = str(payload.get("status", "completed"))
    record.outcome = verified.outcome
    record.hold_seconds = profile.hold_seconds
    record.talk_seconds = profile.talk_seconds
    record.total_seconds = profile.total_seconds
    record.cost_estimate_usd = ctx.config.cost.estimate(profile.total_seconds / 60.0)
    record.reference_number = redact.scrub_text(verified.reference_number, patterns, phone_patterns)
    record.rep_name = redact.scrub_text(verified.representative_name, patterns, phone_patterns)
    record.confidence = redact.scrub_value(
        payload.get("completion_confidence") or {}, patterns, phone_patterns,
    )
    record.per_claim = redact.scrub_value(verified.per_claim, patterns, phone_patterns)
    record.findings = [
        redact.scrub_text(item, patterns, phone_patterns) for item in verified.findings
    ]
    record.transcript = redact.scrub_transcript(turns, patterns, phone_patterns)
    record.summary = redact.scrub_text(
        str(payload.get("summary") or ""), patterns, phone_patterns,
    )
    record.completed_at = now_iso()

    ctx.ledger.hold_seconds_used += profile.hold_seconds

    for claim in claims:
        fields = record.per_claim.get(claim.id, {})
        claim.result = fields
        claim.updated_at = now_iso()
        if verified.outcome in (OUTCOME_ANSWERED, OUTCOME_NOT_ON_FILE) and fields.get("_grounded"):
            claim.state = ANSWERED
        elif verified.outcome == OUTCOME_PARTIAL and fields.get("_grounded"):
            claim.state = ANSWERED
        elif verified.outcome in (OUTCOME_UNUSABLE,):
            claim.state = NEEDS_HUMAN
        else:
            claim.state = NEEDS_HUMAN
        if claim.workflow == "denial_reason" and fields.get("carc_code") not in (None, "", UNKNOWN):
            claim.denial_code = str(fields.get("carc_code"))

    ctx.save()
    audit.record(
        ctx.data_dir,
        actor=ctx.actor,
        action="call.completed",
        subject=record.id,
        detail={
            "outcome": record.outcome,
            "hold_seconds": record.hold_seconds,
            "total_seconds": record.total_seconds,
            "grounded_claims": verified.grounded_claims,
            "ungrounded_claims": verified.ungrounded_claims,
            "cost_estimate_usd": record.cost_estimate_usd,
        },
    )
    return profile


def reconcile(
    ctx: Context,
    record: CallRecord,
    *,
    api_key: str,
    base_url: str = calle_client.OFFICIAL_ORIGIN,
    allow_local_fake: bool = False,
    provider_call_id: str = "",
) -> Optional[hold_mod.HoldProfile]:
    """Resolve a call that was submitted but never folded back into the ledger."""
    api = calle_client.CalleClient(api_key=api_key, base_url=base_url, allow_local_fake=allow_local_fake)
    if provider_call_id and record.calle_call_id and provider_call_id != record.calle_call_id:
        raise EngineError("the supplied CALL-E id does not match the recorded call id")
    lookup_id = record.calle_call_id or provider_call_id
    if not lookup_id:
        raise EngineError(
            "call %s has an unknown submission outcome; attach the id from CALL-E with "
            "`trunkline reconcile --call %s --provider-call-id <id>`, or use --clear only "
            "after confirming that no call exists" % (record.id, record.id)
        )
    payload = api.get_call(lookup_id)
    if not record.calle_call_id:
        record.calle_call_id = lookup_id
        record.status = "in_progress"
        ctx.ledger.calls_placed += 1
        ctx.save()
        audit.record(
            ctx.data_dir, actor=ctx.actor, action="call.provider_id_attached",
            subject=record.id, detail={"calle_call_id": lookup_id},
        )
    status = str(payload.get("status", "")).lower()
    if status not in calle_client.TERMINAL_STATUSES:
        return None
    return ingest_terminal(ctx, record, payload)


def clear_pending(ctx: Context, record: CallRecord) -> None:
    """Operator asserts no call exists at the provider; return claims to the queue."""
    for claim_id in record.claim_ids:
        claim = ctx.ledger.claim(claim_id)
        if claim.state in (PENDING_CALL, PENDING_RECONCILIATION):
            claim.state = QUEUED
            claim.updated_at = now_iso()
    record.status = "cleared"
    record.outcome = record.outcome or "cleared"
    ctx.save()
    audit.record(ctx.data_dir, actor=ctx.actor, action="call.cleared", subject=record.id, detail={})


def approve(ctx: Context, claim: Claim, note: str = "") -> None:
    """Human sign-off. Nothing leaves Trunkline until this happens."""
    if claim.state != ANSWERED:
        raise EngineError("claim %s is %s; only answered claims can be approved" % (claim.id, claim.state))
    claim.state = CLOSED
    claim.review_note = note
    claim.updated_at = now_iso()
    ctx.save()
    audit.record(
        ctx.data_dir, actor=ctx.actor, action="claim.approved", subject=claim.id, detail={"note": note}
    )
