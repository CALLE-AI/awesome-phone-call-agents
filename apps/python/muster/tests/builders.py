"""Small builders shared by the grading and invariant suites.

Kept out of the test modules so that a grading test and a property test are
demonstrably grading the *same* shape of call.
"""

from __future__ import annotations

from muster.models import (
    Accessibility,
    Endpoint,
    KnowledgePrompt,
    Nonce,
    Observations,
    Subject,
    Ternary,
    TranscriptTurn,
)

#: Two enrolled prompts. The second is one a housemate would also know, so it
#: cannot carry a CONFIRMED_LIVE on its own.
PET = KnowledgePrompt(
    prompt_id="pet",
    question="What was your first pet called?",
    expected="Biscuit",
)
STREET = KnowledgePrompt(
    prompt_id="street",
    question="What street did you grow up on?",
    expected="Marlborough Road",
    co_resident_safe=False,
)
PROMPTS: tuple[KnowledgePrompt, ...] = (PET, STREET)

NONCE = Nonce(words=("river", "table", "yellow"), weekday="tuesday")

RUN_ID = "run-0001"


def make_subject(
    prompts: tuple[KnowledgePrompt, ...] = PROMPTS,
    accessibility: Accessibility | None = None,
) -> Subject:
    """An enrolled subject. Enrolment is a human act; the tests fake only its record."""
    return Subject(
        subject_id="subj-0001",
        display_name="A. Pensioner",
        phone_e164="+441632960001",  # Ofcom drama range: never a real line.
        country_code="GB",
        language="en-GB",
        reference="PEN-0001",
        prompts=prompts,
        accessibility=accessibility or Accessibility(),
    )


def correct_answers(prompts: tuple[KnowledgePrompt, ...] = PROMPTS) -> dict[str, str]:
    return {p.prompt_id: p.expected for p in prompts}


def make_observations(
    prompts: tuple[KnowledgePrompt, ...] = PROMPTS,
    **overrides: object,
) -> Observations:
    """A call that passes every leg, unless an override spoils one.

    Starting from a pass means every test below names exactly the one thing it
    changed, which is the only way precedence is legible.
    """
    fields: dict[str, object] = {
        "answered_by": Endpoint.SUBJECT,
        "claimed_to_be_subject": Ternary.YES,
        "nonce_words_heard": NONCE.words,
        "nonce_words_reversed_heard": NONCE.reversed_words,
        "weekday_heard": NONCE.weekday,
        "prompt_answers": correct_answers(prompts),
        "another_person_present": Ternary.NO,
        "subject_reported_dead": Ternary.NO,
        "wrong_number": Ternary.NO,
        "distress_or_confusion": Ternary.NO,
        "evidence_quotes": ("Yes, that's me.",),
        "turns": (),
    }
    fields.update(overrides)
    return Observations(**fields)  # type: ignore[arg-type]


def forward_only_observations(
    prompts: tuple[KnowledgePrompt, ...] = PROMPTS,
    **overrides: object,
) -> Observations:
    """A call that echoes the three words forwards and never says them back.

    That is the shape a recording, or a person parroting without listening,
    can still produce, so it is the exact call the reverse leg exists to
    separate from a full pass. Named here rather than spelled out at each use,
    because several suites need to build it.
    """
    fields: dict[str, object] = {"nonce_words_reversed_heard": ()}
    fields.update(overrides)
    return make_observations(prompts, **fields)


def coached_turns() -> tuple[TranscriptTurn, ...]:
    """A voice that is neither caller nor subject, speaking into the gap."""
    return (
        TranscriptTurn(0.0, "bot", "Say these three words back."),
        TranscriptTurn(3.0, "unknown", "River, table, yellow. Go on, say it."),
        TranscriptTurn(5.0, "user", "River, table, yellow."),
    )
