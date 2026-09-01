"""High-consequence identifier control.

An RMA number is not a fact about a conversation, it is an instruction to ship
a unit. A single wrong digit produces a result that passes every schema check
and is still false, so extraction alone is never allowed to establish one.

The rule this module enforces is that a high-consequence identifier is only
CONFIRMED when the representative was read the value back and said so, in
words that are present in the transcript. Model confidence is not an input:
:func:`evaluate_identifier` takes no confidence argument and there is nothing a
caller can pass that substitutes for the read-back.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import Enum

MIN_CONFIRMATION_QUOTE_CHARS = 12

_AFFIRMATIONS = (
    "correct",
    "that is right",
    "thats right",
    "that is it",
    "thats it",
    "yes",
    "yep",
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
    QUOTE_NOT_GROUNDED = "QUOTE_NOT_GROUNDED"
    PATTERN_MISMATCH = "PATTERN_MISMATCH"


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

    @property
    def is_confirmed(self) -> bool:
        return self.state is IdentifierState.CONFIRMED_IDENTIFIER

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
    lowered = stripped.lower()
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_identifier(value: str | None, prefix: str | None = None) -> str | None:
    """Turn a spoken or written reference into one canonical string.

    ``"four eight one seven one"`` and ``"RMA 4 8 1 7 1"`` both normalize to
    the same value, which is what lets a read-back be compared with what was
    first heard.
    """

    if value is None:
        return None
    folded = _fold(value)
    if not folded:
        return None
    words = folded.split(" ")
    converted = [_SPELLED_DIGITS.get(word, word) for word in words]
    joined = "".join(converted)
    if prefix:
        lowered_prefix = prefix.lower()
        if joined.startswith(lowered_prefix):
            joined = joined[len(lowered_prefix):]
        body = joined.upper()
        return f"{prefix.upper()}-{body}" if body else None
    return joined.upper()


def _quote_is_grounded(quote: str, transcript_turns: tuple[str, ...] | None) -> bool:
    """A quote binds when it is one whole turn, or a long substring of one.

    The 12-character substring floor is the same test the repository's
    ``local-atlas`` evidence binding uses, kept identical on purpose so the two
    behave the same way for a reader comparing them.
    """

    if transcript_turns is None:
        return True
    folded_quote = _fold(quote)
    if not folded_quote:
        return False
    for turn in transcript_turns:
        folded_turn = _fold(turn)
        if folded_quote == folded_turn:
            return True
        if len(folded_quote) >= MIN_CONFIRMATION_QUOTE_CHARS and folded_quote in folded_turn:
            return True
    return False


def evaluate_identifier(
    claim: IdentifierClaim,
    *,
    transcript_turns: tuple[str, ...] | None = None,
    expected_pattern: str | None = None,
    prefix: str | None = None,
) -> IdentifierDecision:
    """Decide whether a high-consequence identifier may be asserted.

    ``transcript_turns`` should carry only the counterparty's turns. Passing
    ``None`` means no transcript was available and skips the grounding test;
    every other test still applies, so a missing transcript can never by itself
    promote an identifier.
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
    if not quote:
        refusals.append(IdentifierRefusal.QUOTE_MISSING)
    else:
        folded_quote = _fold(quote)
        if len(folded_quote) < MIN_CONFIRMATION_QUOTE_CHARS:
            refusals.append(IdentifierRefusal.QUOTE_TOO_SHORT)
        affirmative = any(token in folded_quote for token in _AFFIRMATIONS)
        negated = any(token in folded_quote for token in _NEGATIONS)
        if negated and not affirmative:
            refusals.append(IdentifierRefusal.QUOTE_NEGATED)
        elif not affirmative:
            refusals.append(IdentifierRefusal.QUOTE_NOT_AFFIRMATIVE)
        if not _quote_is_grounded(quote, transcript_turns):
            refusals.append(IdentifierRefusal.QUOTE_NOT_GROUNDED)

    if confirmed is not None and expected_pattern is not None:
        if re.fullmatch(expected_pattern, confirmed) is None:
            refusals.append(IdentifierRefusal.PATTERN_MISMATCH)

    if refusals:
        return IdentifierDecision(
            state=IdentifierState.UNCONFIRMED_IDENTIFIER,
            value=None,
            heard_value=heard,
            corrected=False,
            refusals=tuple(refusals),
        )

    return IdentifierDecision(
        state=IdentifierState.CONFIRMED_IDENTIFIER,
        value=confirmed,
        heard_value=heard,
        corrected=heard is not None and heard != confirmed,
        refusals=(),
    )
