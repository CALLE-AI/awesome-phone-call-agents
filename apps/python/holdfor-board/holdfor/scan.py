"""The second layer: what the practice is told, decided without the model.

The prompt is for the Patient — it ends the call kindly with the Safety Line. This is
for the Practice, and it is the authority. It reads the finished transcript and flags
even when the agent sailed through every question without stopping, because the
call where the model missed something is exactly the call a human needs to read.

Nothing here calls a model, and nothing here grades severity. It matches surfaces.
See docs/adr/0005-stop-conditions-are-enforced-twice.md.
"""

from __future__ import annotations

import re
from pathlib import Path

from . import redflags
from .models import Turn

RED_FLAG_PHRASE = "red_flag_phrase"
RED_FLAG_NOT_TOLD = "red_flag_not_told"
NO_TRANSCRIPT = "no_transcript"
UNMAPPABLE = "unmappable"
REPEATED_NON_ANSWER = "repeated_non_answer"
THIRD_PARTY = "third_party"
CLINICAL_QUESTION = "clinical_question"

PATIENT = "other"
AGENT = "agent"

BOUNDED_FIELDS = ("feeling", "medication_ok", "wants_seen")

QUESTION_THREE_MARKER = "worrying you"

REPEAT_LIMIT = 3
MIN_QUOTE_WORDS = 3

# The two reasons that mean she may be unwell right now, as opposed to the four that
# mean the call did not work. Read by `review.release`, which refuses to place an
# automated booking call on either of them.
RED_FLAG_REASONS = (RED_FLAG_PHRASE, RED_FLAG_NOT_TOLD)

# 111 and 999, not the Safety Line's wording. What has to reach her is where to turn;
# whether the agent recited the sentence around it perfectly is a different question,
# and one this layer is deliberately not the judge of.
URGENT_NUMBER = re.compile(r"(?<!\d)(?:111|999)(?!\d)")

# The two lists below are ours, not lifted from anywhere, and are not clinical claims.
# They match conversational surfaces: somebody else taking the handset, and a question
# being put to the agent that the agent must not answer.
HANDOVER_PHRASES = (
    "i'll put you on to",
    "i will put you on to",
    "putting you on to",
    "put you on to",
    "i'll get my",
    "let me get my",
    "hang on i'll get",
    "here she is",
    "here he is",
    "is here with me",
    "are here with me",
    "she's with me",
    "he's with me",
    "you're on speaker",
    "on speakerphone",
    "speak to my",
    "talk to my",
    "my daughter wants to",
    "my son wants to",
)

CLINICAL_QUESTION_PHRASES = (
    "should i",
    "shall i",
    "do i need to",
    "what should i do",
    "what do you think",
    "do you think i",
    "is that normal",
    "is it normal",
    "is that serious",
    "is it serious",
    "is it dangerous",
    "is that alright to",
    "can i stop taking",
    "should i stop",
    "do i keep taking",
    "how many should i",
    "is that a lot",
    "what does that mean",
)


def _matches_any(text: str, candidates: tuple[str, ...]) -> str | None:
    for phrase in candidates:
        if re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", text, re.IGNORECASE):
            return phrase
    return None


def _patient_turns(transcript: list[Turn]) -> list[Turn]:
    return [turn for turn in transcript if turn.speaker == PATIENT]


def _normalise(text: str) -> str:
    """Flatten for comparison. Apostrophes are dropped, not spaced.

    "don't" becomes "dont" rather than "don t", so a contraction and its expansion
    normalise alike and the non-answer set can be written the way people speak.
    """
    without_apostrophes = re.sub(r"['‘’]", "", text)
    return " ".join(re.sub(r"[^\w\s]", " ", without_apostrophes).casefold().split())


def scan(
    transcript: list[Turn],
    extracted: dict,
    source: Path | None = None,
) -> tuple[bool, str | None]:
    """Flag a finished transcript, and say which surface matched.

    Runs on every finished transcript, whatever the agent reported about itself. The
    order of checks decides only which reason a Reviewer sees first; a red flag is
    checked first because it is the one that cannot wait behind a null field.

    No transcript is flagged before anything else is considered. A missing transcript
    is not a clean call: there is nothing left to check the agent's own account
    against, so the structured result is the only thing saying the call went well and
    it is exactly the thing this layer exists not to trust. Flagging rather than
    raising is deliberate too. A raise here would leave the call_attempt row stranded
    in `reserved`, and `idempotency_key` is UNIQUE, so the Patient could never be rung
    again about that appointment.
    """
    if not transcript:
        return True, NO_TRANSCRIPT

    extracted = extracted or {}
    patient = _patient_turns(transcript)

    for position, turn in enumerate(transcript):
        if turn.speaker != PATIENT:
            continue
        if redflags.match(turn.text, source):
            if _told_where_to_turn(transcript[position + 1 :]):
                return True, RED_FLAG_PHRASE
            return True, RED_FLAG_NOT_TOLD

    if any(extracted.get(field) is None for field in BOUNDED_FIELDS):
        return True, UNMAPPABLE

    if _repeated_question(transcript):
        return True, REPEATED_NON_ANSWER

    for turn in patient:
        if _matches_any(turn.text, HANDOVER_PHRASES):
            return True, THIRD_PARTY

    for turn in patient:
        if _matches_any(turn.text, CLINICAL_QUESTION_PHRASES):
            return True, CLINICAL_QUESTION

    return False, None


def _told_where_to_turn(rest: list[Turn]) -> bool:
    """Whether the agent gave her an urgent number after she said the phrase.

    The entire clinical value of a stopped call is one number spoken aloud, and until
    this ran nothing checked it had been. Both of the red-flag fixtures reached the
    board reading `red_flag_phrase`: the one where the agent read the Safety Line, and
    the one where it sailed past "coughing up blood" into the cheerful closing. A
    Reviewer could not tell from the board which patient had been told anything.

    Position, not `Turn.index`, and only the turns after hers: the number has to have
    been said in answer to what she said. An agent that mentioned 111 in its opening
    and hung up on her afterwards has told her nothing.
    """
    return any(
        turn.speaker == AGENT and URGENT_NUMBER.search(turn.text) for turn in rest
    )


def _repeated_question(transcript: list[Turn]) -> bool:
    """True when the agent put the same question three or more times.

    Three attempts at one question is the surface of a conversation that is not
    working. The agent is not asked to conclude anything about why.
    """
    counts: dict[str, int] = {}
    for turn in transcript:
        if turn.speaker != AGENT:
            continue
        key = _normalise(turn.text)
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
        if counts[key] >= REPEAT_LIMIT:
            return True
    return False


def extract_carried_words(transcript: list[Turn]) -> tuple[str, int] | None:
    """Her own words about what worries her, as a slice of one turn — or nothing.

    Returns a substring of a single patient turn plus that turn's index. Every return
    value is produced by slicing the turn's own text and is checked against it before
    being returned, so no string can leave here that the Patient did not say.

    None is a legitimate outcome, not a failure. The Review Item then queues for a
    human. This string is later spoken aloud to a receptionist in her name, so a
    tidied or invented quote would put words in her mouth to a third party — and
    there is nothing so useful about a quote that it is worth that.
    """
    if not transcript:
        return None

    turn = _answer_to_question_three(transcript)
    if turn is None:
        return None

    span = _longest_sentence(turn.text)
    if span is None:
        return None
    if len(span.split()) < MIN_QUOTE_WORDS:
        return None
    if _is_non_answer(span):
        return None
    if len(_content_words(span)) < MIN_CONTENT_WORDS:
        return None
    if span not in turn.text:
        return None
    return span, turn.index


def _answer_to_question_three(transcript: list[Turn]) -> Turn | None:
    asked = False
    for turn in transcript:
        if turn.speaker == AGENT and QUESTION_THREE_MARKER in turn.text.casefold():
            asked = True
            continue
        if asked and turn.speaker == PATIENT:
            return turn
    return None


def _longest_sentence(text: str) -> str | None:
    """The longest sentence in `text`, as a slice of `text` and never a rebuild."""
    best: str | None = None
    for match in re.finditer(r"[^.!?]+", text):
        candidate = text[match.start() : match.end()].strip(" \t\n,;:-—")
        if candidate and (best is None or len(candidate) > len(best)):
            best = candidate
    return best


NON_ANSWERS = frozenset(
    {
        "no",
        "nope",
        "nothing",
        "nothing at all",
        "nothing really",
        "not really",
        "no not really",
        "no nothing",
        "no i dont think so",
        "i dont think so",
        "no thank you",
        "no thanks",
        "im fine",
        "i m fine",
        "all fine",
        "its all been fine",
        "no not that i can think of",
        "not that i can think of",
    }
)


def _is_non_answer(span: str) -> bool:
    return _normalise(span) in NON_ANSWERS


# Enumerating every way of saying nothing is a losing game — "not really, no" slips
# past a list that holds "no, not really". So the test is on substance instead: a span
# has to carry words that are about something. Everything below is a word a person can
# use to fill a sentence without telling you anything.
FILLER_WORDS = frozenset(
    {
        "a", "about", "all", "alright", "an", "and", "are", "at", "be", "been", "bit",
        "but", "do", "dont", "fine", "for", "guess", "had", "has", "have", "here",
        "i", "im", "is", "it", "its", "just", "know", "maybe", "me", "much", "my",
        "no", "not", "nope", "nothing", "of", "off", "oh", "ok", "okay", "on", "or",
        "pardon", "quite", "really", "right", "say", "so", "sorry", "still", "suppose",
        "thank", "thanks", "that", "the", "then", "there", "think", "this", "to",
        "too", "very", "was", "well", "were", "yeah", "yes", "you",
    }
)

MIN_CONTENT_WORDS = 2


def _content_words(span: str) -> list[str]:
    return [word for word in _normalise(span).split() if word not in FILLER_WORDS]
