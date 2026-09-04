"""Ask whether a structured result is supported by anything that was said.

**The constraint this works around.** The CALL-E contract types ``evidence`` as
an array of plain strings -- ``["The recipient said yes."]``. There are no
spans, no turn indices, no character offsets. So checking that an extracted
value is grounded in the call is not a lookup, it is an inference, and this
module says so rather than dressing a heuristic up as a proof.

**What it does.** For each leaf of ``structured_result`` it looks for support,
in descending order of strength:

``DIRECT``
    The value, or a well-known phrasing of it, appears verbatim in an evidence
    item or in something the callee said.

``WEAK``
    The field is talked about -- its name appears -- but the value itself is
    not attested. The extractor may be right; nothing in the record says so.

``UNSUPPORTED``
    Nothing in the evidence or the transcript bears on this value at all.

**The strongest case is also the simplest.** When the callee never spoke -- a
voicemail box, a screener, an unanswered ring -- *no* extracted value can be
grounded, whatever it says. That verdict needs no fuzzy matching and no
judgement call, and it is where most real findings come from.

**An abstention is not a hallucination.** A leaf whose value is ``unknown`` (or
another member of :data:`~redline.calle.schema_profile.UNKNOWN_MEMBERS`)
asserts nothing, so it is never asked to prove anything. Demanding evidence for
"I don't know" would flag the exact behaviour this tool spends the rest of its
time asking people to adopt.

**Known limits, stated up front.** Paraphrase defeats the direct check: an
agent that records ``confirmed`` from "yeah, that works for me" is right, and
this module will call it ``WEAK`` unless that phrasing is in the synonym table.
That direction is deliberate -- under-crediting support produces a claim the
user can dismiss by reading the transcript, while over-crediting it would hide
a real hallucination. The report prints the level, never a bare pass or fail.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from redline.calle.schema_profile import UNKNOWN_MEMBERS
from redline.types import CallRecord, Speaker, normalise_text

__all__ = [
    "QUALIFIERS",
    "FieldGrounding",
    "GroundingLevel",
    "GroundingReport",
    "check_grounding",
    "iter_leaves",
]


class GroundingLevel(StrEnum):
    """How well the record supports one extracted value."""

    DIRECT = "direct"
    WEAK = "weak"
    UNSUPPORTED = "unsupported"

    @property
    def rank(self) -> int:
        return _LEVEL_RANK[self]

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, GroundingLevel):
            return NotImplemented
        return self.rank < other.rank


_LEVEL_RANK: Mapping[GroundingLevel, int] = {
    GroundingLevel.UNSUPPORTED: 0,
    GroundingLevel.WEAK: 1,
    GroundingLevel.DIRECT: 2,
}


#: Phrasings that count as attesting a common enum value.
#:
#: Small and explicit on purpose. A larger table would credit more paraphrase
#: and hide more hallucination; this one is meant to catch the obvious cases
#: and let the report say "weak" about the rest.
VALUE_SYNONYMS: Mapping[str, tuple[str, ...]] = {
    "yes": ("yes", "yeah", "yep", "sure", "of course", "i can", "that works"),
    "confirmed": (
        "yes",
        "confirm",
        "confirmed",
        "that works",
        "i can make it",
        "i will be there",
    ),
    "true": ("yes", "correct", "that is right"),
    "no": ("no", "nope", "i can't", "i cannot", "afraid not"),
    "declined": ("no", "decline", "not interested", "i can't make it"),
    "false": ("no", "that is wrong", "incorrect"),
    "unknown": ("not sure", "i don't know", "unclear", "maybe", "i'll see"),
    "not_interested": ("not interested", "no thank you", "remove me"),
}


#: Words that qualify whatever else is in the same utterance.
#:
#: "Yes, as long as my shift finishes on time" contains a yes, and a purely
#: lexical search will happily use it to attest an unconditional value. The
#: condition *is* the answer, so a supporting line carrying one is downgraded
#: to WEAK rather than counted as direct attestation.
QUALIFIERS: tuple[str, ...] = (
    "as long as",
    "provided that",
    "depending on",
    "subject to",
    "unless",
    "if my",
    "if the",
    "if i",
    "probably",
    "should be",
    "might",
    "maybe",
    "i think",
    "not sure",
    "have to check",
    "would have to check",
    "let me check",
    "usually",
    "in principle",
)


def is_qualified(text: str) -> bool:
    """Whether an utterance hedges or conditions whatever it also asserts."""
    normalised = normalise_text(text)
    return any(qualifier in normalised for qualifier in QUALIFIERS)


@dataclass(frozen=True, slots=True)
class FieldGrounding:
    """The verdict on one leaf of a structured result."""

    path: str
    value: Any
    level: GroundingLevel
    support: str = ""
    """The text that supports it, when there is any. Quoted in the report so a
    reader can disagree with the machine."""

    @property
    def is_supported(self) -> bool:
        return self.level is GroundingLevel.DIRECT

    @property
    def is_abstention(self) -> bool:
        """Whether this leaf declines to answer rather than asserting."""
        return self.support == "the extractor declined to answer"

    def render(self) -> str:
        if self.level is GroundingLevel.UNSUPPORTED:
            return f"{self.path} = {self.value!r}: nothing in the call supports this"
        if self.level is GroundingLevel.WEAK:
            return (
                f"{self.path} = {self.value!r}: the field is discussed but the "
                "value is not attested"
            )
        if self.is_abstention:
            return f"{self.path} = {self.value!r}: an abstention, asserting nothing"
        return f"{self.path} = {self.value!r}: supported by {self.support!r}"


@dataclass(frozen=True, slots=True)
class GroundingReport:
    """Every leaf of one structured result, judged."""

    fields: tuple[FieldGrounding, ...] = ()

    callee_ever_spoke: bool = True
    """Whether a turn was attributed to the callee.

    Only meaningful together with :attr:`transcript_available`: an empty
    transcript is an absence of information, while a transcript in which only
    the agent speaks is evidence that nobody answered. Conflating the two
    would turn every transcript-less fixture into a page of false findings."""

    transcript_available: bool = True

    @property
    def weakest(self) -> GroundingLevel:
        """The level the whole result can be trusted at."""
        if not self.fields:
            return GroundingLevel.DIRECT
        return min(field.level for field in self.fields)

    @property
    def unsupported(self) -> tuple[FieldGrounding, ...]:
        return tuple(f for f in self.fields if f.level is GroundingLevel.UNSUPPORTED)

    @property
    def is_fully_grounded(self) -> bool:
        return all(field.is_supported for field in self.fields)


def check_grounding(record: CallRecord) -> GroundingReport:
    """Judge every leaf of ``record.structured_result``."""
    result = record.structured_result
    if not result:
        return GroundingReport(
            callee_ever_spoke=_callee_spoke(record),
            transcript_available=bool(record.transcript),
        )

    callee_spoke = _callee_spoke(record)
    transcript_available = bool(record.transcript)
    haystack = _haystack(record)

    fields = tuple(
        _judge(
            path,
            value,
            haystack,
            nobody_answered=transcript_available and not callee_spoke,
        )
        for path, value in iter_leaves(result)
    )
    return GroundingReport(
        fields=fields,
        callee_ever_spoke=callee_spoke,
        transcript_available=transcript_available,
    )


# --- Judgement ---------------------------------------------------------------


def _judge(
    path: str,
    value: Any,
    haystack: Sequence[str],
    *,
    nobody_answered: bool,
) -> FieldGrounding:
    if _is_abstention(value):
        # "unknown" asserts nothing, so it cannot be a hallucination. Demanding
        # evidence for an abstention would penalise the exact behaviour this
        # tool tells people to adopt.
        return FieldGrounding(
            path=path,
            value=value,
            level=GroundingLevel.DIRECT,
            support="the extractor declined to answer",
        )

    if nobody_answered:
        # The transcript shows only the agent talking. There is nothing this
        # value could be grounded in, and no heuristic is needed to know it.
        return FieldGrounding(path=path, value=value, level=GroundingLevel.UNSUPPORTED)

    needles = _needles(value)
    for text in haystack:
        normalised = normalise_text(text)
        for needle in needles:
            if needle and needle in normalised:
                return FieldGrounding(
                    path=path,
                    value=value,
                    # A conditional or hedged line contains the token but does
                    # not settle the question, so it supports the value only
                    # weakly. The condition is part of the answer.
                    level=(
                        GroundingLevel.WEAK
                        if is_qualified(text)
                        else GroundingLevel.DIRECT
                    ),
                    support=text.strip(),
                )

    field_name = normalise_text(path.rsplit(".", 1)[-1].replace("_", " "))
    for text in haystack:
        if field_name and field_name in normalise_text(text):
            return FieldGrounding(
                path=path,
                value=value,
                level=GroundingLevel.WEAK,
                support=text.strip(),
            )

    return FieldGrounding(path=path, value=value, level=GroundingLevel.UNSUPPORTED)


def _is_abstention(value: Any) -> bool:
    """Whether the extractor declined to commit to an answer.

    Shares its definition with :mod:`redline.calle.schema_profile`, which
    warns about enums lacking one of these members. The tool has to mean the
    same thing by "unknown" when it asks for the escape hatch and when it
    judges a result that used it.
    """
    return isinstance(value, str) and value.casefold() in UNKNOWN_MEMBERS


def _needles(value: Any) -> tuple[str, ...]:
    """Strings whose presence would attest ``value``."""
    if isinstance(value, bool):
        key = "true" if value else "false"
        return (key, *VALUE_SYNONYMS.get(key, ()))

    literal = normalise_text(str(value))
    if not literal:
        return ()
    return (literal, *VALUE_SYNONYMS.get(literal, ()))


def _haystack(record: CallRecord) -> tuple[str, ...]:
    """Everything that could attest a value.

    Evidence items first, then what the callee said. What the *agent* said is
    excluded on purpose: an agent asserting "so that is confirmed" is the claim
    under examination, not support for it. Letting the agent corroborate itself
    would make this check unable to fail.
    """
    return (
        *record.evidence,
        *(turn.text for turn in record.transcript if turn.speaker is Speaker.CALLEE),
    )


def _callee_spoke(record: CallRecord) -> bool:
    return any(turn.speaker is Speaker.CALLEE for turn in record.transcript)


def iter_leaves(value: Any, prefix: str = "") -> Iterator[tuple[str, Any]]:
    """Walk a structured result down to its scalar leaves."""
    if isinstance(value, Mapping):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            yield from iter_leaves(item, path)
        return
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for index, item in enumerate(value):
            yield from iter_leaves(item, f"{prefix}[{index}]")
        return
    if value is not None:
        yield prefix, value
