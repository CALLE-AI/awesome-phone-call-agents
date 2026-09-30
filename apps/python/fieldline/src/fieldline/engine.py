"""Trip engine: runs the check-in schedule and the escalation cascade.

The shared scheduler uses a scripted demo path and a restricted live path.
Live generated results stop for human review before any safety decision.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from .calle_client import CallDispatcher, UnknownCallOutcome
from .prompts import checkin_task, escalation_task
from .protocol import (
    CheckinOutcome,
    EscalationOutcome,
    NextStep,
    classify_checkin,
    classify_escalation,
    decide,
)
from .render import RichRenderer
from .report import CallRecord, build_incident_brief, write_incident_brief
from .schemas import CHECKIN_RESULT_SCHEMA, ESCALATION_RESULT_SCHEMA, TripPlan, TripPlanError, add_minutes, validate_live_window, scrub_text

Call = dict[str, Any]


class Waiter(Protocol):
    def wait_until(self, hhmm: str, reason: str) -> bool:
        """Block until the given local time. False = canceled by the user."""
        ...


class DemoWaiter:
    """DEMO: time-warps to the next scheduled moment instead of waiting."""

    def __init__(self, fast: bool = False) -> None:
        self.fast = fast

    def wait_until(self, hhmm: str, reason: str) -> bool:
        if not self.fast:
            time.sleep(0.9)  # DEMO: a beat, for pacing on screen
        return True


class LiveWaiter:
    """Date-bound local-clock waits. Overnight and expired targets fail closed."""

    def __init__(self, cancel_file: Path, plan: TripPlan, poll_seconds: float = 5.0,
                 now=None, sleep=None) -> None:
        self.cancel_file = cancel_file
        self.plan = plan
        self.poll = poll_seconds
        self.now = now or datetime.now
        self.sleep = sleep or time.sleep
        self._last_target: datetime | None = None

    def wait_until(self, hhmm: str, reason: str) -> bool:
        target = datetime.fromisoformat(f"{self.plan.date}T{hhmm}")
        end = datetime.fromisoformat(f"{self.plan.date}T{self.plan.end}")
        start = datetime.fromisoformat(f"{self.plan.date}T{self.plan.start}")
        if not start <= target <= end or (self._last_target and target < self._last_target):
            raise HumanReviewRequired("Schedule crossed its supported same-day window; monitoring stopped.")
        self._last_target = target
        while True:
            if self.cancel_file.exists():
                return False
            now = self.now()
            if now.date() != target.date() or now > end:
                raise HumanReviewRequired("Plan date/window expired; monitoring stopped.")
            if now >= target:
                return True
            self.sleep(self.poll)


class HumanReviewRequired(RuntimeError):
    """Stop automation until a human independently reconciles the call."""


class TripCanceled(RuntimeError):
    pass


@dataclass
class TripResult:
    status: str  # closed_safe | handed_off | notified | unreachable_ladder | canceled
    report_path: Path | None
    timeline: list[tuple[str, str, str]]
    records: list[CallRecord] = field(default_factory=list)


class TripEngine:
    def __init__(
        self,
        plan: TripPlan,
        dispatcher: CallDispatcher,
        renderer: RichRenderer,
        home: Path,
        demo: bool = True,
        waiter: Waiter | None = None,
    ) -> None:
        self.plan = plan
        self.dispatcher = dispatcher
        self.renderer = renderer
        self.home = home
        self.demo = demo
        self.waiter = waiter or DemoWaiter()
        self.timeline: list[tuple[str, str, str]] = []
        self.records: list[CallRecord] = []
        self._last_confirmed = f"{plan.start} — trip start briefing"
        self._coordinator: str | None = None

    # -- public --------------------------------------------------------
    def run(self) -> TripResult:
        try:
            if not self.demo:
                validate_live_window(self.plan)
            return self._run()
        except TripCanceled:
            return self._canceled()
        except UnknownCallOutcome:
            return self._stop_for_review("unknown_outcome", "Call outcome unknown. Reconcile in CALL-E before any new call; no retry or escalation was made.")
        except (HumanReviewRequired, TripPlanError):
            return self._stop_for_review("review_required", "Human review required. Verify the intended recipient and call evidence in CALL-E; no generated safety decision was acted on.")

    def _run(self) -> TripResult:
        plan, r = self.plan, self.renderer
        r.banner(plan, self.demo)
        self._log(plan.start, f"Trip opened: {plan.label}", "info")

        for at in plan.checkins:
            if not self.waiter.wait_until(at, "next scheduled check-in"):
                return self._canceled()
            r.section(at, f"scheduled check-in — {plan.worker.name}")
            outcome, step, last_dial_at = self._checkin_cycle(at)

            if step.kind == "schedule_next":
                continue

            # step.kind == "escalate"
            duress = step.silent
            if duress:
                r.duress_alert()
            elif outcome is CheckinOutcome.NEEDS_HELP:
                r.section(at, f"ASSISTANCE REQUESTED — engaging escalation ladder for {plan.worker.name}", "crit")
                self._log(at, "Worker requested assistance; escalation ladder engaged", "crit")
            else:
                overdue_at = self._at_offset(at, plan.grace_minutes)
                r.section(overdue_at, f"OVERDUE — {plan.worker.name} unreachable, engaging escalation ladder", "crit")
                self._log(overdue_at, "Worker declared OVERDUE; escalation ladder engaged", "crit")

            esc_outcome = self._run_ladder(missed_at=at, last_dial_at=last_dial_at, duress=duress, outcome=outcome)
            if esc_outcome is EscalationOutcome.STAND_DOWN:
                r.notice("Stand-down confirmed — resuming the check-in schedule.", "ok")
                continue
            return self._finish_incident(esc_outcome, duress)

        r.closing("Trip closed — all check-ins green. FieldLine standing down.", True)
        self._log(plan.end, "Trip closed; all check-ins green", "ok")
        return TripResult("closed_safe", None, self.timeline, self.records)

    def run_single_checkin(self) -> CheckinOutcome:
        try:
            if not self.demo:
                validate_live_window(self.plan, single=True)
            return self._run_single_checkin()
        except TripCanceled:
            self._canceled()
            return CheckinOutcome.REVIEW_REQUIRED
        except (UnknownCallOutcome, HumanReviewRequired, TripPlanError):
            self._stop_for_review("review_required", "Human review required. Reconcile the call in CALL-E before any new action; no automatic retry or escalation.")
            return CheckinOutcome.REVIEW_REQUIRED

    def _run_single_checkin(self) -> CheckinOutcome:
        """One immediate check-in call, no cascade — live-mode verification."""
        plan, r = self.plan, self.renderer
        r.banner(plan, self.demo)
        now = datetime.now().strftime("%H:%M")
        r.section(now, f"on-demand check-in — {plan.worker.name}")
        call = self._place_checkin(now, dials=1)
        outcome = classify_checkin(call)
        self._render_checkin(outcome, call, now)
        step = decide(outcome, dials_made=1, max_retries=0)
        r.notice(f"In a monitored trip, FieldLine would now: {step.kind} ({step.reason}).", "info")
        return outcome

    # -- check-ins -----------------------------------------------------
    def _checkin_cycle(self, at: str) -> tuple[CheckinOutcome, NextStep, str]:
        plan, r = self.plan, self.renderer
        dial_at, dials = at, 0
        while True:
            dials += 1
            call = self._place_checkin(at, dials, dial_at=dial_at)
            outcome = classify_checkin(call)
            step = decide(outcome, dials_made=dials, max_retries=plan.max_retries)
            self._render_checkin(outcome, call, dial_at)
            if step.kind != "retry":
                return outcome, step, dial_at
            next_dial = self._at_offset(dial_at, plan.retry_after_minutes)
            r.notice(f"Retrying at {next_dial} (retry interval {plan.retry_after_minutes} min)…", "warn")
            if not self.waiter.wait_until(next_dial, "retry"):
                raise TripCanceled()
            dial_at = next_dial

    def _place_checkin(self, at: str, dials: int, dial_at: str | None = None) -> Call:
        plan = self.plan
        self._before_call()
        self.renderer.dialing(
            plan.worker.name, plan.worker.phone, note="" if dials == 1 else f"retry {dials - 1}"
        )
        call = self.dispatcher.create_and_wait(
            task=checkin_task(plan, at),
            recipient={"phone": plan.worker.phone, "locale": plan.worker.locale},
            result_schema=CHECKIN_RESULT_SCHEMA,
            metadata={"app": "fieldline", "kind": "checkin", "scheduled_at": at, "dial": dials},
            idempotency_key=f"fieldline-checkin-{plan.date}-{at}-{dials}",
        )
        self._check_live_result(call, plan.worker.phone)
        self._replay_transcript_if_needed(call, plan.worker.name)
        self.records.append(
            CallRecord(dial_at or at, "check-in call", plan.worker.name, plan.worker.phone, call)
        )
        return call

    def _render_checkin(self, outcome: CheckinOutcome, call: Call, at: str) -> None:
        r = self.renderer
        if outcome is CheckinOutcome.SAFE:
            r.call_result("SAFE — check-in confirmed", call, True)
            summary = call.get("summary") or "worker confirmed safe"
            self._last_confirmed = f"{at} check-in call — {summary}"
            self._log(at, f"Check-in OK: {summary}", "ok")
        elif outcome is CheckinOutcome.DURESS:
            r.call_result("Check-in completed — worker states safe", call, True)
            self._log(at, "Duress phrase detected on check-in call; silent protocol engaged", "crit")
        elif outcome is CheckinOutcome.NEEDS_HELP:
            r.call_result("WORKER REQUESTS ASSISTANCE", call, False)
            self._log(at, "Worker requested assistance on check-in call", "crit")
        else:  # NO_ANSWER / UNCLEAR
            detail = call.get("summary") or call.get("failure_message") or outcome.value
            r.notice(f"✗ {detail}", "warn")
            self._log(at, f"Check-in call: {detail}", "warn")

    # -- escalation ----------------------------------------------------
    def _run_ladder(
        self, missed_at: str, last_dial_at: str, duress: bool, outcome: CheckinOutcome
    ) -> EscalationOutcome:
        plan, r = self.plan, self.renderer
        facts = self._initial_facts(missed_at, last_dial_at, duress, outcome)
        ladder = [plan.escalation[-1]] if duress else plan.escalation
        base_at = self._at_offset(missed_at, 3 if duress else plan.grace_minutes + 1)
        informed = False

        for rung, contact in enumerate(ladder):
            at_label = self._at_offset(base_at, rung * 7)
            if not self.waiter.wait_until(at_label, "escalation"):
                raise TripCanceled()
            self._before_call()
            r.section(
                at_label,
                f"escalation call {rung + 1}/{len(ladder)} — {contact.name} ({contact.relation})",
                "crit" if duress else "warn",
            )
            r.dialing(contact.name, contact.phone)
            call = self.dispatcher.create_and_wait(
                task=escalation_task(plan, contact, facts, duress=duress),
                recipient={"phone": contact.phone},
                result_schema=ESCALATION_RESULT_SCHEMA,
                metadata={"app": "fieldline", "kind": "escalation", "rung": rung, "duress": duress},
                idempotency_key=f"fieldline-esc-{plan.date}-{missed_at}-{rung}",
            )
            self._check_live_result(call, contact.phone)
            self._replay_transcript_if_needed(call, contact.name)
            self.records.append(CallRecord(at_label, "escalation call", contact.name, contact.phone, call))
            outcome = classify_escalation(call)

            if outcome is EscalationOutcome.NOT_REACHED:
                r.notice(f"✗ could not reach {contact.name} — climbing the ladder.", "warn")
                self._log(at_label, f"Escalation call to {contact.name}: not reached", "warn")
                continue
            informed = True
            if outcome is EscalationOutcome.STAND_DOWN:
                r.call_result(f"STAND-DOWN — {contact.name} has heard from {plan.worker.name}", call, True)
                self._log(at_label, f"{contact.name} reports contact with worker; stand-down", "ok")
                return outcome
            if outcome is EscalationOutcome.HANDED_OFF:
                r.call_result(f"HANDED OFF — {contact.name} assumed coordination", call, True)
                self._log(at_label, f"{contact.name} acknowledged and assumed coordination", "ok")
                self._coordinator = contact.name
                return outcome
            # WILL_CHECK: informed, but nobody owns the incident yet
            r.call_result(f"{contact.name} informed — checking in person", call, True)
            self._log(at_label, f"{contact.name} informed; checking site/route", "warn")
            notes = (call.get("structured_result") or {}).get("notes", "")
            facts.append(f"{contact.name} ({contact.relation}) reported: {notes or 'informed, checking now'}")

        if not informed:
            r.notice(f"LADDER EXHAUSTED. {plan.emergency_note}", "crit")
            self._log(self._at_offset(base_at, len(ladder) * 7), "Escalation ladder exhausted — nobody reached", "crit")
            return EscalationOutcome.NOT_REACHED
        return EscalationOutcome.WILL_CHECK

    def _initial_facts(
        self, missed_at: str, last_dial_at: str, duress: bool, outcome: CheckinOutcome
    ) -> list[str]:
        plan = self.plan
        facts: list[str] = []
        last_sr = self.records[-1].call.get("structured_result") if self.records else None
        if duress:
            facts.append(f"The duress phrase was used on the {missed_at} check-in call.")
            if isinstance(last_sr, dict) and last_sr.get("current_location"):
                facts.append(f"Worker's stated location: {last_sr['current_location']}.")
        elif outcome is CheckinOutcome.NEEDS_HELP:
            facts.append(f"Worker answered the {missed_at} check-in and requested assistance.")
            if isinstance(last_sr, dict):
                for key in ("current_location", "notes"):
                    if last_sr.get(key):
                        facts.append(f"Worker's {key.replace('_', ' ')}: {last_sr[key]}.")
        else:
            facts.append(f"Missed the scheduled {missed_at} safety check-in at {plan.site}.")
            facts.append(f"Retry calls unanswered (last attempt {last_dial_at}).")
        facts.append(f"Last confirmed contact: {self._last_confirmed}.")
        if plan.vehicle:
            facts.append(f"Vehicle on file: {plan.vehicle}.")
        facts.append(f"Planned site departure: {plan.end}.")
        return facts

    # -- wrap-up -------------------------------------------------------
    def _finish_incident(self, esc: EscalationOutcome, duress: bool) -> TripResult:
        plan, r = self.plan, self.renderer
        if esc is EscalationOutcome.HANDED_OFF:
            what = "silent duress escalation" if duress else "missed check-in escalation"
            status_line = f"{self._coordinator} has assumed coordination ({what})."
            status, good = "handed_off", True
        elif esc is EscalationOutcome.WILL_CHECK:
            status_line = "Contacts informed and checking — no one has assumed coordination yet."
            status, good = "notified", False
        else:
            status_line = f"ESCALATION LADDER EXHAUSTED — manual action required. {plan.emergency_note}"
            status, good = "unreachable_ladder", False

        brief = build_incident_brief(plan, self.timeline, self.records, status_line, self.demo)
        path = write_incident_brief(brief, self.home)
        r.section("", "incident summary", "warn")
        r.timeline(self.timeline)
        r.report_written(str(path))
        r.closing(status_line, good)
        return TripResult(status, path, self.timeline, self.records)

    def _canceled(self) -> TripResult:
        self.renderer.closing("Trip canceled — FieldLine monitoring stopped. No further calls will be placed.", True)
        self._log(datetime.now().strftime("%H:%M"), "Trip canceled by user", "info")
        return TripResult("canceled", None, self.timeline, self.records)

    # -- helpers -------------------------------------------------------
    def _at_offset(self, hhmm: str, minutes: int) -> str:
        if self.demo:
            return add_minutes(hhmm, minutes)
        target = datetime.fromisoformat(f"{self.plan.date}T{hhmm}") + timedelta(minutes=minutes)
        end = datetime.fromisoformat(f"{self.plan.date}T{self.plan.end}")
        if target.date().isoformat() != self.plan.date or target > end:
            raise HumanReviewRequired("Next action exceeds the supported plan window.")
        return target.strftime("%H:%M")

    def _before_call(self) -> None:
        if (self.home / "cancel").exists():
            raise TripCanceled()
        if not self.demo:
            validate_live_window(self.plan, single=True)

    def _check_live_result(self, call: Call, phone: str) -> None:
        if self.demo:
            return
        # No unbound generated safety field, summary or transcript drives a
        # live decision. Only explicit transport-level no-answer can advance.
        recipients = call.get("recipients")
        if call.get("status") != "completed" or not isinstance(recipients, list) or len(recipients) != 1:
            raise UnknownCallOutcome("Call outcome requires reconciliation.")
        recipient = recipients[0]
        attempts = recipient.get("attempts") or []
        if (recipient.get("phones") != [phone] or not attempts
                or recipient.get("structured_result") is not None
                or call.get("structured_result") is not None
                or recipient.get("status") != "no_answer"
                or any(a.get("phone") != phone or a.get("status") != "no_answer"
                       or a.get("transcript_turns") for a in attempts)):
            raise HumanReviewRequired("Generated or unbound result needs human review.")
        # Drop provider-controlled data before logs, records, prompts or briefs.
        call.clear()
        call.update({"status": "completed", "recipients": [],
                     "summary": "Confirmed no answer from the authorized destination."})

    def _stop_for_review(self, status: str, message: str) -> TripResult:
        self._log(datetime.now().strftime("%H:%M"), message, "crit")
        brief = build_incident_brief(self.plan, self.timeline, self.records, message, self.demo)
        path = write_incident_brief(brief, self.home)
        self.renderer.closing(message, False)
        self.renderer.report_written(str(path))
        return TripResult(status, path, self.timeline, self.records)

    def _replay_transcript_if_needed(self, call: Call, party: str) -> None:
        """Live mode: transcript arrives with the result, render it then."""
        if not self.demo or self.dispatcher.streams_transcript:
            return
        self.renderer._party = party
        for recipient in call.get("recipients") or []:
            for attempt in recipient.get("attempts") or []:
                for turn in attempt.get("transcript_turns") or []:
                    self.renderer.turn(turn.get("speaker", "unknown"), turn.get("text", ""))

    def _log(self, at: str, label: str, level: str) -> None:
        self.timeline.append((at, scrub_text(label), level))
