"""The CALL-E adapter: one contract in, one call placed, one body of evidence out.

This is the only place in Callibrate that knows CALL-E exists. It does five
things and deliberately does not do a sixth.

1. Renders a Verification Contract into the goal CALL-E is given, including the
   disclosure, the readback rule, and the conditions under which CALL-E should
   stop the call.
2. Plans the call with `plan_call`, which never dials.
3. Starts it with `run_call`, after the call-eligibility gate upstream has
   already said yes.
4. Follows the run to a terminal status with `get_call_run`, persisting the
   `run_id` before the first poll so a restart resumes instead of redialling.
5. Normalises the transcript and hands it to the deterministic reader.

The sixth thing is business policy. This adapter never decides whether a record
may change. It cannot: it returns `CallEvidence`, and `CallEvidence` authorises
nothing.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from callibrate.calling.base import VerificationCaller
from callibrate.calling.mcp import TERMINAL_STATUSES, CalleError, CalleMcpClient, redact
from callibrate.calling.models import CallError, CallEvidence, CallOutcome
from callibrate.contracts.models import VerificationContract
from callibrate.evidence.reconcile import build_evidence
from callibrate.evidence.transcript import normalize_turns

#: CALL-E terminal statuses mapped onto what they mean for a record.
STATUS_OUTCOMES: dict[str, CallOutcome] = {
    "COMPLETED": CallOutcome.COMPLETED,
    "FAILED": CallOutcome.FAILED,
    "NO_ANSWER": CallOutcome.NO_ANSWER,
    "NO ANSWER": CallOutcome.NO_ANSWER,
    "DECLINED": CallOutcome.DECLINED,
    "CANCELED": CallOutcome.CANCELED,
    "CANCELLED": CallOutcome.CANCELED,
    "VOICEMAIL": CallOutcome.VOICEMAIL,
    "BUSY": CallOutcome.BUSY,
    "EXPIRED": CallOutcome.EXPIRED,
}

TRIGGER_SENTENCES = {
    "failed_referral": (
        "Somebody was sent to this service and reported that the information we publish was wrong."
    ),
    "user_report": "A member of the public told us this listing looks out of date.",
    "stale_record": "We have not confirmed this listing with anyone for a long time.",
    "manual_request": "Somebody asked us to confirm this listing before they travel to it.",
    "scheduled_reverify": "This listing is due for its scheduled confirmation.",
    "external_event": "An external signal suggested this listing may have changed.",
}


def render_call_goal(contract: VerificationContract) -> str:
    """The instruction CALL-E is given, built entirely from the contract.

    Written out in full and shown in the console, because an instruction nobody
    reads is an instruction nobody can audit. Every constraint in it traces to a
    field of the contract, so changing the policy changes the call rather than
    changing a paragraph somewhere else.
    """
    subject = contract.subject
    who = f"{subject.name}" + (f" at {subject.organization}" if subject.organization else "")
    lines: list[str] = []

    lines.append(
        f"You are calling {who} on behalf of a public community resource directory. "
        "Your only purpose is to confirm what the directory publishes about this service."
    )
    if contract.call_constraints.disclosure_required:
        lines.append(
            "Say in your first sentence that you are an automated assistant calling on behalf of "
            "the directory. Do this before you ask anything."
        )
    lines.append(TRIGGER_SENTENCES.get(contract.trigger.type.value, ""))
    if contract.trigger.message:
        lines.append(f'What was reported: "{contract.trigger.message}"')

    lines.append("")
    lines.append("Establish these, and only these:")
    for field in contract.fields_to_verify:
        known = contract.known_value(field)
        label = contract.field_label(field)
        if known:
            lines.append(f'- {label}. The directory currently publishes: "{known}". Ask whether that is still right.')
        else:
            lines.append(f"- {label}. The directory holds nothing for this. Ask what it should say.")

    lines.append("")
    lines.append("How to record an answer:")
    lines.append(
        "- If the person says a value has changed, say the WHOLE new value back to them in plain "
        "words and ask them to confirm it before you move on. For opening hours say the day and "
        "both times. Do not shorten it."
    )
    lines.append("- If they confirm without correcting you, that value is settled. Move to the next one.")
    lines.append(
        "- Ask every confirming question the positive way round. Say \"is that still right?\", never "
        "\"is any of that out of date?\". A yes has to mean yes, because the answer is read back "
        "afterwards by software that cannot hear tone."
    )
    lines.append("- If they correct you, read the corrected value back again and confirm that instead.")
    lines.append(
        "- Never suggest a value yourself and never accept a value you have not heard them say. "
        "If they are unsure, say that is fine, do not press, and leave it unsettled."
    )

    lines.append("")
    lines.append("End the call immediately, politely, and without asking anything further if:")
    lines.append("- they ask not to be called again, or ask to be removed from the list;")
    lines.append("- the person who answered is looking for help rather than working there;")
    lines.append("- anyone is distressed, or the call has reached the wrong number;")
    lines.append("- they tell you the service is closing or has closed. Thank them, and stop. Do not")
    lines.append("  ask them to confirm a closure and do not ask any follow-up questions about it.")

    lines.append("")
    lines.append(
        "Keep the call under "
        f"{contract.call_constraints.max_duration_seconds // 60} minutes. Be brief and warm; the "
        "person answering is usually busy and often a volunteer. When you are done, thank them and "
        "end the call."
    )
    return "\n".join(line for line in lines if line is not None).strip()


def render_user_input(contract: VerificationContract) -> str:
    """The one-line request CALL-E's planner sees, preserved verbatim."""
    fields = ", ".join(contract.field_label(field) for field in contract.fields_to_verify)
    return (
        f"Call {contract.subject.name} on {contract.authoritative_phone} and confirm {fields} "
        f"for the community resource directory."
    )


def result_schema(contract: VerificationContract) -> dict[str, Any]:
    """The shape Callibrate wants back, for CALL-E surfaces that accept one.

    The MCP tool set does not take a result schema, so on that path this is
    published rather than sent: it is what the console shows as the contract's
    expected return, and what the Developer API integration would pass as
    `recipient_result_schema`. Either way the transcript, not this, is what
    decides.
    """
    properties: dict[str, Any] = {
        "reached_provider": {
            "type": "string",
            "enum": ["yes", "no", "wrong_number", "reached_service_user"],
        },
        "asked_to_stop_calling": {"type": "boolean"},
        "service_is_closing": {"type": "boolean"},
    }
    for field in contract.fields_to_verify:
        properties[field] = {
            "type": "object",
            "properties": {
                "changed": {"type": "string", "enum": ["yes", "no", "unknown"]},
                "value": {"type": "string"},
                "read_back_and_confirmed": {"type": "boolean"},
            },
            "required": ["changed"],
        }
    return {
        "type": "object",
        "required": ["reached_provider", *contract.fields_to_verify],
        "properties": properties,
    }


def _flatten_activity(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull transcript turns out of whichever shape the run response used."""
    for key in ("transcript_turns", "transcriptTurns", "transcript"):
        value = payload.get(key)
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value
    recipients = payload.get("recipients")
    if isinstance(recipients, list):
        for recipient in recipients:
            if not isinstance(recipient, dict):
                continue
            for attempt in recipient.get("attempts") or []:
                if isinstance(attempt, dict):
                    turns = attempt.get("transcript_turns") or attempt.get("transcriptTurns")
                    if isinstance(turns, list) and turns:
                        return turns
    activity = payload.get("activity")
    if isinstance(activity, list):
        turns = [item for item in activity if isinstance(item, dict) and item.get("text")]
        if turns:
            return turns
    return []


def _summary_of(payload: dict[str, Any]) -> str:
    for key in ("summary", "details", "result_summary"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


class CallEVerificationCaller(VerificationCaller):
    """Place a verification call with CALL-E and return what the transcript shows."""

    name = "call-e"
    is_live = True

    def __init__(
        self,
        client: CalleMcpClient,
        *,
        first_poll_seconds: float = 60.0,
        poll_interval_seconds: float = 8.0,
        max_wait_seconds: float = 900.0,
        ttl_seconds: int = 86_400,
        on_run_started: Callable[[str, str], None] | None = None,
        sleep: Callable[[float], Any] | None = None,
    ) -> None:
        self.client = client
        self.first_poll_seconds = first_poll_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.max_wait_seconds = max_wait_seconds
        self.ttl_seconds = ttl_seconds
        self.on_run_started = on_run_started
        self._sleep = sleep or asyncio.sleep

    async def aclose(self) -> None:
        await self.client.aclose()

    async def verify(self, contract: VerificationContract) -> CallEvidence:
        started = datetime.now(UTC)
        clock = time.monotonic()
        try:
            plan = await self.client.plan_call(
                user_input=render_user_input(contract),
                to_phones=[contract.authoritative_phone],
                goal=render_call_goal(contract),
                language=contract.call_constraints.language,
                region=contract.call_constraints.region,
                ttl_seconds=self.ttl_seconds,
            )
        except CalleError as error:
            raise CallError(f"CALL-E could not plan the call: {error}") from error

        plan_id = str(plan.get("plan_id") or "")
        confirm_token = str(plan.get("confirm_token") or "")
        if not plan.get("ready_to_run") or not plan_id or not confirm_token:
            questions = plan.get("clarifying_questions") or plan.get("clarifyingQuestions") or []
            detail = "; ".join(str(item) for item in questions)[:400] if questions else "no reason given"
            raise CallError(
                f"CALL-E would not run this plan without more detail ({detail}). "
                "The contract has to name the phone number, region and language.",
                retryable=False,
            )

        try:
            run = await self.client.run_call(
                plan_id=plan_id, confirm_token=confirm_token, ttl_seconds=self.ttl_seconds
            )
        except CalleError as error:
            raise CallError(f"CALL-E could not start the call: {error}") from error

        run_id = str(run.get("run_id") or "")
        if not run_id:
            # Documented as unrecoverable without an explicit next_step: a call
            # may or may not be in progress. Never retried automatically.
            raise CallError(
                "CALL-E started a call but returned no run id; the run must be recovered by an "
                "operator with `calle call recover` before anything else is attempted",
                retryable=False,
            )
        if self.on_run_started is not None:
            self.on_run_started(run_id, plan_id)

        payload = await self._await_terminal(run_id)
        status = str(payload.get("status") or "").upper()
        outcome = STATUS_OUTCOMES.get(status, CallOutcome.FAILED)
        turns = normalize_turns(_flatten_activity(payload))
        completed = datetime.now(UTC)

        return build_evidence(
            contract,
            turns=turns,
            caller=self.name,
            outcome=outcome,
            caller_result=payload,
            call_id=run_id,
            plan_id=plan_id,
            provider_status=status,
            summary=_summary_of(payload),
            started_at=started,
            completed_at=completed,
            duration_seconds=time.monotonic() - clock,
        )

    async def _await_terminal(self, run_id: str) -> dict[str, Any]:
        """Follow one run to a terminal status. Never starts anything.

        Reaching the deadline here does not fail the phone call and does not
        cancel it; it fails this attempt to observe it. The run id is already
        persisted, so the run can be picked up again.
        """
        await self._sleep(self.first_poll_seconds)
        deadline = time.monotonic() + self.max_wait_seconds
        payload: dict[str, Any] = {}
        while time.monotonic() < deadline:
            try:
                payload = await self.client.get_call_run(run_id=run_id)
            except CalleError as error:
                raise CallError(
                    f"CALL-E run {run_id} could not be read: {redact(str(error))}", call_id=run_id
                ) from error
            status = str(payload.get("status") or "").upper()
            if status in TERMINAL_STATUSES:
                return payload
            await self._sleep(self.poll_interval_seconds)
        raise CallError(
            f"CALL-E run {run_id} had not reached a terminal status within "
            f"{int(self.max_wait_seconds)}s; the run is still valid and can be read again",
            call_id=run_id,
        )
