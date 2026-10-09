"""The orchestrator: the only thing that can cause a call.

Everything else in Reachable is pure or a store. This module wires CSV imports,
register scans, the contact-check sweep, call results and staff clicks through
the two machines, and it is the single place where a transport is touched.

**There is no code path here that dials without passing every guard.**
:meth:`Orchestrator.place_call` calls :func:`reachable.policy.evaluate` and
refuses on anything but ``allowed``, then reserves the idempotency key *before*
handing anything to a transport.

Every decision is recorded with a human-readable reason, so the dashboard can
answer "why is this case not being called?" without anybody reading a log.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from . import policy
from .calls import contracts
from .calls.binding import Intent
from .calls.client import (
    CallClient,
    CallError,
    CallRequest,
    CallSubmissionUnknown,
)
from .calls.dispositions import Classification, classify, contact_check_event, pattern_event
from .calls.dryrun_client import Preview
from .config import Config, parse_clock
from .importers import ImportReport, load_dataset
from .machines import contact_check as cc
from .machines import pattern_followup as pf
from .models import (
    FLAGGED_HEALTH,
    AttemptState,
    Contact,
    ContactCheckState,
    ContactHealth,
    Dataset,
    Disposition,
    NoCallReason,
    PatternState,
    Pupil,
    Workflow,
)
from .phone import mask
from .sanitize import clean_quote, clean_text, clean_transcript_turns
from .sessions import all_triggers, code_n_deadline, trigger_still_valid
from .store import LedgerConflict, Store, intent_digest, to_json, utcnow

SYSTEM = "system"


class OrchestratorError(RuntimeError):
    pass


@dataclass
class CallOutcome:
    """What happened when a call was attempted. A refusal is a result."""

    placed: bool
    reason: NoCallReason | None = None
    detail: str = ""
    attempt_id: int | None = None
    call_id: str = ""
    preview: Preview | None = None

    @property
    def text(self) -> str:
        if self.placed:
            return "Call placed"
        return policy.Decision(False, self.reason, self.detail).text


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Orchestrator:
    store: Store
    config: Config
    client: CallClient
    dataset: Dataset = field(default_factory=Dataset)
    #: Injectable so the dashboard and the tests share one source of "now".
    #: The calling-window guard is time-of-day sensitive, so a wall clock would
    #: make behaviour depend on when somebody happens to run it.
    clock: Callable[[], datetime] = _utc_now
    #: Serialises the guard-check-then-reserve critical section.
    #:
    #: Without it, concurrent requests can all pass guard 6 before any of them
    #: writes an attempt row, and only the UNIQUE constraint on the idempotency
    #: key stops a second dial -- by raising an IntegrityError the operator sees
    #: as a 500, with no way to tell whether a call happened. The lock makes the
    #: outcome deterministic rather than constraint-dependent. It is held for the
    #: reservation only, never across the network call.
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False, compare=False)

    # ------------------------------------------------------------------ ids

    @staticmethod
    def pattern_case_id(pupil_id: str, trigger_date: date) -> str:
        return f"PF-{pupil_id}-{trigger_date.isoformat()}"

    @staticmethod
    def contact_case_id(term_id: str, contact_id: str) -> str:
        return f"CC-{term_id}-{contact_id}"

    # --------------------------------------------------------------- import

    def import_data(self, data_dir: str | Path | None = None) -> ImportReport:
        """Load the five CSVs and adopt the school's own timezone and window."""
        dataset, report = load_dataset(data_dir or self.config.data_dir)
        if not report.ok:
            self.store.record_event("import.failed", reason=report.fatal)
            return report

        self.dataset = dataset
        school = dataset.school
        if school is not None:
            self.config = self.config.with_school(
                name=school.school_name,
                timezone=school.timezone,
                window_start=parse_clock(school.call_window_start, "call_window_start"),
                window_end=parse_clock(school.call_window_end, "call_window_end"),
            )

        # Contacts start unknown rather than assumed good, and rejected numbers
        # are flagged at once so the office sees them without running anything.
        for contact in dataset.contacts:
            if self.store.health_for(contact.contact_id) is None:
                self.store.set_contact_health(
                    contact.contact_id,
                    pupil_id=contact.pupil_id,
                    status=ContactHealth.NOT_CHECKED.value,
                    reason="Not checked this term",
                    source="import",
                )
        for problem in report.rejected:
            if problem.file == "contacts.csv" and "phone" in problem.reason:
                self.store.record_event(
                    "import.rejected_contact", reason=f"{problem.reason} ({problem.detail})"
                )

        self.store.record_event("import.completed", reason=report.summary())
        return report

    # ----------------------------------------------------------- workflow B

    def scan_register(self) -> list[str]:
        """Find triggers and screen each one. Creates cases; places no calls."""
        created: list[str] = []
        for trigger in all_triggers(self.dataset, threshold=self.config.trigger_sessions):
            pupil = self.dataset.pupils.get(trigger.pupil_id)
            if pupil is None:
                continue
            case_id = self.pattern_case_id(trigger.pupil_id, trigger.trigger_date)
            if self.store.case(case_id) is not None:
                continue

            deadline = code_n_deadline(self.dataset.calendar, trigger.trigger_date)
            self.store.upsert_case(
                case_id,
                workflow=Workflow.PATTERN_FOLLOWUP,
                pupil_id=trigger.pupil_id,
                state=PatternState.PF_TRIGGERED.value,
                trigger_date=trigger.trigger_date.isoformat(),
                detail={
                    "sessions": trigger.session_labels,
                    "code_n_deadline": deadline.isoformat() if deadline else "",
                },
            )
            self.store.record_event(
                "trigger.detected",
                reason=f"Trigger: {trigger.session_labels}",
                case_id=case_id,
                pupil_id=trigger.pupil_id,
            )
            created.append(case_id)
            self._screen(case_id, pupil, trigger)
        return created

    def _screen(self, case_id: str, pupil: Pupil, trigger) -> None:
        """Apply the case-level gates, then select the first contact."""
        self._advance_pattern(case_id, pf.PFEvent.SCREENING_STARTED)

        decision = policy.screening_decision(
            store=self.store,
            dataset=self.dataset,
            pupil=pupil,
            case_id=case_id,
            trigger_valid=trigger_still_valid(self.dataset, trigger),
        )
        if not decision.allowed:
            self.store.record_decision(
                decision.reason.value,
                "hold" if decision.is_hold else "terminal",
                case_id=case_id,
                pupil_id=pupil.pupil_id,
                detail=decision.detail,
            )
            transition = self._advance_pattern(
                case_id,
                pf.PFEvent.SCREENING_REFUSED,
                pf.PFContext(refusal=decision.reason),
            )
            if transition.raises_task:
                self._add_task(
                    case_id,
                    pupil_id=pupil.pupil_id,
                    kind="vulnerable_pupil"
                    if decision.reason is NoCallReason.PUPIL_VULNERABLE
                    else "screening",
                    detail=decision.text
                    + (f" Notes: {pupil.notes_for_staff}" if pupil.notes_for_staff else ""),
                    urgent=decision.reason is NoCallReason.PUPIL_VULNERABLE,
                )
            return

        self._select_contact(case_id, pupil.pupil_id, start_at=0)

    def _select_contact(self, case_id: str, pupil_id: str, *, start_at: int) -> None:
        """Walk the cascade in the school's order until a usable contact is found."""
        contacts = policy.callable_contacts(self.dataset, pupil_id)
        index = start_at
        while index < len(contacts):
            if index >= self.config.cascade_limit:
                break
            contact = contacts[index]
            blocker = policy.contact_blockers(contact)
            if blocker.allowed:
                self.store.upsert_case(
                    case_id,
                    workflow=Workflow.PATTERN_FOLLOWUP,
                    pupil_id=pupil_id,
                    state=PatternState.PF_CASCADE_READY.value,
                    contact_id=contact.contact_id,
                    cascade_index=index,
                    detail=self._case_detail(case_id),
                )
                self.store.record_event(
                    "cascade.selected",
                    reason=f"Contact {index + 1} of {len(contacts)} selected "
                    f"({mask(contact.phone_e164)})",
                    case_id=case_id,
                    pupil_id=pupil_id,
                    contact_id=contact.contact_id,
                )
                return

            # This contact cannot be called. Flag it, record why, move on.
            self._flag_contact(
                contact,
                ContactHealth.INVALID_NUMBER
                if blocker.reason is NoCallReason.INVALID_DESTINATION
                else ContactHealth.LANGUAGE_UNSUPPORTED,
                blocker.text,
                source="cascade",
            )
            self.store.record_decision(
                blocker.reason.value,
                "terminal",
                case_id=case_id,
                pupil_id=pupil_id,
                contact_id=contact.contact_id,
                detail=blocker.detail,
            )
            if blocker.reason is NoCallReason.LANGUAGE_NOT_SUPPORTED:
                self._add_task(
                    case_id,
                    pupil_id=pupil_id,
                    contact_id=contact.contact_id,
                    kind="language",
                    detail=f"{contact.contact_name} needs {contact.language}; call by hand.",
                )
            index += 1

        # Nothing callable left.
        transition = self._advance_pattern(
            case_id,
            pf.PFEvent.CASCADE_NEXT,
            pf.PFContext(has_next_contact=False),
            from_state=PatternState.PF_CASCADE_ADVANCE
            if start_at > 0
            else PatternState.PF_SCREENING,
        )
        if transition.raises_task:
            self._add_task(
                case_id,
                pupil_id=pupil_id,
                kind="unreachable",
                detail="No contact could be reached for this pupil.",
                urgent=True,
            )

    # ----------------------------------------------------------- workflow A

    def start_contact_check(self, term_id: str | None = None) -> list[str]:
        """Open a contact-check case per callable contact for this term."""
        term = term_id or self.config.term_id
        created: list[str] = []
        for contact in self.dataset.contacts:
            if not contact.is_emergency_contact or contact.do_not_call:
                continue
            case_id = self.contact_case_id(term, contact.contact_id)
            if self.store.case(case_id) is not None:
                continue

            self.store.upsert_case(
                case_id,
                workflow=Workflow.CONTACT_CHECK,
                pupil_id=contact.pupil_id,
                contact_id=contact.contact_id,
                state=ContactCheckState.CC_PENDING.value,
                term_id=term,
            )
            self.store.record_event(
                "contact_check.added",
                reason=f"Added to term {term} check list",
                case_id=case_id,
                pupil_id=contact.pupil_id,
                contact_id=contact.contact_id,
            )
            created.append(case_id)

            blocker = policy.contact_blockers(contact)
            if not blocker.allowed:
                self._flag_contact(
                    contact,
                    ContactHealth.INVALID_NUMBER
                    if blocker.reason is NoCallReason.INVALID_DESTINATION
                    else ContactHealth.LANGUAGE_UNSUPPORTED,
                    blocker.text,
                    source="contact_check",
                )
                self.store.record_decision(
                    blocker.reason.value,
                    "terminal",
                    case_id=case_id,
                    pupil_id=contact.pupil_id,
                    contact_id=contact.contact_id,
                    detail=blocker.detail,
                )
                transition = self._advance_contact(
                    case_id, cc.CCEvent.GUARD_REFUSED, cc.CCContext(refusal=blocker.reason)
                )
                if transition.raises_task:
                    self._add_task(
                        case_id,
                        pupil_id=contact.pupil_id,
                        contact_id=contact.contact_id,
                        kind="language",
                        detail=f"{contact.contact_name} needs {contact.language}; call by hand.",
                    )
                continue

            self._advance_contact(case_id, cc.CCEvent.RENDERED)
        return created

    # ------------------------------------------------------------- dialling

    def build_request(self, case_id: str) -> tuple[CallRequest, Contact, Pupil, str]:
        """Render one call. Raises ContractError if it cannot be rendered safely."""
        case = self._case(case_id)
        workflow = Workflow(case["workflow"])
        pupil = self.dataset.pupils.get(case["pupil_id"])
        contact = self._contact(case["contact_id"])
        if pupil is None or contact is None:
            raise OrchestratorError(f"case {case_id} has no pupil or contact")

        school = self.dataset.school
        values: dict[str, Any] = {
            "school_name": school.school_name if school else self.config.school_name,
            "contact_name": contact.contact_name,
            "pupil_first_name": pupil.first_name,
        }
        if workflow is Workflow.PATTERN_FOLLOWUP:
            values["attendance_officer_name"] = (
                school.attendance_officer_name if school and school.attendance_officer_name
                else "the attendance officer"
            )

        task = contracts.render_task(workflow, values)
        scope = (
            case["trigger_date"] if workflow is Workflow.PATTERN_FOLLOWUP else case["term_id"]
        )
        # The ordinal of the human authorisation this call runs under. Attempts
        # are only created after guard 2 has seen a confirmation, so the count
        # of prior attempts for this contact *is* the count of prior
        # authorisations. It is stable for the whole of one dial: the attempt
        # row is written after the key is derived.
        authorisation = self.store.attempts_for_contact(case_id, contact.contact_id) + 1
        key = policy.idempotency_key(
            workflow,
            pupil_id=pupil.pupil_id,
            contact_id=contact.contact_id,
            scope=scope,
            authorisation=authorisation,
        )
        request = CallRequest(
            task=task,
            result_schema=contracts.result_schema(workflow),
            destination=contact.phone_e164,
            idempotency_key=key,
            metadata={
                "case_id": case_id,
                "pupil_ref": pupil.pupil_id,
                "contact_ref": contact.contact_id,
                "workflow": workflow.value,
            },
            region="GB",
            locale="en-GB",
        )
        return request, contact, pupil, key

    def preview(self, case_id: str) -> Preview:
        """The exact task text and masked destination, before any live call."""
        request, _, _, _ = self.build_request(case_id)
        return Preview.of(request)

    def place_call(
        self,
        case_id: str,
        *,
        confirmed: bool,
        actor: str = "operator",
        now: datetime | None = None,
    ) -> CallOutcome:
        """Guards, then reserve, then dial. Never the other way round."""
        with self._lock:
            reserved = self._reserve(case_id, confirmed=confirmed, actor=actor, now=now)
        if isinstance(reserved, CallOutcome):
            return reserved
        request, attempt_id, workflow = reserved

        # The network call happens outside the lock. The attempt row already
        # exists, so guard 6 blocks anybody else on this case while it runs.
        try:
            handle = self.client.create(request)
        except CallSubmissionUnknown as exc:
            # The call may already have happened. Reconciled by reading it back,
            # never by dialling again.
            self.store.update_attempt(attempt_id, state=AttemptState.SUBMISSION_UNKNOWN.value)
            self._advance(
                case_id,
                workflow,
                cc.CCEvent.SUBMISSION_UNKNOWN
                if workflow is Workflow.CONTACT_CHECK
                else pf.PFEvent.SUBMISSION_UNKNOWN,
            )
            self.store.record_event(
                "call.submission_unknown",
                reason=f"Submission unknown ({exc}); reconciling, not redialling",
                case_id=case_id,
            )
            return CallOutcome(False, detail=str(exc), attempt_id=attempt_id)
        except CallError as exc:
            self.store.update_attempt(attempt_id, state=AttemptState.NEEDS_HUMAN.value)
            self._to_human(case_id, f"Call submission refused: {exc}")
            return CallOutcome(False, detail=str(exc), attempt_id=attempt_id)

        self.store.update_attempt(
            attempt_id, state=AttemptState.ACCEPTED.value, call_id=handle.call_id
        )
        return CallOutcome(True, attempt_id=attempt_id, call_id=handle.call_id)

    def _reserve(
        self, case_id: str, *, confirmed: bool, actor: str, now: datetime | None
    ):
        """Guards, then reserve, then write the attempt. Caller holds the lock.

        Returns a CallOutcome on refusal, or (request, attempt_id, workflow) when
        the call may proceed.
        """
        case = self._case(case_id)
        workflow = Workflow(case["workflow"])
        moment = now or self.clock()

        try:
            request, contact, pupil, key = self.build_request(case_id)
        except contracts.ContractError as exc:
            self._to_human(case_id, f"Task text could not be rendered safely: {exc}")
            return CallOutcome(False, detail=str(exc))

        decision = policy.evaluate(
            config=self.config,
            store=self.store,
            dataset=self.dataset,
            workflow=workflow,
            pupil=pupil,
            contact=contact,
            case_id=case_id,
            idem_key=key,
            confirmed=confirmed,
            now=moment,
        )
        if not decision.allowed:
            return self._refuse(case_id, workflow, pupil, contact, decision, request)

        # Reserve BEFORE dialling. A record that only exists after success is
        # not a record: a call accepted but never reported would leave no trace
        # for the next attempt to collide with.
        digest = intent_digest(
            case_id=case_id,
            workflow=workflow.value,
            pupil=pupil.pupil_id,
            contact=contact.contact_id,
            destination=contact.phone_e164,
        )
        try:
            fresh = self.store.reserve_key(
                key,
                workflow=workflow,
                case_id=case_id,
                pupil_id=pupil.pupil_id,
                contact_id=contact.contact_id,
                digest=digest,
            )
        except LedgerConflict as exc:
            self._to_human(case_id, str(exc))
            return CallOutcome(False, NoCallReason.IDEMPOTENCY_KEY_USED, str(exc))

        if not fresh:
            # This exact intent is already reserved, so a call for it has already
            # been submitted. Honouring the return value rather than ignoring it
            # is what turns a duplicate request into a named refusal instead of a
            # unique-constraint crash.
            self.store.record_decision(
                NoCallReason.CALL_IN_PROGRESS.value,
                "hold",
                case_id=case_id,
                pupil_id=pupil.pupil_id,
                contact_id=contact.contact_id,
                detail="this authorisation was already submitted",
            )
            return CallOutcome(
                False, NoCallReason.CALL_IN_PROGRESS, "this authorisation was already submitted"
            )

        attempt_id = self.store.create_attempt(
            case_id=case_id,
            workflow=workflow,
            pupil_id=pupil.pupil_id,
            contact_id=contact.contact_id,
            idempotency_key=key,
            destination=contact.phone_e164,
            task_text=request.task,
        )
        self._advance(
            case_id,
            workflow,
            cc.CCEvent.SUBMITTED if workflow is Workflow.CONTACT_CHECK else pf.PFEvent.SUBMITTED,
            actor=actor,
        )
        self.store.record_event(
            "call.submitted",
            reason=f"Submitted to {mask(contact.phone_e164)}, key {key}",
            case_id=case_id,
            pupil_id=pupil.pupil_id,
            contact_id=contact.contact_id,
            actor=actor,
        )
        return request, attempt_id, workflow

    def _refuse(
        self, case_id, workflow, pupil, contact, decision, request
    ) -> CallOutcome:
        """Record a named refusal and move the case the way the machine says."""
        self.store.record_decision(
            decision.reason.value,
            "hold" if decision.is_hold else "terminal",
            case_id=case_id,
            pupil_id=pupil.pupil_id,
            contact_id=contact.contact_id,
            detail=decision.detail,
        )
        self.store.record_event(
            "call.refused",
            reason=decision.text,
            case_id=case_id,
            pupil_id=pupil.pupil_id,
            contact_id=contact.contact_id,
        )

        # A refusal only moves the case when the case was actually waiting to
        # dial. Refusing while a call is already in flight changes nothing about
        # the case -- and the machines correctly reject a guard refusal in a
        # dialling state, because it is not a meaningful event there.
        case = self._case(case_id)
        diallable = (
            ContactCheckState(case["state"]) in {ContactCheckState.CC_PENDING, ContactCheckState.CC_READY}
            if workflow is Workflow.CONTACT_CHECK
            else PatternState(case["state"]) is PatternState.PF_CASCADE_READY
        )
        if not diallable:
            return CallOutcome(
                False, decision.reason, decision.detail, preview=Preview.of(request)
            )

        if workflow is Workflow.CONTACT_CHECK:
            transition = self._advance_contact(
                case_id, cc.CCEvent.GUARD_REFUSED, cc.CCContext(refusal=decision.reason)
            )
        else:
            transition = self._advance_pattern(
                case_id, pf.PFEvent.GUARD_REFUSED, pf.PFContext(refusal=decision.reason)
            )
            if transition.state is PatternState.PF_CASCADE_ADVANCE:
                self._advance_cascade(case_id)

        if transition.flags_contact:
            self._flag_contact(
                contact,
                ContactHealth.INVALID_NUMBER
                if decision.reason is NoCallReason.INVALID_DESTINATION
                else ContactHealth.LANGUAGE_UNSUPPORTED,
                decision.text,
                source="guard",
            )
        if transition.raises_task:
            self._add_task(
                case_id,
                pupil_id=pupil.pupil_id,
                contact_id=contact.contact_id,
                kind="guard",
                detail=decision.text,
                urgent=decision.reason is NoCallReason.PUPIL_VULNERABLE,
            )
        return CallOutcome(
            False, decision.reason, decision.detail, preview=Preview.of(request)
        )

    # -------------------------------------------------------- reconciliation

    def reconcile(self, attempt_id: int) -> Classification | None:
        """Read the call back through the authoritative API and act on it."""
        attempt = self.store.attempt(attempt_id)
        if attempt is None:
            raise OrchestratorError(f"no call attempt {attempt_id}")
        if attempt["state"] == AttemptState.TERMINAL_VERIFIED.value:
            return None

        case_id = attempt["case_id"]
        workflow = Workflow(attempt["workflow"])
        call_id = attempt["call_id"]

        if not call_id:
            # Submission unknown with no id: nothing to read back, so the attempt
            # stays in flight and guard 6 blocks the case until a person acts.
            self.store.record_event(
                "reconcile.blocked",
                reason="Submission unknown and no call id was returned; a person must reconcile",
                case_id=case_id,
            )
            return None

        try:
            snapshot = self.client.get(str(call_id))
        except CallError as exc:
            self.store.record_event(
                "reconcile.unavailable", reason=f"Could not read the call back: {exc}",
                case_id=case_id,
            )
            return None

        classification = classify(
            snapshot,
            workflow=workflow,
            intent=Intent(
                call_id=str(call_id),
                idempotency_key=attempt["idempotency_key"],
                destination=attempt["destination"],
                pupil_ref=attempt["pupil_id"],
                contact_ref=attempt["contact_id"],
                workflow=workflow.value,
            ),
            confidence_floor=self.config.confidence_floor,
        )

        if classification.disposition is Disposition.OUTCOME_UNKNOWN:
            # Not ready is not a failure. Read again next cycle.
            #
            # The state is deliberately left alone. A queued call is still in
            # flight, and moving it to TERMINAL_UNVERIFIED would drop it out of
            # IN_FLIGHT_ATTEMPTS -- so guard 6, whose whole job is "never two
            # calls for one case", would stop applying the moment anything read
            # the call back early. The case state still refuses a second dial,
            # but that is one defence where there should be two.
            self.store.update_attempt(
                attempt_id,
                disposition=classification.disposition.value,
                disposition_reason=classification.reason,
            )
            return classification

        self._store_result(attempt_id, snapshot, classification)
        if workflow is Workflow.CONTACT_CHECK:
            self._apply_contact_result(case_id, classification)
        else:
            self._apply_pattern_result(case_id, classification)
        return classification

    def resume(self) -> list[int]:
        """Reconcile everything in flight after a restart. Never redials."""
        resumed: list[int] = []
        for row in self.store.unresolved_attempts():
            self.reconcile(int(row["id"]))
            resumed.append(int(row["id"]))
        return resumed

    def purge_expired_transcripts(self, now: datetime | None = None) -> int:
        """Delete transcripts past the retention period.

        Run at startup rather than on a timer: the app is a single process an
        office starts in the morning, and a retention policy that only runs when
        a scheduler happens to fire is a retention policy that does not run.

        The outcome, the disposition and the audit trail survive. The words do
        not.
        """
        moment = now or self.clock()
        cutoff = moment - timedelta(days=self.config.transcript_retention_days)
        purged = self.store.purge_transcripts(cutoff.isoformat(timespec="seconds"))
        if purged:
            self.store.record_event(
                "retention.purged",
                reason=(
                    f"Deleted {purged} transcript(s) older than "
                    f"{self.config.transcript_retention_days} days"
                ),
            )
        return purged

    def _store_result(self, attempt_id: int, snapshot: Mapping[str, Any], classification) -> None:
        """Persist the result, sanitised at the ingestion boundary."""
        confidence = snapshot.get("completion_confidence") or {}
        attempt = self.store.attempt(attempt_id)
        turns: list[dict[str, Any]] = []
        if attempt is not None:
            from .calls.binding import iter_attempts

            for candidate in iter_attempts(snapshot):
                if candidate.get("phone") == attempt["destination"]:
                    turns = clean_transcript_turns(candidate.get("transcript_turns"))
                    break

        result = classification.result
        self.store.update_attempt(
            attempt_id,
            state=(
                AttemptState.TERMINAL_VERIFIED.value
                if classification.disposition is Disposition.CONFIRMED
                else AttemptState.NEEDS_HUMAN.value
            ),
            disposition=classification.disposition.value,
            disposition_reason=clean_text(classification.reason),
            structured_result=to_json(_clean_result(result)) if result else None,
            transcript=to_json(turns),
            confidence_score=confidence.get("score") if isinstance(confidence, Mapping) else None,
            confidence_label=confidence.get("label") if isinstance(confidence, Mapping) else None,
            failure_code=clean_text(snapshot.get("failure_code")) or None,
        )

    # ------------------------------------------------------- applying results

    def _apply_contact_result(self, case_id: str, classification: Classification) -> None:
        event = contact_check_event(classification)
        transition = self._advance_contact(
            case_id,
            event,
            cc.CCContext(attempts_remaining=self._attempts_remaining(case_id)),
            fields=classification.fields,
        )
        contact = self._contact(self._case(case_id)["contact_id"])
        if contact is None:
            return

        health = {
            ContactCheckState.CC_VERIFIED: ContactHealth.VERIFIED,
            ContactCheckState.CC_WRONG_PERSON: ContactHealth.WRONG_PERSON,
            ContactCheckState.CC_NUMBER_NOT_WORKING: ContactHealth.NUMBER_NOT_WORKING,
            ContactCheckState.CC_NO_LONGER_A_CONTACT: ContactHealth.NO_LONGER_A_CONTACT,
            ContactCheckState.CC_UPDATE_REQUESTED: ContactHealth.UPDATE_REQUESTED,
            ContactCheckState.CC_UNREACHED: ContactHealth.UNREACHED,
        }.get(transition.state)
        if health is not None:
            self._flag_contact(contact, health, transition.reason, source="contact_check")

        if transition.raises_task:
            self._add_task(
                case_id,
                pupil_id=contact.pupil_id,
                contact_id=contact.contact_id,
                kind="contact_update",
                detail=(
                    f"{contact.contact_name} asked for their details to be changed. "
                    "Confirm through a known channel; no number was captured on the call."
                    if transition.state is ContactCheckState.CC_UPDATE_REQUESTED
                    else transition.reason
                ),
            )

    def _apply_pattern_result(self, case_id: str, classification: Classification) -> None:
        event = pattern_event(classification)
        case = self._case(case_id)
        contact = self._contact(case["contact_id"])
        transition = self._advance_pattern(case_id, event, fields=classification.fields)

        # The loop, B -> A: a failed pattern call updates contact health at once,
        # rather than waiting for next term's check.
        if transition.flags_contact and contact is not None:
            health = (
                ContactHealth.WRONG_PERSON
                if event is pf.PFEvent.RESULT_WRONG_PERSON
                else ContactHealth.NUMBER_NOT_WORKING
            )
            self._flag_contact(contact, health, transition.reason, source="pattern_call")

        if transition.state is PatternState.PF_URGENT_HUMAN:
            quotes = _quotes(classification.result)
            self._add_task(
                case_id,
                pupil_id=case["pupil_id"],
                contact_id=case["contact_id"],
                kind="safeguarding",
                detail=(
                    "Contact may not know about the absence, or does not know where the "
                    "pupil is. Call the family back now. "
                    + (" ".join(f'"{q}"' for q in quotes) if quotes else "")
                ).strip(),
                urgent=True,
            )
            return

        if transition.state is PatternState.PF_SUPPORT_REQUESTED:
            result = classification.result or {}
            self._add_task(
                case_id,
                pupil_id=case["pupil_id"],
                contact_id=case["contact_id"],
                kind="support",
                detail=clean_text(
                    f"Support requested. {result.get('barrier_note', '')} "
                    f"Reason: {result.get('reason_category', 'unknown')}."
                ),
            )

        if transition.state is PatternState.PF_CASCADE_ADVANCE:
            self._advance_cascade(case_id)

    def _advance_cascade(self, case_id: str) -> None:
        case = self._case(case_id)
        next_index = int(case["cascade_index"]) + 1
        contacts = policy.callable_contacts(self.dataset, case["pupil_id"])
        has_next = next_index < len(contacts)
        limit_reached = next_index >= self.config.cascade_limit

        transition = self._advance_pattern(
            case_id,
            pf.PFEvent.CASCADE_NEXT,
            pf.PFContext(has_next_contact=has_next, cascade_limit_reached=limit_reached),
        )
        if transition.state is PatternState.PF_CASCADE_READY:
            self._select_contact(case_id, case["pupil_id"], start_at=next_index)
        elif transition.raises_task:
            self._add_task(
                case_id,
                pupil_id=case["pupil_id"],
                kind="unreachable",
                detail="No contact could be reached for this pupil.",
                urgent=True,
            )

    # --------------------------------------------------------- staff actions

    def staff_resolve(
        self, case_id: str, target: str, *, actor: str, note: str = ""
    ) -> None:
        case = self._case(case_id)
        workflow = Workflow(case["workflow"])
        if workflow is Workflow.CONTACT_CHECK:
            self._advance_contact(
                case_id,
                cc.CCEvent.STAFF_RESOLVED,
                cc.CCContext(staff_target=ContactCheckState(target)),
                actor=actor,
            )
        else:
            self._advance_pattern(
                case_id,
                pf.PFEvent.STAFF_RESOLVED,
                pf.PFContext(staff_target=PatternState(target)),
                actor=actor,
            )
        if note:
            self.store.record_event(
                "staff.note", reason=clean_text(note), case_id=case_id, actor=actor
            )

    def approve_suggested_reason(self, case_id: str, *, actor: str) -> None:
        """Staff approve the suggestion. Reachable still records nothing official."""
        case = self._case(case_id)
        self.store.record_event(
            "staff.approved_reason",
            reason=(
                "Suggested reason approved by staff. Reachable does not write to the "
                "register; a member of staff records the code."
            ),
            case_id=case_id,
            pupil_id=case["pupil_id"],
            actor=actor,
        )

    def mark_task_handled(self, task_id: str, *, actor: str) -> None:
        self.store.mark_task_handled(task_id)
        self.store.record_event("staff.task_handled", reason=f"Task {task_id} handled", actor=actor)

    # -------------------------------------------------------------- helpers

    def _case(self, case_id: str):
        case = self.store.case(case_id)
        if case is None:
            raise OrchestratorError(f"no case {case_id}")
        return case

    def _case_detail(self, case_id: str) -> dict[str, Any]:
        from .store import from_json

        case = self.store.case(case_id)
        return from_json(case["detail"], {}) if case else {}

    def _contact(self, contact_id: str) -> Contact | None:
        for contact in self.dataset.contacts:
            if contact.contact_id == contact_id:
                return contact
        return None

    def _attempts_remaining(self, case_id: str) -> bool:
        case = self.store.case(case_id)
        if case is None:
            return False
        used = self.store.attempts_for_contact(case_id, case["contact_id"])
        return used < self.config.max_attempts

    def _advance(self, case_id: str, workflow: Workflow, event, **kwargs):
        if workflow is Workflow.CONTACT_CHECK:
            return self._advance_contact(case_id, event, **kwargs)
        return self._advance_pattern(case_id, event, **kwargs)

    def _advance_contact(
        self, case_id: str, event, context=None, *, actor: str = SYSTEM, fields=()
    ):
        case = self._case(case_id)
        state = ContactCheckState(case["state"])
        transition = cc.step(state, event, context)
        self.store.upsert_case(
            case_id,
            workflow=Workflow.CONTACT_CHECK,
            pupil_id=case["pupil_id"],
            contact_id=case["contact_id"],
            state=transition.state.value,
            term_id=case["term_id"],
            cascade_index=int(case["cascade_index"]),
            detail=self._case_detail(case_id),
        )
        self.store.record_event(
            f"cc.{event.value}",
            reason=transition.reason,
            case_id=case_id,
            pupil_id=case["pupil_id"],
            contact_id=case["contact_id"],
            actor=actor,
            fields=fields,
        )
        return transition

    def _advance_pattern(
        self, case_id: str, event, context=None, *, actor: str = SYSTEM, fields=(),
        from_state: PatternState | None = None,
    ):
        case = self._case(case_id)
        state = from_state or PatternState(case["state"])
        transition = pf.step(state, event, context)
        self.store.upsert_case(
            case_id,
            workflow=Workflow.PATTERN_FOLLOWUP,
            pupil_id=case["pupil_id"],
            contact_id=case["contact_id"],
            state=transition.state.value,
            trigger_date=case["trigger_date"],
            cascade_index=int(case["cascade_index"]),
            detail=self._case_detail(case_id),
        )
        self.store.record_event(
            f"pf.{event.value}",
            reason=transition.reason,
            case_id=case_id,
            pupil_id=case["pupil_id"],
            contact_id=case["contact_id"],
            actor=actor,
            fields=fields,
        )
        return transition

    def _to_human(self, case_id: str, reason: str) -> None:
        case = self._case(case_id)
        workflow = Workflow(case["workflow"])
        state = (
            ContactCheckState.CC_NEEDS_HUMAN.value
            if workflow is Workflow.CONTACT_CHECK
            else PatternState.PF_NEEDS_HUMAN.value
        )
        self.store.upsert_case(
            case_id,
            workflow=workflow,
            pupil_id=case["pupil_id"],
            contact_id=case["contact_id"],
            state=state,
            trigger_date=case["trigger_date"],
            term_id=case["term_id"],
            cascade_index=int(case["cascade_index"]),
            detail=self._case_detail(case_id),
        )
        self.store.record_event("case.needs_human", reason=clean_text(reason), case_id=case_id)

    def _flag_contact(
        self, contact: Contact, health: ContactHealth, reason: str, *, source: str
    ) -> None:
        self.store.set_contact_health(
            contact.contact_id,
            pupil_id=contact.pupil_id,
            status=health.value,
            reason=clean_text(reason),
            source=source,
        )
        if health in FLAGGED_HEALTH:
            self.store.record_event(
                "contact.flagged",
                reason=f"{contact.contact_name} ({mask(contact.phone_e164)}): {health.value}",
                pupil_id=contact.pupil_id,
                contact_id=contact.contact_id,
            )

    def _add_task(
        self,
        case_id: str,
        *,
        pupil_id: str,
        kind: str,
        detail: str,
        contact_id: str = "",
        urgent: bool = False,
    ) -> None:
        task_id = f"T-{kind}-{case_id}"
        self.store.add_task(
            task_id,
            pupil_id=pupil_id,
            kind=kind,
            detail=clean_text(detail),
            contact_id=contact_id,
            urgent=urgent,
        )
        self.store.record_event(
            "task.created",
            reason=f"{'URGENT: ' if urgent else ''}{kind} task raised",
            case_id=case_id,
            pupil_id=pupil_id,
            contact_id=contact_id,
        )


def _clean_result(result: Mapping[str, Any] | None) -> dict[str, Any]:
    """Sanitise a structured result at the ingestion boundary."""
    if not result:
        return {}
    cleaned: dict[str, Any] = {}
    for key, value in result.items():
        if isinstance(value, str):
            cleaned[key] = clean_quote(value) if "quote" in key else clean_text(value)
        elif isinstance(value, list):
            cleaned[key] = [clean_quote(v) for v in value if isinstance(v, str)]
        else:
            cleaned[key] = value
    return cleaned


def _quotes(result: Mapping[str, Any] | None) -> list[str]:
    if not result:
        return []
    raw = result.get("verbatim_quotes")
    if isinstance(raw, list):
        return [clean_quote(q) for q in raw if isinstance(q, str) and q.strip()][:3]
    return []
