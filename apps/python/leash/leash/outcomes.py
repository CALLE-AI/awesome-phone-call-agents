"""The shapes every other module agrees on.

Two of these types exist because of things we watched happen on real calls, and it is
worth saying which, because they look like over-engineering otherwise.

``CallOutcome`` keeps ``evidence`` and ``turns`` alongside ``structured_result``
rather than folding them together. CALL-E's extraction failure is silent and total --
when it cannot produce a schema-valid result, ``structured_result`` is ``None`` for
the whole object, not just the field it could not fill. But ``task_completed``,
``completion_confidence``, ``evidence`` and the transcript survive independently. So
those three are the only load-bearing evidence in the failure case, and the policy is
built on them.

``Verdict`` carries every condition it checked, not just the answer. A phone call that
revokes a credential has to be explainable after the fact: "the lease ended because
nobody spoke" and "the lease ended because the caller's stated reason contradicted
their stated choice" are very different events, and an operator reading a log a week
later needs to tell them apart.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Turn:
    """One line of the transcript, as CALL-E reports it.

    ``speaker`` is "bot", "user", or "unknown". Do not assume "user" means a human:
    a voicemail greeting is transcribed as user speech, which is exactly why the
    policy counts turns and characters rather than trusting the label.
    """

    offset_seconds: float
    speaker: str
    text: str


@dataclass(frozen=True)
class CallOutcome:
    """A terminal (or timed-out) call, normalised.

    Every field is optional at the wire level -- the API may omit or null any of
    them -- so everything here tolerates absence and the policy treats absence as
    a failed condition rather than an error.
    """

    call_id: str
    status: str
    task_completed: bool | None
    confidence_score: float | None
    confidence_label: str | None
    structured_result: dict | None
    evidence: tuple[str, ...]
    turns: tuple[Turn, ...]
    failure_code: str | None
    error_code: str | None
    raw: dict
    reached_terminal: bool

    @property
    def user_turns(self) -> tuple[Turn, ...]:
        return tuple(t for t in self.turns if t.speaker == "user")

    @property
    def user_speech_chars(self) -> int:
        """Total characters the caller said.

        Used by the voicemail guard. A recorded greeting produces a short burst of
        "user" speech and then nothing, which is hard to distinguish from a person
        by label alone but easy to distinguish by volume.
        """
        return sum(len(t.text.strip()) for t in self.user_turns)


@dataclass(frozen=True)
class Condition:
    """One of the twelve. ``detail`` is written for a human reading a log later."""

    name: str
    held: bool
    detail: str


@dataclass(frozen=True)
class Verdict:
    """The outcome of policy evaluation.

    ``release`` True means end the lease and revoke the credential. It is the
    default in every uncertain case: the lease continues only when all twelve
    conditions hold, and a single failure -- or an exception, or a timeout, or this
    process dying before it writes an answer -- ends it.
    """

    release: bool
    conditions: tuple[Condition, ...]
    summary: str

    @property
    def failed(self) -> tuple[Condition, ...]:
        return tuple(c for c in self.conditions if not c.held)

    @property
    def held(self) -> tuple[Condition, ...]:
        return tuple(c for c in self.conditions if c.held)
