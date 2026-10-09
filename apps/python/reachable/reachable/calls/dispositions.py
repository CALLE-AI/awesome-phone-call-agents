"""Bound result -> next state, failing closed.

Collapses raw CALL-E signals into one closed disposition set, then maps a
confirmed disposition onto a machine event.

Two properties this module exists to guarantee:

* **The default is NEEDS_HUMAN.** Every path that does not positively match one
  of the other dispositions falls through to it, never to CONFIRMED.
* **Urgent is decided before everything else.** For a pattern follow-up, a sign
  that the contact did not know about the absence, or says they do not know
  where the pupil is, escalates regardless of what else the call produced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..models import Disposition, Workflow
from ..machines import contact_check as cc
from ..machines import pattern_followup as pf
from .binding import Evidence, Intent, bind, gather_evidence
from .contracts import validate_result

#: The CALL-E Developer API status vocabulary -- the one Reachable consumes.
#: The CLI and MCP surface uses a different, uppercase vocabulary including
#: NO_ANSWER and VOICEMAIL that does not map one-to-one onto this one. Any value
#: from it reaching here is malformed, never coerced.
API_STATUSES = frozenset({"queued", "in_progress", "completed", "failed", "canceled"})
NON_TERMINAL = frozenset({"queued", "in_progress"})

WEBHOOK_EVENT_TYPES = frozenset(
    {"call.completed", "call.failed", "call.result_validation_failed"}
)

#: Documented only by example, so not an enum. Checked as well as the score.
ACCEPTABLE_LABELS = frozenset({"medium", "high"})


@dataclass(frozen=True)
class Classification:
    disposition: Disposition
    reason: str
    #: Field NAMES only. An audit row names what came back, not its value.
    fields: tuple[str, ...] = ()
    evidence: Evidence | None = None
    result: Mapping[str, Any] | None = None

    @property
    def actionable(self) -> bool:
        return self.disposition is Disposition.CONFIRMED


#: Outcomes where no conversation took place. Nothing was said, so there is
#: nothing to misinterpret, and the only action that follows is to try the next
#: contact or stop.
NON_CONTACT_OUTCOMES = frozenset({"voicemail", "no_answer", "not_in_service"})


def _non_contact_outcome(workflow: Workflow, result: Any) -> str | None:
    """Return the outcome when the result is a schema-valid non-contact one.

    Returns None for anything else, including a malformed result -- so a result
    that cannot be validated never takes this relaxed path.
    """
    if not isinstance(result, Mapping) or not result:
        return None
    if validate_result(workflow, result):
        return None
    outcome = result.get("outcome")
    return outcome if outcome in NON_CONTACT_OUTCOMES else None


def _confidence(snapshot: Mapping[str, Any]) -> tuple[float | None, str | None]:
    raw = snapshot.get("completion_confidence")
    if not isinstance(raw, Mapping):
        return None, None
    score = raw.get("score")
    label = raw.get("label")
    numeric = (
        float(score)
        if isinstance(score, (int, float)) and not isinstance(score, bool)
        else None
    )
    return numeric, label if isinstance(label, str) else None


def classify(
    snapshot: Any,
    *,
    workflow: Workflow,
    intent: Intent,
    confidence_floor: float,
    event_type: str | None = None,
) -> Classification:
    """Turn one authoritative call snapshot into a disposition."""
    if not isinstance(snapshot, Mapping):
        return Classification(Disposition.NEEDS_HUMAN, "unreadable call payload")

    if event_type is not None and event_type not in WEBHOOK_EVENT_TYPES:
        return Classification(
            Disposition.NEEDS_HUMAN, f"unrecognised event type {event_type!r}"
        )

    status = snapshot.get("status")
    if not isinstance(status, str) or status not in API_STATUSES:
        # Includes the uppercase CLI/MCP vocabulary.
        return Classification(Disposition.NEEDS_HUMAN, f"unrecognised call status {status!r}")

    if status in NON_TERMINAL:
        return Classification(Disposition.OUTCOME_UNKNOWN, f"call is still {status}")

    # Binding before anything else terminal: a snapshot that is not ours cannot
    # be allowed to move a case, whatever it says.
    binding = bind(snapshot, intent)
    if not binding.ok:
        return Classification(Disposition.NEEDS_HUMAN, binding.reason_text)

    evidence = gather_evidence(binding.matched_attempt)

    if event_type == "call.result_validation_failed":
        return Classification(
            Disposition.RESULT_INVALID,
            "provider could not validate the result schema",
            evidence=evidence,
        )
    if status == "canceled":
        return Classification(
            Disposition.CANCELED, "call was canceled before it completed", evidence=evidence
        )
    if status == "failed" or event_type == "call.failed":
        failure_code = snapshot.get("failure_code")
        # Logged verbatim for a human, never branched on: there is no published
        # enum, and a generic failure is not evidence that anybody declined.
        detail = f" (failure_code: {failure_code})" if failure_code else ""
        return Classification(Disposition.FAILED, f"call failed{detail}", evidence=evidence)

    task_completed = snapshot.get("task_completed")
    if task_completed is not True:
        # Observed on a live call: CALL-E reports task_completed False when
        # nobody answered, while still returning a schema-valid result whose
        # outcome says exactly that. "Nobody picked up" is the task completing
        # in the only way it could, and reading it is what lets the cascade
        # advance and the attempt budget mean something -- otherwise every
        # ordinary no-answer lands in the human queue.
        #
        # Deliberately narrow: this applies only to outcomes where no
        # conversation happened, so there is nothing to misinterpret and no
        # action follows except trying the next contact or giving up. A
        # `reached` result still requires task_completed True before anything
        # can be concluded from what was said.
        non_contact = _non_contact_outcome(workflow, snapshot.get("structured_result"))
        if non_contact is None:
            return Classification(
                Disposition.REVIEW_REQUIRED,
                f"task_completed is {task_completed!r}, not a clear completion",
                evidence=evidence,
            )
        return Classification(
            Disposition.CONFIRMED,
            f"no contact established ({non_contact}); the provider reported it clearly",
            fields=tuple(sorted(snapshot["structured_result"])),
            evidence=evidence,
            result=snapshot["structured_result"],
        )

    score, label = _confidence(snapshot)
    if score is None:
        return Classification(
            Disposition.REVIEW_REQUIRED,
            "no completion_confidence on a terminal call",
            evidence=evidence,
        )
    if score < confidence_floor:
        return Classification(
            Disposition.REVIEW_REQUIRED,
            f"confidence score {score:.2f} below floor {confidence_floor:.2f}",
            evidence=evidence,
        )
    if label is not None and label.lower() not in ACCEPTABLE_LABELS:
        return Classification(
            Disposition.REVIEW_REQUIRED,
            f"confidence label {label!r} is not acceptable",
            evidence=evidence,
        )

    result = snapshot.get("structured_result")
    if result is None:
        return Classification(
            Disposition.REVIEW_REQUIRED, "structured_result is null", evidence=evidence
        )
    if isinstance(result, Mapping) and not result:
        return Classification(
            Disposition.REVIEW_REQUIRED, "structured_result is empty", evidence=evidence
        )

    problems = validate_result(workflow, result)
    if problems:
        return Classification(
            Disposition.RESULT_INVALID, "; ".join(problems), evidence=evidence
        )

    return Classification(
        Disposition.CONFIRMED,
        "terminal, bound, confident and schema-valid",
        fields=tuple(sorted(result)),
        evidence=evidence,
        result=result,
    )


# --------------------------------------------------------------------------
# Disposition -> machine event
# --------------------------------------------------------------------------


def contact_check_event(classification: Classification) -> cc.CCEvent:
    """Map a classified contact-check result onto a machine event."""
    if classification.disposition is Disposition.OUTCOME_UNKNOWN:
        return cc.CCEvent.SUBMISSION_UNKNOWN
    if classification.disposition is not Disposition.CONFIRMED:
        return cc.CCEvent.RESULT_NEEDS_HUMAN

    result = classification.result or {}
    evidence = classification.evidence
    outcome = result.get("outcome")

    if outcome in {"voicemail", "no_answer"}:
        return cc.CCEvent.RESULT_NO_CONTACT
    if outcome == "not_in_service":
        return cc.CCEvent.RESULT_NOT_IN_SERVICE
    if outcome == "wrong_person" or result.get("identity_confirmed") == "no":
        return cc.CCEvent.RESULT_WRONG_PERSON
    if outcome != "reached":
        return cc.CCEvent.RESULT_NEEDS_HUMAN

    # A language note overrides a success: a contact who struggled in English may
    # have agreed to something they did not fully follow.
    if str(result.get("language_preference_note", "")).strip():
        return cc.CCEvent.RESULT_NEEDS_HUMAN

    if result.get("identity_confirmed") != "yes":
        return cc.CCEvent.RESULT_NEEDS_HUMAN
    # The transcript condition. A claimed identity with no recipient-spoken turn
    # behind it is not a confirmed identity.
    if evidence is None or not evidence.identity_confirmed:
        return cc.CCEvent.RESULT_NEEDS_HUMAN

    if result.get("best_number_for_school") == "wants_to_update":
        return cc.CCEvent.RESULT_UPDATE_REQUESTED
    if result.get("still_willing_to_be_contact") == "no":
        return cc.CCEvent.RESULT_NO_LONGER_CONTACT
    if result.get("still_willing_to_be_contact") != "yes":
        return cc.CCEvent.RESULT_NEEDS_HUMAN
    if result.get("best_number_for_school") != "this_number":
        return cc.CCEvent.RESULT_NEEDS_HUMAN
    return cc.CCEvent.RESULT_VERIFIED


def is_urgent(result: Mapping[str, Any]) -> bool:
    """The escalation rule, decided before every other branch.

    Awareness is the primary signal and escalates on ``unknown`` as well as
    ``no``: "we could not establish whether this adult knew their child was
    missing from school" is not a neutral result.

    Whereabouts is secondary and asymmetric. An explicit ``no`` escalates on its
    own; ``unknown`` does not, because the question often does not arise in a
    call where the contact clearly knew about the absence. A stated "I don't
    know" is evidence; a question that never came up is not.
    """
    if result.get("aware_of_absence") != "yes":
        return True
    if result.get("knows_child_whereabouts") == "no":
        return True
    return False


def pattern_event(classification: Classification) -> pf.PFEvent:
    """Map a classified pattern follow-up result onto a machine event."""
    if classification.disposition is Disposition.OUTCOME_UNKNOWN:
        return pf.PFEvent.SUBMISSION_UNKNOWN
    if classification.disposition is not Disposition.CONFIRMED:
        return pf.PFEvent.RESULT_NEEDS_HUMAN

    result = classification.result or {}
    evidence = classification.evidence
    outcome = result.get("outcome")

    # Non-contact outcomes first: there is no conversation to escalate about.
    if outcome in {"voicemail", "no_answer"}:
        return pf.PFEvent.RESULT_NO_CONTACT
    if outcome == "not_in_service":
        return pf.PFEvent.RESULT_NOT_IN_SERVICE
    if outcome == "wrong_person" or result.get("identity_confirmed") == "no":
        return pf.PFEvent.RESULT_WRONG_PERSON
    if outcome != "reached":
        return pf.PFEvent.RESULT_NEEDS_HUMAN

    # Urgent is evaluated before identity binding and before every other
    # branch. Fail-closed here means escalating on weak evidence, not
    # withholding on it: if somebody may not know where a child is, a person
    # needs to know now, whatever the transcript check says.
    if is_urgent(result):
        return pf.PFEvent.RESULT_URGENT

    if result.get("identity_confirmed") != "yes":
        return pf.PFEvent.RESULT_NEEDS_HUMAN
    if evidence is None or not evidence.identity_confirmed:
        return pf.PFEvent.RESULT_NEEDS_HUMAN

    if result.get("reason_category") == "prefers_to_speak_to_staff":
        return pf.PFEvent.RESULT_SUPPORT_REQUESTED
    if (
        result.get("barrier_mentioned") == "yes"
        or result.get("wants_call_from_attendance_officer") == "yes"
    ):
        return pf.PFEvent.RESULT_SUPPORT_REQUESTED
    reason = result.get("reason_category")
    if reason and reason != "unknown":
        return pf.PFEvent.RESULT_REASON_GIVEN
    return pf.PFEvent.RESULT_NEEDS_HUMAN
