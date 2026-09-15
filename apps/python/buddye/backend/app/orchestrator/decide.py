"""What one check-in call established. Deterministic, pure, no model, no I/O.

Ported from ShiftFill's `decide()`, which held one rule above all others: every branch is written
down in this table, and an unknown is never resolved in the direction that lets the machine stop
worrying. BuddyE keeps that and inverts the input that matters.

**An unanswered call is an input to this function, not an early return.** In ShiftFill a NO_ANSWER
never reached `decide()` — the runner moved to the next candidate and the silence cost nothing. Here
nobody picking up is frequently the most important thing the system learns all evening: an
unanswered call to a neighbour whose oxygen concentrator is plugged into a wall socket during a
blackout is `UNREACHABLE`, and `UNREACHABLE` at the critical band is the top line on the captain's
board — above a neighbour we reached and who told us something is wrong, because there we at least
know what we are dealing with. So `risk` is a parameter: silence from Walter mid-outage and silence
from a healthy 40-year-old during a heat advisory are not the same event and must not sort together.

The table, in evaluation order:

    call status is not COMPLETED (NO_ANSWER, FAILED, INVALID_RESULT, still PENDING/DIALING) -> UNREACHABLE
    completed, but no schema-valid structured result at all                                 -> UNREACHABLE
    is_safe_now == "no"                                                                     -> URGENT
    checks.equipment_working == "no"   (powered medical equipment has stopped)              -> URGENT
    sounded_distressed == "yes"        (frightened, confused, cannot follow the call)       -> URGENT
    critical band + any hazard-required need check answered badly                            -> URGENT
    reached_intended_person != "yes"   (voicemail, a carer, or could not tell)              -> UNREACHABLE
    a need is established, and they accepted an offer                                       -> NEEDS_HELP
    a need is established, and they turned down every offer that was made                   -> HELP_DECLINED
    a need is established, and nothing was offered or nothing was answered                  -> NEEDS_HELP
    a hazard-required fact, is_safe_now or needs_help_now was never established
      (or the result failed schema validation, or CALL-E's own confidence was low):
        critical / high band                                                                -> URGENT
        elevated / routine band                                                             -> NEEDS_HELP
    everything established, safe, nothing needed                                            -> SAFE

Three orderings in that table are load-bearing and were chosen against the obvious alternative:

* **The alarm checks run before the reached-them gate.** A daughter picking up her mother's phone to
  say "she's on the floor and I can't lift her" arrives as `reached_intended_person = "no"` with
  `is_safe_now = "no"`. Gating on "did we speak to the person themselves" first — which is what
  ShiftFill did, because there an answer about someone we did not speak to is worthless — would turn
  the most urgent call in the product into a shrug.
* **`sounded_distressed == "yes"` is URGENT, not a note on a NEEDS_HELP.** Someone confused, slurred,
  or unable to follow the conversation cannot self-report, so their own "I'm fine" carries no
  evidentiary weight at all; and confusion is itself a symptom of heat illness and hypoxia. Guarded
  on "yes" only — "unknown" is what a voicemail returns, and must not make every voicemail urgent.
* **Safety asserted alongside an alarm resolves pessimistically.** ShiftFill parked that exact
  contradiction (accepted the shift in words, recorded as unable to work it) in HOLD_FOR_REVIEW.
  There is no hold here — five outcomes, all of them actionable — so the contradiction resolves to
  URGENT and the reason says out loud that they told us they were fine, because "I'm alright" from
  someone whose cooler died two days ago is the single most common way this product could fail.

The residue row deserves its own defence. "We reached them, nothing alarming, but a fact this hazard
made non-negotiable came back unknown" cannot be SAFE — SAFE means somebody checked and there is
nothing to do. It becomes URGENT in the bands where the triage engine already said harm is plausible
within hours, and NEEDS_HELP elsewhere, and in both cases the reason names the fact we could not
establish rather than claiming they asked for anything. A captain reading "could not establish
whether her cooler is running" and a captain reading "she needs water" must not be given the same
sentence.

Privacy: `concerns` and `findings` quote and describe a named person's health situation. That is the
product — the captain needs it. Redact at egress (`app.obs.redact`), never in here.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from app.calls.contract import get_path
from app.domain.risk import RiskBand
from app.domain.state import CheckOutcome

# The only provider status that means "we have a conversation to reason about". Everything else —
# NO_ANSWER, FAILED, INVALID_RESULT, and the transient PENDING/DIALING a misfiring runner could hand
# us — is silence, and silence is a finding. This function never raises and never returns SAFE on one.
COMPLETED = "COMPLETED"

# CALL-E scores its own confidence that the call did what it was asked to do. A low one does not
# overturn what was said; it means we do not get to call the result complete, so SAFE is off the table.
LOW_CONFIDENCE_LABELS = frozenset({"low", "very_low", "very low"})
LOW_CONFIDENCE_SCORE = 0.5

# For each condition check: which answer is the bad one, how to say it to a human, and whether that
# answer by itself means the person needs something from us.
#
# The polarity is not uniform and getting it wrong would invert the product: for `too_hot` the
# alarming answer is "yes", for `has_power` it is "no". And `someone_with_them = "no"` is context, not a need —
# living alone is most of this roster's normal Tuesday, and a well person on their own must still be
# able to come out of a sweep SAFE.
CHECK_ALARM: dict[str, tuple[str, str, bool]] = {
    "too_hot": ("yes", "it is dangerously hot inside their home", True),
    "too_cold": ("yes", "it is dangerously cold inside their home", True),
    "has_power": ("no", "no electricity in the home", True),
    "has_water": ("no", "no safe drinking water", True),
    "has_food": ("no", "no food they can eat today", True),
    "has_medication": ("no", "they do not have the medicine they need", True),
    "equipment_working": ("no", "powered medical equipment they depend on has stopped", True),
    "can_evacuate": ("no", "they could not leave the home under their own power", True),
    "someone_with_them": ("no", "nobody is with them and nobody is coming", False),
}

# The one check whose bad answer is urgent on its own, at any band. The extraction guidance only
# permits "no" from someone who actually uses powered medical equipment ("unknown" if they use none),
# so a "no" here is never a routine neighbour's answer — it is life support that has stopped.
LIFE_SUPPORT_CHECK = "equipment_working"

# The tri-states every decision looks at, whatever the hazard is.
CORE_FIELDS = ("reached_intended_person", "is_safe_now", "needs_help_now", "sounded_distressed")

# Where a decision sorts on the captain's board. Hand-written rather than computed, so that changing
# what "critical + unreachable" outranks is a visible edit to a table and not a side effect of
# retuning a coefficient. Read it as: the worst thing you can be told is that a neighbour the triage
# engine put hours from harm did not pick up the phone — a call you answered tells you what is wrong
# and lets the ladder start with information; silence there is unbounded.
PRIORITY: dict[CheckOutcome, dict[RiskBand, int]] = {
    CheckOutcome.UNREACHABLE:   {RiskBand.ROUTINE: 35, RiskBand.ELEVATED: 50, RiskBand.HIGH: 75, RiskBand.CRITICAL: 100},
    CheckOutcome.URGENT:        {RiskBand.ROUTINE: 60, RiskBand.ELEVATED: 70, RiskBand.HIGH: 85, RiskBand.CRITICAL: 95},
    CheckOutcome.NEEDS_HELP:    {RiskBand.ROUTINE: 25, RiskBand.ELEVATED: 35, RiskBand.HIGH: 50, RiskBand.CRITICAL: 65},
    CheckOutcome.HELP_DECLINED: {RiskBand.ROUTINE: 15, RiskBand.ELEVATED: 22, RiskBand.HIGH: 40, RiskBand.CRITICAL: 58},
    CheckOutcome.SAFE:          {RiskBand.ROUTINE: 0, RiskBand.ELEVATED: 1, RiskBand.HIGH: 2, RiskBand.CRITICAL: 3},
}


def priority_for(outcome: CheckOutcome, band: RiskBand) -> int:
    return PRIORITY[CheckOutcome(outcome)][RiskBand(band)]


@dataclass(frozen=True)
class DecisionResult:
    """The finding, why, and everything a human or the escalation ladder needs to act on it."""

    outcome: CheckOutcome
    reason: str
    # Verbatim, from the call. `concerns` are their own words; `last_words` is the single most
    # alarming sentence they said. Never paraphrase into either — the handoff packet reads them out.
    concerns: list[str] = field(default_factory=list)
    last_words: str = ""
    # Derived by this function: what we concluded, in sentences a volunteer can read.
    findings: list[str] = field(default_factory=list)
    checks: dict[str, str] = field(default_factory=dict)  # dotted path -> yes/no/unknown
    unresolved: list[str] = field(default_factory=list)   # facts this hazard needed and we never got
    help_accepted: list[str] = field(default_factory=list)
    help_declined: list[str] = field(default_factory=list)
    reached: str = "unknown"
    band: RiskBand = RiskBand.ELEVATED
    priority: int = 0

    @property
    def escalates(self) -> bool:
        """Anything that is not SAFE opens an escalation. Including, especially, silence."""
        return self.outcome is not CheckOutcome.SAFE

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome.value,
            "reason": self.reason,
            "concerns": list(self.concerns),
            "last_words": self.last_words,
            "findings": list(self.findings),
            "checks": dict(self.checks),
            "unresolved": list(self.unresolved),
            "help_accepted": list(self.help_accepted),
            "help_declined": list(self.help_declined),
            "reached": self.reached,
            "band": self.band.value,
            "priority": self.priority,
            "escalates": self.escalates,
        }


# ------------------------------------------------------------------------------------------------
# Reading the inputs. Everything here degrades; nothing raises. A decide() that throws means a call
# lands with no outcome at all, which is the one state this product must never produce.
# ------------------------------------------------------------------------------------------------
def _tri(result: Mapping[str, Any] | None, path: str) -> str:
    value = get_path(dict(result or {}), path, "unknown")
    text = str(value).strip().lower()
    return text if text in {"yes", "no", "unknown"} else "unknown"


def _strings(result: Mapping[str, Any] | None, key: str) -> list[str]:
    raw = (result or {}).get(key)
    return [s.strip() for s in raw if isinstance(s, str) and s.strip()] if isinstance(raw, list) else []


def _text(result: Mapping[str, Any] | None, key: str) -> str:
    raw = (result or {}).get(key)
    return raw.strip() if isinstance(raw, str) else ""


def read_risk(risk: Any) -> tuple[RiskBand, float | None, str]:
    """Normalise a risk assessment into (band, hours_to_harm, note).

    Accepts a `RiskAssessment`, the `to_dict()` form that lands in `Sweep.triage[nbr_id]` and
    `CheckCall.risk_snapshot` (which is what the runner usually has), or nothing at all. Missing or
    unreadable triage degrades to ELEVATED, never ROUTINE: not having scored someone is not evidence
    that they are fine, and it must not be the reason their unanswered call sorts to the bottom.
    """
    if risk is None:
        return RiskBand.ELEVATED, None, "no triage on file for this call; treated as elevated rather than routine"
    raw_band = risk.get("band") if isinstance(risk, Mapping) else getattr(risk, "band", None)
    hours = risk.get("time_to_harm_h") if isinstance(risk, Mapping) else getattr(risk, "time_to_harm_h", None)
    try:
        band = RiskBand(str(raw_band).strip().lower())
    except (ValueError, TypeError):
        return RiskBand.ELEVATED, None, f"triage band {raw_band!r} not understood; treated as elevated"
    return band, (float(hours) if isinstance(hours, (int, float)) else None), ""


def low_confidence(confidence: Mapping[str, Any] | None) -> bool:
    if not confidence:
        return False
    if str(confidence.get("label", "")).strip().lower() in LOW_CONFIDENCE_LABELS:
        return True
    score = confidence.get("score")
    return isinstance(score, (int, float)) and float(score) < LOW_CONFIDENCE_SCORE


def _silence_note(band: RiskBand, hours: float | None) -> str:
    """How much a captain should care that this particular person did not answer."""
    clock = f", and triage put them about {hours:g}h from harm" if hours is not None else ""
    if band is RiskBand.CRITICAL:
        return f"they are in the critical band{clock}: silence here is the strongest signal in this sweep, not a gap"
    if band is RiskBand.HIGH:
        return f"they are in the high band{clock}: do not close this sweep with them unaccounted for"
    return f"triage band {band.value}{clock}"


# ------------------------------------------------------------------------------------------------
def decide(
    *,
    status: str,
    result: Mapping[str, Any] | None,
    risk: Any = None,
    hard_fields: list[str] | None = None,
    validation_errors: list[str] | None = None,
    completion_confidence: Mapping[str, Any] | None = None,
    placed: bool = True,
) -> DecisionResult:
    """Map one finished call attempt onto a `CheckOutcome`. See the module table for every branch.

    `hard_fields` are the dotted paths this hazard made non-negotiable for this person (compiled by
    `app.calls.contract`). They mean "the call may not come home without this fact" — deliberately
    NOT "this must be yes". `checks.has_power == "no"` during a blackout is not a failed requirement,
    it is the finding the whole escalation ladder exists for.
    """
    hard_fields = list(hard_fields or [])
    validation_errors = list(validation_errors or [])
    band, hours, band_note = read_risk(risk)

    core = {f: _tri(result, f) for f in CORE_FIELDS}
    checks: dict[str, str] = dict(core)
    for path in hard_fields:
        checks[path] = _tri(result, path)
    for name in CHECK_ALARM:
        path = f"checks.{name}"
        if isinstance(result, Mapping) and name in (result.get("checks") or {}):
            checks[path] = _tri(result, path)

    concerns = _strings(result, "concerns")
    accepted = _strings(result, "help_accepted")
    declined = _strings(result, "help_declined")
    quote = _text(result, "alarming_quote")
    equipment_hours = _text(result, "equipment_hours_remaining")

    def finish(outcome: CheckOutcome, reason: str, findings: list[str] | None = None,
               unresolved: list[str] | None = None) -> DecisionResult:
        notes = list(findings or [])
        if band_note:
            notes.append(band_note)
        return DecisionResult(
            outcome=outcome,
            reason=reason,
            concerns=concerns,
            last_words=quote,
            findings=notes,
            checks=checks,
            unresolved=list(unresolved or []),
            help_accepted=accepted,
            help_declined=declined,
            reached=core["reached_intended_person"],
            band=band,
            priority=priority_for(outcome, band),
        )

    # -- silence -------------------------------------------------------------------------------
    # Rows 1 and 2. Note what is NOT here: no retry, no "skip and move on", no exception. The call
    # ends with an outcome on the record like every other call, because "we tried Rosa three times
    # and she has not picked up since two o'clock" is exactly what the evening is for.
    state = str(status or "").strip().upper()

    # A call task the provider never created is not a fact about this person. A live attempt came
    # back with "Call task creation was rejected: this call is framed as an emergency welfare check"
    # — our wording refused, nobody's phone rang — and the old code filed it as UNREACHABLE, which
    # put "nobody answered" against a man who was never dialled and opened a P1 deployment on the
    # strength of it. Same principle as SKIPPED: silence is a finding, but only once we have
    # actually rung. `placed` is false only when CALL-E definitely refused the create (a 4xx, no call
    # task). An ambiguous create or poll deadline is UNKNOWN and never reaches decide(): the caller
    # stops the roster on it first, because a missing provider id is not proof that no phone rang.
    if state != COMPLETED and not placed:
        return finish(
            CheckOutcome.UNREACHABLE,
            "no call was placed — the provider refused to create the call task, so this says nothing "
            "about them; fix the request and try again",
            findings=["call task never created"],
        )

    if state != COMPLETED:
        label = {
            "NO_ANSWER": "nobody answered",
            "FAILED": "the call failed to connect",
            "INVALID_RESULT": "the call connected but came back with no usable result",
        }.get(state, f"the call did not complete (status {state or 'UNKNOWN'})")
        return finish(CheckOutcome.UNREACHABLE, f"{label} — {_silence_note(band, hours)}",
                      findings=[f"call status {state or 'UNKNOWN'}"])
    if not isinstance(result, Mapping) or not result:
        return finish(CheckOutcome.UNREACHABLE,
                      f"the call completed but returned no schema-valid result, so nothing about them was established"
                      f" — {_silence_note(band, hours)}",
                      findings=["provider reported COMPLETED with no structured result"])

    # -- alarms, before the reached-them gate ---------------------------------------------------
    # Rows 3-6. See the module docstring: a carer answering to say "she's on the floor" must not be
    # filed as "we didn't reach her".
    alarms: list[str] = []
    if core["is_safe_now"] == "no":
        alarms.append("the call concluded they are not safe where they are")
    if checks.get(f"checks.{LIFE_SUPPORT_CHECK}") == "no":
        detail = f" (they said it had {equipment_hours} left)" if equipment_hours else ""
        alarms.append(f"powered medical equipment they depend on has stopped{detail}")
    if core["sounded_distressed"] == "yes":
        # Deliberately not softened by is_safe_now. Someone who cannot follow the conversation cannot
        # tell us whether they are safe, so a reassurance from them is not evidence of anything.
        alarms.append("they sounded frightened, confused, or unwell on the call")
    bad_checks = [
        (path, sentence)
        for name, (bad, sentence, is_need) in CHECK_ALARM.items()
        if (path := f"checks.{name}") in checks and checks[path] == bad and is_need
    ]
    if band is RiskBand.CRITICAL and bad_checks:
        # At the critical band the triage engine has already said harm is plausible within hours for
        # this person under this hazard. A negative on any fact the hazard made non-negotiable is not
        # a to-do item for tomorrow; it is the thing happening.
        clock = f" and triage put them about {hours:g}h from harm" if hours is not None else ""
        alarms.append(f"critical band{clock}: " + "; ".join(s for _, s in bad_checks))
    if alarms:
        # ShiftFill's contradiction rule, ported. There it bought a human review; here there is no
        # hold, so it resolves against the reassurance and says so.
        head = ("they told us they were safe, but " if core["is_safe_now"] == "yes" else "")
        return finish(CheckOutcome.URGENT, head + "; ".join(alarms), findings=list(alarms))

    # -- did we actually speak to them? ---------------------------------------------------------
    # Row 7. Everything below this line is an answer *about the person*, which is worth nothing if we
    # were talking to their voicemail. Above this line were answers about the situation, which are
    # worth something no matter who said them.
    if core["reached_intended_person"] != "yes":
        who = ("voicemail, a call screener, or somebody else answered"
               if core["reached_intended_person"] == "no"
               else "the call could not establish who was on the line")
        return finish(CheckOutcome.UNREACHABLE, f"{who}, so they were not personally checked on"
                      f" — {_silence_note(band, hours)}",
                      findings=[who], unresolved=[f for f in hard_fields if checks.get(f) == "unknown"])

    # -- reached, nothing alarming: do they need something? -------------------------------------
    # Rows 8-10.
    needs = [s for _, s in bad_checks]
    if core["needs_help_now"] == "yes":
        needs.append("they said there is something they need today that they cannot get themselves")
    context = [sentence for name, (bad, sentence, is_need) in CHECK_ALARM.items()
               if not is_need and checks.get(f"checks.{name}") == bad]
    if needs:
        if accepted:
            return finish(CheckOutcome.NEEDS_HELP,
                          f"{'; '.join(needs)}; they accepted {', '.join(accepted)}",
                          findings=needs + context)
        if declined:
            # Their refusal is theirs to make. It is recorded exactly as it happened and it does not
            # become NEEDS_HELP because we would rather they had said yes — but it is not SAFE either,
            # so a human still sees them on the board and can knock on the door tomorrow.
            return finish(CheckOutcome.HELP_DECLINED,
                          f"{'; '.join(needs)}; they turned down {', '.join(declined)}",
                          findings=needs + context)
        offered = _tri(result, "help_offers_stated")
        tail = ("no help was offered on the call" if offered != "yes"
                else "they neither accepted nor turned down what was offered")
        return finish(CheckOutcome.NEEDS_HELP, f"{'; '.join(needs)}; {tail}", findings=needs + context)

    # -- reached, no need found: is what we know good enough to say SAFE? ------------------------
    # The residue row. Everything that could stop us from asserting SAFE is gathered rather than
    # short-circuited, because the captain wants the whole list of what we could not establish.
    unresolved = [f for f in hard_fields if checks.get(f, "unknown") == "unknown"]
    if core["is_safe_now"] == "unknown":
        unresolved.append("is_safe_now")
    if core["needs_help_now"] == "unknown":
        unresolved.append("needs_help_now")
    blockers = [f"could not establish {f.split('.')[-1].replace('_', ' ')}" for f in unresolved]
    if validation_errors:
        blockers.append(f"the result failed schema validation ({validation_errors[0]})")
    if low_confidence(completion_confidence):
        label = (completion_confidence or {}).get("label") or (completion_confidence or {}).get("score")
        blockers.append(f"CALL-E reported low confidence in this call ({label})")
    if blockers:
        outcome = CheckOutcome.URGENT if band in (RiskBand.CRITICAL, RiskBand.HIGH) else CheckOutcome.NEEDS_HELP
        # Say what we failed to learn, never that they asked for something. A captain must be able to
        # tell "her cooler might be dead and we don't know" from "she asked for water".
        return finish(outcome,
                      f"spoke to them and nothing they said was alarming, but {'; '.join(blockers)}"
                      f" — {_silence_note(band, hours)}",
                      findings=blockers + context, unresolved=unresolved)

    return finish(CheckOutcome.SAFE,
                  "spoke to them, everything this hazard put at stake was established, and they need nothing today",
                  findings=context)
