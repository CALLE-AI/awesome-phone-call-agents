"""The verdict engine.

Every branch, and the order between them. The order is the safety design: a
disabled subject is never failed by a machine, silence is never read as proof,
and a relative's word is never a pass. A test that only checked grades would
miss that, so each case asserts the named reason too — the reason is what a
caseworker reads.

The reverse leg sits between the freshness check and the knowledge checks, and
it is what carries a confirmation now that the platform refuses to ask security
questions at all. Its position in the order is asserted here, not assumed.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from muster.grading import grade, score_prompt, score_prompts
from muster.models import (
    Accessibility,
    Attestation,
    Endpoint,
    Grade,
    KnowledgePrompt,
    Observations,
    Subject,
    Ternary,
)
from tests.builders import (
    NONCE,
    PET,
    PROMPTS,
    RUN_ID,
    STREET,
    coached_turns,
    correct_answers,
    forward_only_observations,
    make_observations,
    make_subject,
)

FIXED_NOW = datetime(2026, 9, 8, 9, 30, tzinfo=timezone.utc)


def grade_call(
    observed: Observations,
    subject: Subject | None = None,
    asked: tuple[KnowledgePrompt, ...] = PROMPTS,
) -> Attestation:
    return grade(
        subject or make_subject(),
        observed,
        NONCE,
        asked,
        RUN_ID,
        call_id="call-0001",
        now=FIXED_NOW,
    )


# --------------------------------------------------------------------------
# Prompt scoring
# --------------------------------------------------------------------------


def test_score_prompt_normalises_the_spoken_answer() -> None:
    assert score_prompt(PET, "biscuit") is True
    assert score_prompt(PET, " Biscuit! ") is True
    assert score_prompt(STREET, "marlborough road") is True


def test_score_prompt_rejects_a_wrong_or_missing_answer() -> None:
    assert score_prompt(PET, "Rover") is False
    assert score_prompt(PET, "") is False


def test_score_prompts_counts_and_flags_co_resident_safety() -> None:
    observed = make_observations()
    assert score_prompts(PROMPTS, observed) == (2, 2, True)


def test_score_prompts_reports_no_safe_pass_when_only_the_unsafe_one_passed() -> None:
    observed = make_observations(prompt_answers={"street": STREET.expected})
    assert score_prompts(PROMPTS, observed) == (1, 2, False)


def test_score_prompts_on_nothing_asked() -> None:
    assert score_prompts((), make_observations()) == (0, 0, False)


# --------------------------------------------------------------------------
# Accessibility — the first check, and it beats everything
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "flag",
    ["hearing_impaired", "speech_impaired", "cognitive_impairment", "needs_interpreter"],
)
def test_each_enrolled_accessibility_flag_routes_to_a_human(flag: str) -> None:
    subject = make_subject(accessibility=Accessibility(**{flag: True}))
    result = grade_call(make_observations(), subject=subject)
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.reasons == ("enrolled_accessibility_route",)


def test_accessibility_beats_a_perfect_call() -> None:
    """A subject enrolled as needing a human is never graded by a machine, even
    when the machine would have passed them."""
    subject = make_subject(accessibility=Accessibility(cognitive_impairment=True))
    result = grade_call(make_observations(), subject=subject)
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.grade is not Grade.CONFIRMED_LIVE


def test_accessibility_beats_not_reached() -> None:
    subject = make_subject(accessibility=Accessibility(needs_interpreter=True))
    result = grade_call(
        make_observations(answered_by=Endpoint.NO_ANSWER), subject=subject
    )
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.reasons == ("enrolled_accessibility_route",)


def test_accessibility_beats_a_reported_death() -> None:
    subject = make_subject(accessibility=Accessibility(hearing_impaired=True))
    result = grade_call(
        make_observations(subject_reported_dead=Ternary.YES), subject=subject
    )
    assert result.grade is Grade.NEEDS_HUMAN


# --------------------------------------------------------------------------
# Not reached — silence is not evidence
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "endpoint",
    [Endpoint.NO_ANSWER, Endpoint.VOICEMAIL, Endpoint.IVR, Endpoint.UNKNOWN],
)
def test_an_unreached_endpoint_is_unproven_and_says_which(endpoint: Endpoint) -> None:
    result = grade_call(make_observations(answered_by=endpoint))
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == (f"not_reached_{endpoint.value}",)


def test_voicemail_is_not_a_pass_even_with_a_perfect_transcript() -> None:
    """A greeting recorded in the subject's own voice reaches this branch first."""
    result = grade_call(make_observations(answered_by=Endpoint.VOICEMAIL))
    assert result.grade is Grade.UNPROVEN
    assert result.grade is not Grade.CONFIRMED_LIVE


def test_not_reached_beats_a_wrong_number_report() -> None:
    result = grade_call(
        make_observations(answered_by=Endpoint.IVR, wrong_number=Ternary.YES)
    )
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("not_reached_ivr",)


# --------------------------------------------------------------------------
# Contra — the line, and the death report
# --------------------------------------------------------------------------


def test_wrong_number_is_contra() -> None:
    result = grade_call(make_observations(wrong_number=Ternary.YES))
    assert result.grade is Grade.CONTRA
    assert result.reasons == ("line_may_be_reassigned",)


def test_a_reported_death_is_contra_and_never_a_verdict_of_death() -> None:
    """CONTRA means "a human must look at this". There is deliberately no grade
    that concludes somebody has died."""
    result = grade_call(make_observations(subject_reported_dead=Ternary.YES))
    assert result.grade is Grade.CONTRA
    assert result.reasons == ("death_reported_requires_human_verification",)
    assert result.grade.value == "CONTRA"
    assert "DEAD" not in result.grade.name
    assert not result.auto_closes
    assert result.stops_payment is False


def test_wrong_number_beats_a_reported_death() -> None:
    """If the line is not theirs, whatever the stranger said about a death is
    about somebody else."""
    result = grade_call(
        make_observations(wrong_number=Ternary.YES, subject_reported_dead=Ternary.YES)
    )
    assert result.grade is Grade.CONTRA
    assert result.reasons == ("line_may_be_reassigned",)


# --------------------------------------------------------------------------
# Third party — the Sogen Kato case
# --------------------------------------------------------------------------


def test_a_third_party_vouching_is_never_a_pass() -> None:
    """The Sogen Kato case (Tokyo, 2010): Kato had been dead in his bedroom
    since 1978 while his family drew his pension and told every caller he was
    fine. A relative who answers, sounds well, knows the enrolled answers and
    repeats the nonce back perfectly still establishes nothing about the
    subject. Passing everything must not upgrade this grade."""
    result = grade_call(make_observations(answered_by=Endpoint.THIRD_PARTY))
    assert result.grade is Grade.THIRD_PARTY_CLAIM
    assert result.reasons == ("third_party_vouched_not_evidence_of_life",)
    assert result.nonce_ok is None  # the challenge was never put to the subject
    assert result.challenges_passed == result.challenges_asked == 2
    assert not result.auto_closes


def test_a_wrong_number_beats_a_third_party() -> None:
    result = grade_call(
        make_observations(answered_by=Endpoint.THIRD_PARTY, wrong_number=Ternary.YES)
    )
    assert result.grade is Grade.CONTRA
    assert result.reasons == ("line_may_be_reassigned",)


def test_a_reported_death_beats_a_third_party() -> None:
    """The relative who says "he passed away last year" must not be filed as a
    routine third-party claim."""
    result = grade_call(
        make_observations(
            answered_by=Endpoint.THIRD_PARTY, subject_reported_dead=Ternary.YES
        )
    )
    assert result.grade is Grade.CONTRA
    assert result.reasons == ("death_reported_requires_human_verification",)


def test_a_third_party_beats_distress_and_coaching() -> None:
    result = grade_call(
        make_observations(
            answered_by=Endpoint.THIRD_PARTY,
            distress_or_confusion=Ternary.YES,
            turns=coached_turns(),
        )
    )
    assert result.grade is Grade.THIRD_PARTY_CLAIM
    assert result.coaching_suspected is True


# --------------------------------------------------------------------------
# Needs human — distress and coaching
# --------------------------------------------------------------------------


def test_distress_or_confusion_routes_to_a_human() -> None:
    result = grade_call(make_observations(distress_or_confusion=Ternary.YES))
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.reasons == ("distress_or_confusion_heard",)


def test_detected_coaching_routes_to_a_human_and_names_the_signal() -> None:
    result = grade_call(make_observations(turns=coached_turns()))
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.reasons[0] == "coaching_suspected"
    assert "unattributed_voice_between_question_and_answer" in result.reasons
    assert result.coaching_suspected is True


def test_distress_beats_coaching() -> None:
    result = grade_call(
        make_observations(distress_or_confusion=Ternary.YES, turns=coached_turns())
    )
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.reasons == ("distress_or_confusion_heard",)


def test_coaching_beats_a_missing_self_identification() -> None:
    result = grade_call(
        make_observations(claimed_to_be_subject=Ternary.NO, turns=coached_turns())
    )
    assert result.grade is Grade.NEEDS_HUMAN
    assert result.reasons[0] == "coaching_suspected"


def test_coaching_only_ever_downgrades() -> None:
    """The heuristic must never turn a weaker grade into a stronger one."""
    clean = grade_call(make_observations())
    coached = grade_call(make_observations(turns=coached_turns()))
    assert clean.grade is Grade.CONFIRMED_LIVE
    assert coached.grade is Grade.NEEDS_HUMAN


# --------------------------------------------------------------------------
# Unproven — identification and freshness
# --------------------------------------------------------------------------


@pytest.mark.parametrize("claim", [Ternary.NO, Ternary.UNKNOWN])
def test_without_self_identification_nothing_is_proven(claim: Ternary) -> None:
    """`unknown` is a real answer here, never a silent yes."""
    result = grade_call(make_observations(claimed_to_be_subject=claim))
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("no_self_identification_under_disclosure",)


def test_a_failed_freshness_challenge_is_unproven() -> None:
    """The voicemail-recording defence: a recording cannot answer a question
    minted seconds before the call."""
    result = grade_call(make_observations(nonce_words_heard=("river", "table")))
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("freshness_challenge_failed",)
    assert result.nonce_ok is False


def test_the_right_words_in_the_wrong_order_fail_the_freshness_challenge() -> None:
    result = grade_call(
        make_observations(nonce_words_heard=("yellow", "river", "table"))
    )
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("freshness_challenge_failed",)


def test_a_wrong_weekday_fails_the_freshness_challenge() -> None:
    result = grade_call(make_observations(weekday_heard="friday"))
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("freshness_challenge_failed",)


def test_a_missing_self_identification_beats_a_failed_nonce() -> None:
    result = grade_call(
        make_observations(claimed_to_be_subject=Ternary.UNKNOWN, nonce_words_heard=())
    )
    assert result.reasons == ("no_self_identification_under_disclosure",)


# --------------------------------------------------------------------------
# Presumed live weak — reached and answered, one leg short
# --------------------------------------------------------------------------


def test_a_forward_echo_without_the_reverse_is_only_weak() -> None:
    """The leg that separates listening from parroting.

    Repeating three words forwards is within reach of a recording spliced into
    the line, or of somebody echoing sounds without following the instruction.
    Saying them back in reverse is not, so a call that stops after the forward
    echo is reached and answered but one leg short."""
    result = grade_call(forward_only_observations())
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("reverse_challenge_not_satisfied",)
    assert result.nonce_ok is True


def test_the_words_in_forward_order_do_not_satisfy_the_reverse_leg() -> None:
    """Saying the same three words a second time is the parrot's answer, and it
    is exactly what the reverse leg is asked to reject."""
    result = grade_call(make_observations(nonce_words_reversed_heard=NONCE.words))
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("reverse_challenge_not_satisfied",)


def test_a_shuffled_reverse_reply_is_not_a_reverse_reply() -> None:
    """Order is the whole content of the challenge; the right three words in
    the wrong order carry none of it."""
    result = grade_call(
        make_observations(nonce_words_reversed_heard=("table", "yellow", "river"))
    )
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("reverse_challenge_not_satisfied",)


def test_a_failed_forward_echo_beats_a_failed_reverse() -> None:
    """Precedence: the freshness check runs first, so a call that satisfied
    neither leg is reported as the freshness failure it is, rather than as the
    weaker finding that somebody was reached and answered."""
    result = grade_call(
        make_observations(nonce_words_heard=(), nonce_words_reversed_heard=())
    )
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("freshness_challenge_failed",)


def test_a_failed_reverse_beats_the_knowledge_challenge() -> None:
    """Precedence the other way: the reverse leg is decided before any enrolled
    question is scored, so a caseworker reads the leg that failed first."""
    result = grade_call(
        forward_only_observations(prompt_answers={"pet": PET.expected})
    )
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("reverse_challenge_not_satisfied",)
    assert (result.challenges_passed, result.challenges_asked) == (1, 2)


def test_the_reverse_leg_survives_asr_noise_and_filler() -> None:
    """A living person saying "yellow, table, river, I think" has answered."""
    result = grade_call(
        make_observations(
            nonce_words_reversed_heard=("er", "Yéllow,", "TABLE.", "river!", "I", "think")
        )
    )
    assert result.grade is Grade.CONFIRMED_LIVE


def test_a_partial_knowledge_challenge_is_weak_and_says_n_of_m() -> None:
    result = grade_call(make_observations(prompt_answers={"pet": PET.expected}))
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("knowledge_challenge_partial_1_of_2",)
    assert (result.challenges_passed, result.challenges_asked) == (1, 2)


def test_a_wholly_failed_knowledge_challenge_is_weak_not_contra() -> None:
    """Failing the questions is not evidence of death, only of a weaker call."""
    result = grade_call(make_observations(prompt_answers={"pet": "Rover"}))
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("knowledge_challenge_partial_0_of_2",)


def test_passing_only_co_resident_answerable_prompts_is_weak() -> None:
    """Everything a housemate could also answer leaves impersonation open."""
    asked = (STREET,)
    subject = make_subject(prompts=asked)
    result = grade_call(
        make_observations(prompts=asked, prompt_answers=correct_answers(asked)),
        subject=subject,
        asked=asked,
    )
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("no_co_resident_safe_prompt_passed",)
    assert result.challenges_passed == result.challenges_asked == 1


# --------------------------------------------------------------------------
# Confirmed live — the only automatic close
# --------------------------------------------------------------------------


def test_a_full_pass_is_confirmed_live() -> None:
    result = grade_call(make_observations())
    assert result.grade is Grade.CONFIRMED_LIVE
    assert result.reasons == (
        "self_identified",
        "freshness_challenge_passed",
        "reverse_challenge_passed",
        "knowledge_challenge_passed_2_of_2",
    )
    assert result.auto_closes is True
    assert result.stops_payment is False


def test_both_nonce_legs_confirm_life_with_no_prompts_enrolled() -> None:
    """The configuration the demo roster actually ships.

    CALL-E's policy layer refuses to place a call that collects security-question
    answers, so a subject may legitimately have no enrolled prompts at all. The
    reverse leg is what carries the confirmation in that case: it proves the
    instruction was understood, and it collects nothing personal."""
    subject = make_subject(prompts=())
    result = grade_call(make_observations(prompt_answers={}), subject=subject, asked=())
    assert result.grade is Grade.CONFIRMED_LIVE
    assert result.reasons == (
        "self_identified",
        "freshness_challenge_passed",
        "reverse_challenge_passed",
    )
    assert result.challenges_asked == 0
    assert result.auto_closes is True


def test_no_enrolled_prompts_cannot_rescue_a_missing_reverse_reply() -> None:
    """Dropping the knowledge challenge must not have made the protocol easier:
    with nothing enrolled, the reverse leg is the only thing between a forward
    echo and an automatic close."""
    subject = make_subject(prompts=())
    result = grade_call(
        forward_only_observations(prompt_answers={}), subject=subject, asked=()
    )
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.reasons == ("reverse_challenge_not_satisfied",)


def test_confirmed_live_survives_asr_noise_in_every_answer() -> None:
    """A living person must not be failed by transcription spelling."""
    result = grade_call(
        make_observations(
            nonce_words_heard=("um", "Rivér,", "TABLE.", "yellow!", "I", "think"),
            nonce_words_reversed_heard=("Yéllow.", "table", "RIVER!"),
            weekday_heard="Tuesday.",
            prompt_answers={"pet": " biscuit ", "street": "marlborough road"},
        )
    )
    assert result.grade is Grade.CONFIRMED_LIVE


def test_the_attestation_carries_its_provenance() -> None:
    result = grade_call(make_observations())
    assert result.subject_id == "subj-0001"
    assert result.run_id == RUN_ID
    assert result.call_id == "call-0001"
    assert result.graded_at == FIXED_NOW
    assert result.evidence_quotes == ("Yes, that's me.",)


def test_another_person_audible_does_not_by_itself_downgrade() -> None:
    """Characterisation, not endorsement: presence alone is not coaching, and the
    knowledge prompts are what defend against the housemate. If this ever needs
    to change, change `grading.py`, not this test."""
    result = grade_call(make_observations(another_person_present=Ternary.YES))
    assert result.grade is Grade.CONFIRMED_LIVE


def test_grading_stamps_a_time_when_none_is_given() -> None:
    result = grade(make_subject(), make_observations(), NONCE, PROMPTS, RUN_ID)
    assert result.graded_at.tzinfo is not None


def test_grading_does_not_touch_the_observations_it_was_given() -> None:
    """`Observations` is frozen, but `prompt_answers` is a plain dict, so the
    freeze is only skin deep. The evidence an attestation was computed from has
    to still be the evidence afterwards."""
    observed = make_observations()
    before = dict(observed.prompt_answers)
    grade_call(observed)
    assert observed.prompt_answers == before
    assert observed == make_observations()


def test_a_failed_reverse_leg_is_recorded_only_in_its_reason() -> None:
    """Characterisation of a rough edge, not an endorsement.

    `Attestation` carries a `nonce_ok` field for the forward leg and no field
    at all for the reverse one, so a call that echoed forwards and then stopped
    is filed with `nonce_ok=True` beside a grade of PRESUMED_LIVE_WEAK. Nothing
    is wrong with the grade and the reason string says exactly what happened,
    but a caseworker skimming the structured fields sees only a passed nonce.
    If the reverse leg ever gets a field of its own, this is the test that
    should change."""
    result = grade_call(forward_only_observations())
    assert result.grade is Grade.PRESUMED_LIVE_WEAK
    assert result.nonce_ok is True
    assert result.reasons == ("reverse_challenge_not_satisfied",)


def test_an_unreached_call_records_no_freshness_verdict() -> None:
    """Characterisation of a rough edge, not an endorsement.

    Nobody was asked the nonce on a call nobody answered, yet the attestation
    records `nonce_ok=False`, which reads like a failed challenge. `nonce_ok` is
    typed `bool | None` and nothing ever produces the `None`, so the record has
    no way to say "not asked". The reason string carries the truth, so this is
    a reporting wrinkle rather than a wrong grade — but if `None` is ever meant
    to mean "not applicable", this is the test that should change."""
    result = grade_call(Observations(answered_by=Endpoint.NO_ANSWER))
    assert result.grade is Grade.UNPROVEN
    assert result.reasons == ("not_reached_no_answer",)
    assert result.nonce_ok is None
    assert result.challenges_passed == 0
