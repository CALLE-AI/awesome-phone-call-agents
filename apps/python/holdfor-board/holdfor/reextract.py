"""The four answers, read back out of a transcript nobody else would classify.

`calle call start` accepts `--to-phone`, `--goal`, `--language` and `--region`. There
is no way to hand it a result schema, so a live call returns words and a status and no
structured block, and `extract` refuses at its first line. Every real call landed on
the board with three empty fields on a conversation where all four questions had
plainly been asked and answered.

So the board does the extraction itself: a second pass over the transcript it already
stores, against the schema the skill already publishes. The output goes through
`extract` unchanged — the same bounds, the same required fields, and the same verbatim
check on the quote. A model in this app is trusted no further than the agent on the
phone was, and it is easier to check: the transcript sits beside the answer, and
`review.anchors` links each field to the turn it came from.

Failure ends as `None` every time — no key, no library, no answer, an unreadable one,
a call that never spoke. `extract` reads that as `extraction_failed` and a person reads
the call, which is exactly the board a Reviewer has today. There is no path here from a
failure to a guess.

What leaves the machine is the conversation: a first name and how somebody says they
have been. Not a surname, not a date of birth, not a number — the agent promises aloud
never to ask for those and the transcript is the proof it did not.
"""

from __future__ import annotations

import json
import os
from dataclasses import replace

from .models import CallResult, Turn

KEY = "ANTHROPIC_API_KEY"
ENABLED = "HOLDFOR_EXTRACT"
MODEL = "HOLDFOR_EXTRACT_MODEL"

DEFAULT_MODEL = "claude-sonnet-5"

TOOL = "record_check_in"

REQUEST_TIMEOUT_SECONDS = 60.0

# Where the answers on a Review Item came from. Stored because a Reviewer reading
# "worse" is entitled to know whether the agent on the call said so or whether this
# app decided it afterwards, and because the two are not equally close to the patient.
FROM_AGENT = "agent"
FROM_TRANSCRIPT = "transcript"

PATIENT = "other"

INSTRUCTIONS = """\
Below is the transcript of one automated post-visit check-in call made on behalf of a
GP surgery. Record what the patient answered, using the tool.

Record only what was said. You are reading a transcript, not assessing anybody: do not
judge whether an answer sounds concerning, do not infer an answer that was not given,
and do not resolve an ambiguous answer into a clean one. Where an answer was given but
maps to none of the choices, that is what "unsure" is for.

The questions, in the order they are asked:
1. feeling — "are you feeling better, about the same, or worse?"
2. medication_ok — "are you getting on alright with what they gave you?"
3. carried_words_text — "is there anything worrying you?"
4. wants_seen — "would you like the surgery to see you again?"
5. when_easier — "are mornings or afternoons easier for you?"

Question 5 is put to her only when she answered yes to question 4. Record
when_easier as "not_asked" when she did not, whether or not the agent asked it anyway.
A day of the week and nothing else is "unsure": that is neither half of the day.

carried_words_text must be a verbatim substring of one single patient turn, copied
character for character, and carried_words_turn must be the index of that turn. Never
summarise, correct the English, join two turns, or write a sentence of your own. This
string is later read aloud to a receptionist as the patient's own words. Null is a
valid and expected answer and is safer than a paraphrase: leave it null unless a clean
span exists inside one turn.

medication_ok must be {medication} for this call.

stop_condition is true only if the agent ended the call early and read a safety line
telling the patient to ring 111. It is advisory; a separate scanner reads the same
transcript and is the authority.

Transcript:
{transcript}\
"""

OFFERS_TOOL = "record_reception_call"

OFFER_INSTRUCTIONS = """\
Below is the transcript of one automated call to a GP surgery's appointments line, made
on a patient's behalf. Record what the person on the appointments line offered, using
the tool.

An offer is the appointments line naming a day, a date or a time when the patient could
be seen. Record one entry per offer, with the index of the turn it was spoken in and the
clock time as 24-hour HH:MM if a time was named. Leave the time null if a day was named
and no time was. `accepted` is whether the automated caller said yes to that offer, not
whether it sounded acceptable to you.

Only turns marked `reception` can hold an offer. Never point at a turn the automated
caller spoke itself, and never at a turn that holds no offer: an empty list is a correct
answer when nothing was offered.

The transcription of the appointments line is often poor and half a turn may be
unreadable. Record only what is legibly an offer. Do not repair a garbled turn into one,
and do not infer an offer from the caller's reply to it.

reception_outcome is how the call ended in words:
  slot_offered          a time or day was offered, whether or not it was accepted
  refused_third_party   they would not book for somebody who is not on the line
  no_slots              they had nothing to offer
  unclear               anything else, including a call too garbled to read

Prefer unclear over guessing.

Transcript:
{transcript}\
"""

MEDICATION_ASKED = (
    'one of "yes", "no" or "unsure": this appointment changed the patient\'s '
    "medication, so the question is put to them"
)
MEDICATION_NOT_ASKED = (
    '"not_asked": this appointment did not change the patient\'s medication, so the '
    "question is never put to them and any answer would be one nobody gave"
)


def available() -> bool:
    """Whether a second pass is possible at all.

    The key is the gate. Nothing here is switched on by installing a library: an
    absent key is a board that behaves exactly as it did before this module existed.
    """
    if os.environ.get(ENABLED) == "0":
        return False
    return bool((os.environ.get(KEY) or "").strip())


def model() -> str:
    return (os.environ.get(MODEL) or "").strip() or DEFAULT_MODEL


def tool_schema() -> dict:
    """The published schema, in the subset a tool definition can carry.

    `$schema` and the conditional `allOf` are dropped. The condition they express —
    the bounded answers are required unless the call was declined — is not something a
    tool schema enforces, and it is already enforced where it counts: `extract`
    refuses a block with no `feeling` or no `wants_seen` as `extraction_failed`. What
    stays is the part a schema can hold: the field names, the enums, and the bar on
    anything else.
    """
    # Imported here rather than at the top: `checkin` imports this module, and the
    # schema is only read on the way to an API call.
    from .checkin import result_schema

    published = result_schema()
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": published["properties"],
        "required": published.get("required", []),
    }


def offers_schema() -> dict:
    """The schema the Rebooking Call already declares, as a tool definition.

    Read from `rebooking` rather than restated, for the reason its own comment gives:
    a schema copied would drift, and the drift would show up as a field the board
    cannot read. Imported inside the function because `rebooking` imports this module.
    """
    from .rebooking import RESULT_SCHEMA

    return {**RESULT_SCHEMA, "additionalProperties": False}


def as_text(transcript: list[Turn]) -> str:
    """The transcript with its turn indexes, because one of them is an answer.

    `carried_words_turn` is checked against the turn it claims to come from, so the
    index has to travel with the words rather than be counted from the layout.
    """
    return "\n".join(
        f"turn {turn.index} "
        f"{'patient' if turn.speaker == PATIENT else 'agent'}: {turn.text}"
        for turn in transcript
    )


def offers_prompt(transcript: list[Turn]) -> str:
    """The transcript labelled by who was on which end.

    `reception` rather than `patient`: the person speaking is a receptionist and the
    model has to be able to tell an offer from the caller repeating itself.
    """
    labelled = "\n".join(
        f"turn {turn.index} "
        f"{'reception' if turn.speaker == PATIENT else 'caller'}: {turn.text}"
        for turn in transcript
    )
    return OFFER_INSTRUCTIONS.format(transcript=labelled)


def prompt(transcript: list[Turn], medication_changed: bool) -> str:
    return INSTRUCTIONS.format(
        medication=MEDICATION_ASKED if medication_changed else MEDICATION_NOT_ASKED,
        transcript=as_text(transcript),
    )


def answers_in(message) -> dict | None:
    """The tool call in a reply, or nothing.

    Separate from the request so the reading can be tested without a network. A reply
    that argued instead of answering, or answered in a shape this cannot read, is a
    call whose answers nobody has — which is not a new state.
    """
    for block in getattr(message, "content", None) or []:
        if getattr(block, "type", None) != "tool_use":
            continue
        answers = getattr(block, "input", None)
        if isinstance(answers, str):
            try:
                answers = json.loads(answers)
            except ValueError:
                return None
        return dict(answers) if isinstance(answers, dict) else None
    return None


def ask(tool: str, description: str, schema: dict, question: str) -> dict | None:
    """One forced tool call, or nothing at all.

    Every failure is the same failure. An import error, a missing key, a refusal, a
    timeout, a reply with no tool call in it: all of them are a call nobody has a
    reading of, which is a state this app already had a name and a queue for.
    """
    if not available():
        return None
    try:
        import anthropic
    except ImportError:
        return None

    try:
        message = anthropic.Anthropic().messages.create(
            model=model(),
            max_tokens=1024,
            timeout=REQUEST_TIMEOUT_SECONDS,
            tools=[
                {
                    "name": tool,
                    "description": description,
                    "input_schema": schema,
                }
            ],
            tool_choice={"type": "tool", "name": tool},
            messages=[{"role": "user", "content": question}],
        )
    except Exception:
        # Deliberately everything. This is one optional read on the way to a record,
        # and there is no error it could raise that is worth losing the call over: the
        # row is written either way and a person reads it when it is empty.
        return None

    return answers_in(message)


def structured_from(transcript: list[Turn], medication_changed: bool) -> dict | None:
    """The four answers a Check-in Call would have returned, had it been able to."""
    if not transcript:
        return None
    return ask(
        TOOL,
        "Record what the patient answered in this check-in call.",
        tool_schema(),
        prompt(transcript, medication_changed),
    )


def offers_from(transcript: list[Turn]) -> dict | None:
    """What reception offered, and how the call ended.

    The same hole as the Check-in Call had, in the other half of the app, and it made
    the Rebooking Call look broken when it was not: `rebooking.place` read `offers` off
    a structured block that a live call never carries, so a slot spoken aloud and
    correctly refused was recorded as `unreadable` and the item went back to a person
    with nothing on it.

    Nothing here is trusted about the words. `record_offers` re-reads each offer's text
    from the turn it claims to come from and discards a claim pointing at nothing, or
    at something the agent said itself. This supplies the pointers; the transcript is
    still the evidence.
    """
    if not transcript:
        return None
    return ask(
        OFFERS_TOOL,
        "Record what the appointments line offered in this call.",
        offers_schema(),
        offers_prompt(transcript),
    )


def fill(
    result: CallResult, medication_changed: bool
) -> tuple[CallResult, str | None]:
    """The result the rest of the pipeline should read, and where its answers came from.

    A block from the provider is left alone: the agent on the call heard the answers
    and this app did not. Only the gap is filled, and a gap that stays a gap returns
    the result untouched with no source, because a Review Item with no answers has no
    answers to attribute.
    """
    if result.structured:
        return result, FROM_AGENT

    answers = structured_from(result.transcript, medication_changed)
    if not answers:
        return result, None
    return replace(result, structured=answers), FROM_TRANSCRIPT
