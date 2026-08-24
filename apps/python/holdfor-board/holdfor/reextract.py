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

The four questions, in the order they are asked:
1. feeling — "are you feeling better, about the same, or worse?"
2. medication_ok — "are you getting on alright with what they gave you?"
3. carried_words_text — "is there anything worrying you?"
4. wants_seen — "would you like the surgery to see you again?"

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


def structured_from(transcript: list[Turn], medication_changed: bool) -> dict | None:
    """Ask for the four answers. Return them, or return nothing.

    Every failure is the same failure. An import error, a missing key, a refusal, a
    timeout, a reply with no tool call in it: all of them are a call whose answers
    nobody has, which is a state this app already had a name and a queue for.
    """
    if not transcript or not available():
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
                    "name": TOOL,
                    "description": (
                        "Record what the patient answered in this check-in call."
                    ),
                    "input_schema": tool_schema(),
                }
            ],
            tool_choice={"type": "tool", "name": TOOL},
            messages=[
                {
                    "role": "user",
                    "content": prompt(transcript, medication_changed),
                }
            ],
        )
    except Exception:
        # Deliberately everything. This is one optional read on the way to a Review
        # Item, and there is no error it could raise that is worth losing the call
        # over: the Item is written either way and a person reads it when it is empty.
        return None

    return answers_in(message)


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
