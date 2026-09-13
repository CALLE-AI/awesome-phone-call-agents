"""High-consequence identifier control.

An RMA number is not a fact about a conversation, it is an instruction to ship
a unit. A single wrong digit produces a result that passes every schema check
and is still false, so extraction alone is never allowed to establish one.

The rule is that a high-consequence identifier is only CONFIRMED when the
counterparty was read the value back and agreed **to that value**. The second
half is the hard part. An affirmative sentence somewhere in a transcript proves
nothing: a person answering "yes" to "is now a good moment?" produces exactly
the same words as a person confirming a number. So a confirmation has to bind
to the exchange the identifier was actually read back in.

Model confidence is not an input: :func:`evaluate_identifier` takes no
confidence argument, and there is nothing a caller can pass that substitutes
for the read-back.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import Enum

MIN_CONFIRMATION_QUOTE_CHARS = 12
#: Shortest digit run treated as a candidate identifier inside a spoken turn.
MIN_IDENTIFIER_DIGITS = 4

#: CALL-E speaker labels, as documented for
#: ``recipients[].attempts[].transcript_turns[].speaker``.
AGENT_SPEAKER = "bot"
COUNTERPARTY_SPEAKER = "user"

_AFFIRMATIONS = (
    "correct",
    "that is right",
    "thats right",
    "that is it",
    "thats it",
    "yes",
    "yep",
    "yeah",
    "confirmed",
    "exactly",
    "you got it",
    "spot on",
)

_NEGATIONS = (
    "not right",
    "incorrect",
    "wrong",
    "no it is",
    "no its",
    "thats not",
    "that is not",
    "other way",
    "let me repeat",
    "no that",
    "no it",
)

#: A reply that opens with a bare "no" is a denial even when the rest of the
#: sentence names no fault, as in "No, four eight one seven one".
_LEADING_DENIAL = re.compile(r"^no(?:\s|$)")

#: A hedge is not an agreement, however affirmative the first word sounds.
_HEDGES = (
    "i think",
    "i believe",
    "probably",
    "should be",
    "pretty sure",
    "fairly sure",
    "more or less",
    "something like",
    "i guess",
    "maybe",
    "roughly",
)

_SPELLED_DIGITS = {
    "zero": "0",
    "oh": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
}


@dataclass(frozen=True)
class TranscriptTurn:
    """One turn as CALL-E reports it."""

    speaker: str
    text: str


class IdentifierState(str, Enum):
    """Lifecycle of a high-consequence identifier."""

    ABSENT = "ABSENT"
    UNCONFIRMED_IDENTIFIER = "UNCONFIRMED_IDENTIFIER"
    CONFIRMED_IDENTIFIER = "CONFIRMED_IDENTIFIER"


class IdentifierRefusal(str, Enum):
    """Why an identifier was not promoted to CONFIRMED."""

    NO_VALUE = "NO_VALUE"
    NO_READBACK = "NO_READBACK"
    NO_CONFIRMATION_VALUE = "NO_CONFIRMATION_VALUE"
    QUOTE_MISSING = "QUOTE_MISSING"
    QUOTE_TOO_SHORT = "QUOTE_TOO_SHORT"
    QUOTE_NOT_AFFIRMATIVE = "QUOTE_NOT_AFFIRMATIVE"
    QUOTE_NEGATED = "QUOTE_NEGATED"
    QUOTE_HEDGED = "QUOTE_HEDGED"
    TRANSCRIPT_UNAVAILABLE = "TRANSCRIPT_UNAVAILABLE"
    QUOTE_NOT_IN_COUNTERPARTY_TURN = "QUOTE_NOT_IN_COUNTERPARTY_TURN"
    IDENTIFIER_NOT_IN_EXCHANGE = "IDENTIFIER_NOT_IN_EXCHANGE"
    AMBIGUOUS_EXCHANGE = "AMBIGUOUS_EXCHANGE"
    PATTERN_MISMATCH = "PATTERN_MISMATCH"
    #: The confirmation held, but no transcript turn can be shown as evidence
    #: for the value itself: neither a counterparty utterance naming the
    #: reference nor a read-back pair containing it could be located.
    REFERENCE_EVIDENCE_UNGROUNDED = "REFERENCE_EVIDENCE_UNGROUNDED"


@dataclass(frozen=True)
class IdentifierClaim:
    """What the extraction returned about one identifier. Nothing more."""

    value_heard: str | None
    readback_performed: bool
    value_confirmed: str | None
    confirmation_quote: str | None


@dataclass(frozen=True)
class IdentifierDecision:
    """What the application is willing to assert about that identifier."""

    state: IdentifierState
    value: str | None
    heard_value: str | None
    corrected: bool
    refusals: tuple[IdentifierRefusal, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "state": self.state.value,
            "value": self.value,
            "heard_value": self.heard_value,
            "corrected": self.corrected,
            "refusals": [refusal.value for refusal in self.refusals],
        }


def _fold(text: str) -> str:
    """Lowercase, strip accents and punctuation, collapse whitespace."""

    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", stripped.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


#: Public alias so transcript-grounding checks in other modules fold text the
#: same way the identifier machinery does. One folding rule, one place.
fold_text = _fold


def _tokens_to_digits(folded: str) -> list[str]:
    return [_SPELLED_DIGITS.get(word, word) for word in folded.split(" ") if word]


def normalize_identifier(value: str | None, prefix: str | None = None) -> str | None:
    """Turn a spoken or written reference into one canonical string.

    ``"four eight one seven one"`` and ``"RMA 48171"`` both normalize to the
    same value, which is what lets a read-back be compared with what was first
    heard.
    """

    if value is None:
        return None
    folded = _fold(value)
    if not folded:
        return None
    joined = "".join(_tokens_to_digits(folded))
    if prefix:
        lowered = prefix.lower()
        if joined.startswith(lowered):
            joined = joined[len(lowered):]
        body = joined.upper()
        return f"{prefix.upper()}-{body}" if body else None
    return joined.upper()


def digits_of(value: str | None) -> str:
    """The digit run inside a canonical identifier, or an empty string."""

    return "".join(char for char in (value or "") if char.isdigit())


def digit_runs(text: str) -> set[str]:
    """Every candidate identifier spoken in a turn, spelled or written.

    ``"no, that last digit is an eight, four eight one seven eight"`` yields
    ``{"48178"}``; a turn naming a case number and an RMA yields both, which is
    the signal that a read-back covered more than one thing at once.
    """

    runs: set[str] = set()
    current = ""
    for token in _tokens_to_digits(_fold(text)):
        if token.isdigit():
            current += token
        else:
            if len(current) >= MIN_IDENTIFIER_DIGITS:
                runs.add(current)
            current = ""
    if len(current) >= MIN_IDENTIFIER_DIGITS:
        runs.add(current)
    return runs


def _matching_turn_indices(
    quote: str, transcript: tuple[TranscriptTurn, ...]
) -> tuple[list[int], bool]:
    """Counterparty turns this quote came from, and whether it is a whole turn.

    A whole-turn match is exact, so length is irrelevant to it: "Correct." is
    the entire answer, not a fragment that happened to appear inside a longer
    sentence. A substring match is the case the twelve-character floor exists
    for, and it keeps it.
    """

    folded_quote = _fold(quote)
    if not folded_quote:
        return [], False
    exact = [
        index
        for index, turn in enumerate(transcript)
        if turn.speaker == COUNTERPARTY_SPEAKER and _fold(turn.text) == folded_quote
    ]
    if exact:
        return exact, True
    if len(folded_quote) >= MIN_CONFIRMATION_QUOTE_CHARS:
        for index in range(len(transcript) - 1, -1, -1):
            turn = transcript[index]
            if turn.speaker == COUNTERPARTY_SPEAKER and folded_quote in _fold(turn.text):
                return [index], False
    return [], False


def _preceding_readback(
    transcript: tuple[TranscriptTurn, ...], index: int
) -> TranscriptTurn | None:
    """The agent turn this answer replies to, if the answer replies to one.

    Walking back stops at the previous counterparty turn: an agent turn from
    earlier in the call is not what this "correct" was answering.
    """

    for position in range(index - 1, -1, -1):
        turn = transcript[position]
        if turn.speaker == COUNTERPARTY_SPEAKER:
            return None
        if turn.speaker == AGENT_SPEAKER:
            return turn
    return None


def evaluate_identifier(
    claim: IdentifierClaim,
    *,
    transcript: tuple[TranscriptTurn, ...] | None = None,
    expected_pattern: str | None = None,
    prefix: str | None = None,
) -> IdentifierDecision:
    """Decide whether a high-consequence identifier may be asserted.

    ``transcript`` is the full ordered turn list for the attempt on the number
    that was dialled, agent turns included, because the agent's read-back is
    half of the exchange the confirmation has to bind to. Passing ``None``
    means no transcript was available, which is a refusal: there is then no way
    to tell what the counterparty was agreeing to.
    """

    refusals: list[IdentifierRefusal] = []
    heard = normalize_identifier(claim.value_heard, prefix)
    confirmed = normalize_identifier(claim.value_confirmed, prefix)

    if heard is None and confirmed is None:
        return IdentifierDecision(
            state=IdentifierState.ABSENT,
            value=None,
            heard_value=None,
            corrected=False,
            refusals=(IdentifierRefusal.NO_VALUE,),
        )

    if not claim.readback_performed:
        refusals.append(IdentifierRefusal.NO_READBACK)
    if confirmed is None:
        refusals.append(IdentifierRefusal.NO_CONFIRMATION_VALUE)

    quote = (claim.confirmation_quote or "").strip()
    negated = False
    if not quote:
        refusals.append(IdentifierRefusal.QUOTE_MISSING)
    else:
        folded_quote = _fold(quote)
        affirmative = any(token in folded_quote for token in _AFFIRMATIONS)
        negated = any(token in folded_quote for token in _NEGATIONS) or bool(
            _LEADING_DENIAL.match(folded_quote)
        )
        if any(token in folded_quote for token in _HEDGES):
            refusals.append(IdentifierRefusal.QUOTE_HEDGED)
        elif negated and not affirmative:
            refusals.append(IdentifierRefusal.QUOTE_NEGATED)
        elif not affirmative:
            refusals.append(IdentifierRefusal.QUOTE_NOT_AFFIRMATIVE)

    if quote and confirmed is not None:
        refusals.extend(_exchange_refusals(quote, confirmed, transcript, negated))

    if (
        confirmed is not None
        and expected_pattern is not None
        and re.fullmatch(expected_pattern, confirmed) is None
    ):
        refusals.append(IdentifierRefusal.PATTERN_MISMATCH)

    if refusals:
        return IdentifierDecision(
            state=IdentifierState.UNCONFIRMED_IDENTIFIER,
            value=None,
            heard_value=heard,
            corrected=False,
            refusals=tuple(dict.fromkeys(refusals)),
        )

    return IdentifierDecision(
        state=IdentifierState.CONFIRMED_IDENTIFIER,
        value=confirmed,
        heard_value=heard,
        corrected=heard is not None and heard != confirmed,
        refusals=(),
    )


def _exchange_refusals(
    quote: str,
    confirmed: str,
    transcript: tuple[TranscriptTurn, ...] | None,
    negated: bool,
) -> list[IdentifierRefusal]:
    """Bind the confirmation to the exchange the identifier was read back in."""

    if transcript is None:
        return [IdentifierRefusal.TRANSCRIPT_UNAVAILABLE]

    indices, whole_turn = _matching_turn_indices(quote, transcript)
    short = len(_fold(quote)) < MIN_CONFIRMATION_QUOTE_CHARS
    if not indices:
        return [
            IdentifierRefusal.QUOTE_TOO_SHORT
            if short
            else IdentifierRefusal.QUOTE_NOT_IN_COUNTERPARTY_TURN
        ]
    if short and not whole_turn:
        return [IdentifierRefusal.QUOTE_TOO_SHORT]

    # A short reply such as "Correct." can occur more than once in a call. It
    # carries no words of its own to tell the occurrences apart, so every one
    # of them has to bind to the same identifier or none of them counts.
    for index in indices:
        refusals = _bind_one(index, confirmed, transcript, negated, short)
        if refusals:
            return refusals
    return []


def _bind_one(
    index: int,
    confirmed: str,
    transcript: tuple[TranscriptTurn, ...],
    negated: bool,
    short: bool,
) -> list[IdentifierRefusal]:
    answer = transcript[index]
    readback = _preceding_readback(transcript, index)
    answer_runs = digit_runs(answer.text)
    wanted = digits_of(confirmed)
    if not wanted:
        return [IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE]

    if short:
        # A short affirmative says nothing on its own. It only means anything
        # as an answer to a read-back, and only when that read-back put
        # exactly one identifier in front of the counterparty.
        if readback is None:
            return [IdentifierRefusal.QUOTE_TOO_SHORT]
        readback_runs = digit_runs(readback.text)
        if not readback_runs:
            return [IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE]
        if len(readback_runs) > 1:
            return [IdentifierRefusal.AMBIGUOUS_EXCHANGE]

    # A correction has to be spoken by the counterparty. When the answer
    # contradicts the read-back, the agent's turn carries the value being
    # rejected, so it is not admissible as the value being agreed to.
    if negated or readback is None:
        exchange_runs = answer_runs
    else:
        exchange_runs = answer_runs | digit_runs(readback.text)

    # Containment rather than equality, because speech runs digits together:
    # "that last digit is an eight, four eight one seven eight" extracts as
    # 848178. A wrong value still fails, since 48171 is not inside 848178.
    if not any(wanted in run for run in exchange_runs):
        return [IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE]

    # Another candidate was in play, so a bare "correct" cannot say which one
    # was meant. Only the counterparty naming this one, and nothing else,
    # resolves it.
    others = {run for run in exchange_runs if wanted not in run}
    if others:
        answer_matches = {run for run in answer_runs if wanted in run}
        answer_others = {run for run in answer_runs if wanted not in run}
        if not answer_matches or answer_others:
            return [IdentifierRefusal.AMBIGUOUS_EXCHANGE]

    return []
