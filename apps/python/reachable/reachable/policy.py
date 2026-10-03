"""The guards, and every decision not to call.

Ten guards from docs/STATE_MACHINE.md §3, evaluated in order immediately before
any dial. Each is a pure function of stored state and the clock, so the first
failure stops evaluation and produces a named refusal.

**There is no code path that dials without passing all of them.** The
orchestrator calls :func:`evaluate` and refuses on anything but ``allowed``.

A refusal to place a call is a distinct outcome from any result of a call.
Collapsing the two means a workflow cannot tell "the call failed" from "the call
was never attempted because policy said not to".
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Sequence

from .config import Config
from .importers import language_supported
from .models import (
    HOLD_REASONS,
    NO_CALL_TEXT,
    Contact,
    Dataset,
    NoCallReason,
    Pupil,
    Workflow,
)
from .phone import is_e164
from .sessions import is_school_day
from .store import Store


@dataclass(frozen=True)
class Decision:
    """The answer to 'may this specific call be placed right now?'"""

    allowed: bool
    reason: NoCallReason | None = None
    detail: str = ""

    @property
    def is_hold(self) -> bool:
        """A hold re-arms next cycle; a terminal reason does not."""
        return self.reason in HOLD_REASONS if self.reason else False

    @property
    def text(self) -> str:
        if self.allowed:
            return "All guards passed"
        base = NO_CALL_TEXT.get(self.reason, str(self.reason))
        return f"{base} ({self.detail})" if self.detail else base


ALLOWED = Decision(True)


def idempotency_key(
    workflow: Workflow,
    *,
    pupil_id: str,
    contact_id: str,
    scope: str,
    authorisation: int,
) -> str:
    """Derive the key from the authorised intent, never from the attempt.

    Pattern follow-up: (trigger date, pupil, contact, authorisation).
    Contact check:     (term, contact, authorisation).

    ``authorisation`` is the ordinal of the human decision that this specific
    call may happen, not a retry counter. It advances only when a person
    authorises the household to be rung again -- which is genuinely a new
    authorised intent, and is exactly what the reference guidance means by
    deriving the key from the authorisation rather than the attempt.

    Without it the two documents contradict each other: the state machine
    returns a case to a ready state after voicemail so a further attempt may be
    authorised, while a key over (term, contact) alone is already reserved, so
    guard 9 refuses forever and the attempt budget is dead configuration.

    Anti-patterns that silently disable the protection, and are therefore
    impossible here: a fresh UUID, a hash of the clock, a hash of payload plus
    clock, one identifier per network retry. Retrying the *same* authorisation
    always produces the same key, so a timeout or a crash cannot dial twice.
    """
    if authorisation < 1:
        raise ValueError("an idempotency key requires a real authorisation ordinal")
    if workflow is Workflow.PATTERN_FOLLOWUP:
        intent = f"pattern:{scope}:{pupil_id}:{contact_id}:{authorisation}"
    else:
        intent = f"contact-check:{scope}:{contact_id}:{authorisation}"
    digest = hashlib.sha256(intent.encode("utf-8")).hexdigest()[:32]
    return f"reachable:{digest}"


def evaluate(
    *,
    config: Config,
    store: Store,
    dataset: Dataset,
    workflow: Workflow,
    pupil: Pupil,
    contact: Contact,
    case_id: str,
    idem_key: str,
    confirmed: bool,
    now: datetime,
    today: date | None = None,
) -> Decision:
    """Run guards 1-10 in order. The first failure wins."""
    local_now = now.astimezone(config.zoneinfo)
    day = today or local_now.date()

    # 1. live_mode. Necessary and NOT sufficient.
    if not config.live_calls:
        return Decision(False, NoCallReason.DRY_RUN)

    # 2. per_call_confirmation. The reason guard 1 alone cannot place a call.
    if not confirmed:
        return Decision(False, NoCallReason.AWAITING_CONFIRMATION)

    # 3. not_vulnerable. Evaluated before everything else that could dial: a
    #    child with a social worker is precisely the child for whom an automated
    #    call could do harm, and for whom a named professional already exists.
    if pupil.vulnerable:
        return Decision(False, NoCallReason.PUPIL_VULNERABLE)

    # 4. first_day_process. Reachable ADDS to first-day calling; a school without
    #    one needs a first-day process, not an automated second-day call.
    if workflow is Workflow.PATTERN_FOLLOWUP:
        if dataset.school is None or not dataset.school.has_first_day_process:
            return Decision(False, NoCallReason.NO_FIRST_DAY_PROCESS)

    # 5. school_day_and_window, in the school's own IANA zone.
    if not is_school_day(dataset.calendar, day):
        return Decision(False, NoCallReason.NON_SCHOOL_DAY, day.isoformat())
    if not _inside_window(local_now.time(), config.call_window_start, config.call_window_end):
        return Decision(
            False,
            NoCallReason.OUTSIDE_CALLING_WINDOW,
            f"{local_now:%H:%M} {config.school_timezone}",
        )

    # 6. one_in_flight. Stops the duplicate-call failure where a client timeout
    #    dials a household whose phone is already ringing. A submission_unknown
    #    attempt blocks indefinitely, until a person resolves it.
    in_flight = store.in_flight_for(case_id)
    if in_flight:
        return Decision(False, NoCallReason.CALL_IN_PROGRESS, in_flight[0]["state"])

    # 7. attempt_budget, per contact.
    used = store.attempts_for_contact(case_id, contact.contact_id)
    if used >= config.max_attempts:
        return Decision(
            False, NoCallReason.ATTEMPT_BUDGET_SPENT, f"{used} of {config.max_attempts}"
        )

    # 8. destination_valid. Rejected, never repaired.
    if not is_e164(contact.phone_e164):
        return Decision(False, NoCallReason.INVALID_DESTINATION)

    # 9. key_unreserved, or reserved for this exact intent.
    if store.key_reserved(idem_key):
        return Decision(False, NoCallReason.IDEMPOTENCY_KEY_USED, idem_key)

    # 10. language_supported. English only on UK lines.
    if not language_supported(contact):
        return Decision(False, NoCallReason.LANGUAGE_NOT_SUPPORTED, contact.language)

    return ALLOWED


def _inside_window(now: time, start: time, end: time) -> bool:
    return start <= now < end


def screening_decision(
    *,
    store: Store,
    dataset: Dataset,
    pupil: Pupil,
    case_id: str,
    trigger_valid: bool,
) -> Decision:
    """Gates evaluated once per trigger, before any contact is chosen.

    Separate from :func:`evaluate` because these are properties of the *case*,
    not of one call, and because the vulnerable gate must produce a staff task
    without ever selecting a contact to dial.
    """
    if pupil.vulnerable:
        return Decision(False, NoCallReason.PUPIL_VULNERABLE)
    if dataset.school is None or not dataset.school.has_first_day_process:
        return Decision(False, NoCallReason.NO_FIRST_DAY_PROCESS)
    if not trigger_valid:
        return Decision(False, NoCallReason.REASON_NOW_RECORDED)
    if store.open_case_for_pupil(pupil.pupil_id, exclude=case_id) is not None:
        return Decision(False, NoCallReason.OPEN_CASE_EXISTS)
    return ALLOWED


def callable_contacts(dataset: Dataset, pupil_id: str) -> list[Contact]:
    """Contacts in the school's listed order. Order is never second-guessed."""
    return dataset.contacts_for(pupil_id)


def contact_blockers(contact: Contact) -> Decision:
    """Per-contact gates that skip a contact without ending the cascade.

    An invalid number or an unsupported language means *this* contact cannot be
    called; the cascade advances and the contact is flagged in contact health.
    """
    if not is_e164(contact.phone_e164):
        return Decision(False, NoCallReason.INVALID_DESTINATION)
    if not language_supported(contact):
        return Decision(False, NoCallReason.LANGUAGE_NOT_SUPPORTED, contact.language)
    return ALLOWED


def describe_guards(
    *,
    config: Config,
    store: Store,
    dataset: Dataset,
    pupil: Pupil,
    contact: Contact,
    case_id: str,
    confirmed: bool,
    now: datetime,
) -> Sequence[tuple[str, bool, str]]:
    """Every guard with its current answer, for the dashboard.

    Shown even when they all pass, because "why is this case not being called?"
    should never require reading a log.
    """
    local_now = now.astimezone(config.zoneinfo)
    day = local_now.date()
    in_flight = store.in_flight_for(case_id)
    used = store.attempts_for_contact(case_id, contact.contact_id)
    school_day = is_school_day(dataset.calendar, day)
    window_ok = _inside_window(
        local_now.time(), config.call_window_start, config.call_window_end
    )
    has_first_day = bool(dataset.school and dataset.school.has_first_day_process)
    return [
        ("live mode", config.live_calls, config.mode_banner),
        ("per-call confirmation", confirmed, "confirmed" if confirmed else "awaiting a human"),
        ("pupil not vulnerable", not pupil.vulnerable, "flagged" if pupil.vulnerable else ""),
        ("first-day process recorded", has_first_day, "" if has_first_day else "missing"),
        ("school day", school_day, day.isoformat()),
        ("calling window", window_ok, f"{local_now:%H:%M} {config.school_timezone}"),
        ("no call in flight", not in_flight, in_flight[0]["state"] if in_flight else ""),
        ("attempt budget", used < config.max_attempts, f"{used} of {config.max_attempts}"),
        ("destination valid E.164", is_e164(contact.phone_e164), ""),
        ("language supported", language_supported(contact), contact.language),
    ]
