"""The verdict. Computed here, in code, and nowhere else.

The language model extracts observations from a call. This module turns those
observations into a grade. The model never emits a grade, never emits the word
alive, and never decides whether a challenge was answered correctly.

Two rules hold everywhere in this file and are tested directly:

1. No grade concludes that anybody has died. The strongest statement Muster
   makes about a death is CONTRA, meaning a person must look at this.
2. Only CONFIRMED_LIVE closes an attestation on its own. Nothing here can stop
   a payment; see `Attestation.stops_payment`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from . import coaching, nonce as nonce_mod
from .models import (
    Attestation,
    Endpoint,
    Grade,
    KnowledgePrompt,
    Nonce,
    Observations,
    Subject,
    Ternary,
)

#: Endpoints that mean the subject was never reached at all.
NOT_REACHED = {Endpoint.NO_ANSWER, Endpoint.VOICEMAIL, Endpoint.IVR, Endpoint.UNKNOWN}


def score_prompt(prompt: KnowledgePrompt, given: str) -> bool:
    """Compare one spoken answer with what was enrolled.

    Normalised the same way as the nonce, so an ASR transcription difference
    never fails a living person.
    """
    if not given:
        return False
    return nonce_mod.normalise(given) == nonce_mod.normalise(prompt.expected)


def score_prompts(
    asked: tuple[KnowledgePrompt, ...], observed: Observations
) -> tuple[int, int, bool]:
    """Return (passed, asked, any_co_resident_safe_passed)."""
    passed = 0
    safe_passed = False
    for prompt in asked:
        given = observed.prompt_answers.get(prompt.prompt_id, "")
        if score_prompt(prompt, given):
            passed += 1
            if prompt.co_resident_safe:
                safe_passed = True
    return passed, len(asked), safe_passed


def grade(
    subject: Subject,
    observed: Observations,
    issued_nonce: Nonce,
    asked_prompts: tuple[KnowledgePrompt, ...],
    run_id: str,
    call_id: str | None = None,
    now: datetime | None = None,
) -> Attestation:
    """Grade one completed call.

    Checks run in a fixed order. The first one that fires decides the grade, so
    the order encodes what matters most: never fail a person for being
    disabled, never read silence as proof, never accept a relative's word.
    """
    stamped = now or datetime.now(timezone.utc)
    # None means the challenge was never put to anybody. Recording False there
    # would read as a wrong answer rather than an unasked question.
    challenge_reached = (
        observed.answered_by is Endpoint.SUBJECT
        and observed.claimed_to_be_subject is Ternary.YES
    )
    nonce_ok = nonce_mod.check(issued_nonce, observed) if challenge_reached else None
    reverse_ok = nonce_mod.check_reversed(issued_nonce, observed) if challenge_reached else None
    coached, coaching_signals = coaching.suspected(observed)
    passed, total, safe_passed = score_prompts(asked_prompts, observed)

    def result(chosen: Grade, *reasons: str) -> Attestation:
        return Attestation(
            subject_id=subject.subject_id,
            run_id=run_id,
            graded_at=stamped,
            grade=chosen,
            reasons=tuple(reasons),
            evidence_quotes=observed.evidence_quotes,
            nonce_ok=nonce_ok,
            reverse_ok=reverse_ok,
            challenges_passed=passed,
            challenges_asked=total,
            coaching_suspected=coached,
            call_id=call_id,
        )

    # A subject enrolled as needing a human is never failed by a machine.
    if subject.accessibility.requires_human_path:
        return result(Grade.NEEDS_HUMAN, "enrolled_accessibility_route")

    # Silence is not evidence of anything.
    if observed.answered_by in NOT_REACHED:
        return result(Grade.UNPROVEN, f"not_reached_{observed.answered_by.value}")

    # The line may no longer belong to the subject.
    if observed.wrong_number is Ternary.YES:
        return result(Grade.CONTRA, "line_may_be_reassigned")

    # Somebody said the subject has died. Muster does not conclude that.
    if observed.subject_reported_dead is Ternary.YES:
        return result(Grade.CONTRA, "death_reported_requires_human_verification")

    # The Kato case: a relative vouching is not evidence that anyone is alive.
    if observed.answered_by is Endpoint.THIRD_PARTY:
        return result(Grade.THIRD_PARTY_CLAIM, "third_party_vouched_not_evidence_of_life")

    if observed.distress_or_confusion is Ternary.YES:
        return result(Grade.NEEDS_HUMAN, "distress_or_confusion_heard")

    if coached:
        return result(Grade.NEEDS_HUMAN, "coaching_suspected", *coaching_signals)

    if observed.claimed_to_be_subject is not Ternary.YES:
        return result(Grade.UNPROVEN, "no_self_identification_under_disclosure")

    # A recording cannot answer a question minted seconds ago.
    if nonce_ok is not True:
        return result(Grade.UNPROVEN, "freshness_challenge_failed")

    # Echoing forwards is within reach of a recording. Saying the words back
    # in reverse is not, so this is the leg that carries a confirmation.
    if reverse_ok is not True:
        return result(Grade.PRESUMED_LIVE_WEAK, "reverse_challenge_not_satisfied")

    if total == 0:
        return result(
            Grade.CONFIRMED_LIVE,
            "self_identified",
            "freshness_challenge_passed",
            "reverse_challenge_passed",
        )

    if passed < total:
        return result(
            Grade.PRESUMED_LIVE_WEAK,
            f"knowledge_challenge_partial_{passed}_of_{total}",
        )

    # Everything a housemate could also answer leaves impersonation open.
    if not safe_passed:
        return result(
            Grade.PRESUMED_LIVE_WEAK,
            "no_co_resident_safe_prompt_passed",
        )

    return result(
        Grade.CONFIRMED_LIVE,
        "self_identified",
        "freshness_challenge_passed",
        "reverse_challenge_passed",
        f"knowledge_challenge_passed_{passed}_of_{total}",
    )
