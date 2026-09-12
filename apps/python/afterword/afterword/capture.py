"""The grade. Computed here, in code, and nowhere else.

The language model extracts what was said on the call. This module turns that
into a grade for one institution. The model never emits a grade, never decides
whether an answer contradicts a published policy, and is never asked whether
the account can now be closed.

Three rules hold everywhere in this file and are tested directly:

1. No grade means the account is closed, the service is cancelled, or the
   family is finished with this institution. The strongest thing Afterword says
   is that a requirement was captured and quoted.
2. A contradiction is never resolved. It is reported as DISPUTED with both
   sides intact; see `conflict.py`.
3. REFERRED is a normal outcome, not a failure. An institution that will only
   speak to the named executor is behaving correctly.
"""

from __future__ import annotations

from datetime import datetime, timezone

from . import conflict as conflict_mod
from .models import (
    CaptureResult,
    Conflict,
    Estate,
    Grade,
    Institution,
    Observations,
    PriorCall,
    Reached,
    Requirement,
    Ternary,
)

#: Everything that is not a person on the line. None of these is evidence about
#: what the institution requires; they are evidence about the phone system.
NOT_REACHED = {
    Reached.IVR_DEAD_END,
    Reached.VOICEMAIL,
    Reached.NO_ANSWER,
    Reached.QUEUE_ABANDONED,
    Reached.UNKNOWN,
}


def capture(
    estate: Estate,
    institution: Institution,
    observed: Observations,
    run_id: str,
    priors: tuple[PriorCall, ...] = (),
    call_id: str | None = None,
    now: datetime | None = None,
) -> CaptureResult:
    """Grade one completed call to one institution.

    Checks run in a fixed order and the first one that fires decides, so the
    order is the design: silence establishes nothing, a contradiction outranks
    a referral because dropping it is the expensive error, and a captured
    requirement is only ever the last thing left.
    """
    stamped = now or datetime.now(timezone.utc)
    stated = observed.as_requirement()
    quote = observed.evidence_quotes[0] if observed.evidence_quotes else ""

    def result(
        chosen: Grade,
        *reasons: str,
        requirement: Requirement | None = None,
        conflicts: tuple[Conflict, ...] = (),
    ) -> CaptureResult:
        return CaptureResult(
            estate_id=estate.estate_id,
            institution_id=institution.institution_id,
            run_id=run_id,
            captured_at=stamped,
            grade=chosen,
            reasons=tuple(reasons),
            requirement=requirement,
            conflicts=conflicts,
            evidence_quotes=observed.evidence_quotes,
            call_id=call_id,
        )

    # Nobody spoke. A phone system says nothing about a document requirement.
    if observed.reached in NOT_REACHED:
        return result(Grade.UNREACHED, f"not_reached_{observed.reached.value}")

    conflicts = conflict_mod.detect(stated, institution, priors, quote)

    # A contradiction outranks everything a person did say. Recording the
    # requirement and dropping the dispute is the failure this project exists
    # to prevent, and it stays visible even when the call also ended in a
    # referral.
    if conflicts:
        return result(
            Grade.DISPUTED,
            *sorted({c.reason for c in conflicts}),
            requirement=stated,
            conflicts=conflicts,
        )

    # The institution is entitled to refuse. Report it, do not work around it.
    if observed.executor_only is Ternary.YES:
        return result(
            Grade.REFERRED,
            "institution_will_speak_only_to_named_executor",
            requirement=None if stated.empty else stated,
        )

    gaps = stated.missing
    if gaps:
        return result(
            Grade.PARTIAL,
            "reached_a_person",
            *(f"unanswered_{name}" for name in gaps),
            requirement=stated,
        )

    return result(
        Grade.REQUIREMENTS_CAPTURED,
        "department_named",
        f"documents_named_{len(stated.documents_needed)}",
        "certified_copy_answered",
        "direct_debits_answered",
        requirement=stated,
    )
