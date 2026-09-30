"""What this defeats, and what it does not.

A scoreboard that only listed the attacks we catch would be marketing. Two of
the six below are not caught, they are listed anyway, and the tests assert that
they are still not caught -- so if that ever changes, somebody has to come here
and say so deliberately.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from . import grading, nonce as nonce_mod
from .models import Endpoint, Grade, KnowledgePrompt, Nonce, Observations, Subject, Ternary, TranscriptTurn

FIXED_NONCE = Nonce(words=("river", "table", "yellow"), weekday="tuesday")

SUBJECT = Subject(
    subject_id="adv-1",
    display_name="Test Subject",
    phone_e164="+447700900100",
    country_code="GB",
    language="English",
    reference="ADV-1",
    prompts=(
        KnowledgePrompt("first_employer", "First place you worked?", "Ashanti Goldfields", True),
    ),
)


@dataclass(frozen=True)
class Attack:
    key: str
    name: str
    description: str
    expected_caught: bool
    observations: Observations


def _passing_fields(**overrides) -> dict:
    base = dict(
        answered_by=Endpoint.SUBJECT,
        claimed_to_be_subject=Ternary.YES,
        nonce_words_heard=FIXED_NONCE.words,
        nonce_words_reversed_heard=FIXED_NONCE.reversed_words,
        weekday_heard="Tuesday",
        prompt_answers={"first_employer": "Ashanti Goldfields"},
        another_person_present=Ternary.NO,
        subject_reported_dead=Ternary.NO,
        wrong_number=Ternary.NO,
        distress_or_confusion=Ternary.NO,
    )
    base.update(overrides)
    return base


ATTACKS: tuple[Attack, ...] = (
    Attack(
        "relative_vouches", "A relative vouches for the subject",
        "Somebody else answers and says the subject is well and resting.",
        True,
        Observations(**_passing_fields(answered_by=Endpoint.THIRD_PARTY,
                                       claimed_to_be_subject=Ternary.NO)),
    ),
    Attack(
        "recording", "A recording answers in the subject's own voice",
        "An answering machine greets the caller by name.",
        True,
        Observations(**_passing_fields(answered_by=Endpoint.VOICEMAIL,
                                       nonce_words_heard=(),
                                       nonce_words_reversed_heard=(),
                                       weekday_heard="")),
    ),
    Attack(
        "coached", "Somebody in the room supplies the answers",
        "Every answer is correct, spoken after an unattributed prompt.",
        True,
        Observations(**_passing_fields(
            another_person_present=Ternary.YES,
            turns=(
                TranscriptTurn(0.0, "bot", "Please repeat the three words."),
                TranscriptTurn(2.0, "unknown", "river, table, yellow"),
                TranscriptTurn(11.0, "user", "river, table, yellow"),
            ),
        )),
    ),
    Attack(
        "reassigned", "The number now belongs to a stranger",
        "A different person has held the line for years.",
        True,
        Observations(**_passing_fields(wrong_number=Ternary.YES)),
    ),
    Attack(
        "impersonator", "A relative who knows the enrolled answers",
        "Somebody in the household answers as the subject and knows the prompts.",
        False,
        Observations(**_passing_fields()),
    ),
    Attack(
        "synthesised", "A synthesised or replayed voice, live on the call",
        "CALL-E returns transcripts, not audio, so no speaker verification is possible.",
        False,
        Observations(**_passing_fields()),
    ),
)


@dataclass(frozen=True)
class Outcome:
    attack: Attack
    grade: Grade
    caught: bool

    @property
    def as_expected(self) -> bool:
        return self.caught == self.attack.expected_caught


def run(attack: Attack) -> Outcome:
    attestation = grading.grade(
        subject=SUBJECT,
        observed=attack.observations,
        issued_nonce=FIXED_NONCE,
        asked_prompts=SUBJECT.prompts,
        run_id=f"adv_{attack.key}",
    )
    return Outcome(attack, attestation.grade, attestation.grade is not Grade.CONFIRMED_LIVE)


def run_all() -> tuple[Outcome, ...]:
    return tuple(run(a) for a in ATTACKS)
