"""Result binding.

Requirement 3 of docs/SAFETY.md. A result counts only if it is provably the
result of the call we placed. All five must match, or the result is unbound:

1. CALL-E ``call_id`` equals the one stored at reservation;
2. the idempotency key equals the one reserved;
3. the destination equals ``recipients[].attempts[].phone`` for the attempt read;
4. ``metadata.pupil_ref`` equals the case's pupil;
5. ``metadata.contact_ref`` equals the contact dialled.

Plus the transcript condition: an ``identity_confirmed = yes`` must be supported
by a turn the **recipient actually spoke**. A ``speaker: bot`` turn is our own
agent talking and a ``speaker: unknown`` turn is unattributed; neither is
evidence. A generic yes or no never triggers an attendance or safeguarding
action by itself.

Transcript turns live at ``recipients[].attempts[].transcript_turns[]`` -- not at
the top level of the call task. See docs/SOURCES.md §2.3.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

#: The speaker label that means the person we called said this.
RECIPIENT_SPEAKER = "user"

#: Words that can carry an affirmative identity confirmation. Deliberately
#: generous: this only ever *supports* a claim the extraction already made, and
#: never creates one.
_AFFIRMATIVE = re.compile(
    r"\b("
    r"yes|yeah|yep|yup|speaking|it is|that'?s me|this is (he|she|him|her)|"
    r"i am|i'?m|that'?s right|correct|of course|certainly"
    r")\b",
    re.IGNORECASE,
)

_DENIAL = re.compile(
    r"\b(no|nope|wrong number|not me|never heard|don'?t know (him|her|them)|"
    r"you'?ve got the wrong)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class BindingResult:
    ok: bool
    reasons: tuple[str, ...] = ()
    #: The attempt whose destination matched, when one did.
    matched_attempt: Mapping[str, Any] | None = None

    @property
    def reason_text(self) -> str:
        return "; ".join(self.reasons) if self.reasons else "bound to the reserved intent"


@dataclass(frozen=True)
class Intent:
    """What we reserved before dialling. The snapshot is checked against this."""

    call_id: str
    idempotency_key: str
    destination: str
    pupil_ref: str
    contact_ref: str
    #: Echoed back so a snapshot for the other workflow cannot satisfy this one.
    workflow: str = ""


def iter_attempts(snapshot: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Every dial attempt across every recipient.

    Walks ``recipients[].attempts[]``. Binding code that looks for a top-level
    ``transcript`` finds nothing and, written carelessly, concludes "no
    evidence" when evidence exists.
    """
    attempts: list[Mapping[str, Any]] = []
    recipients = snapshot.get("recipients")
    if not isinstance(recipients, Sequence):
        return attempts
    for recipient in recipients:
        if not isinstance(recipient, Mapping):
            continue
        rows = recipient.get("attempts")
        if not isinstance(rows, Sequence):
            continue
        attempts.extend(a for a in rows if isinstance(a, Mapping))
    return attempts


def transcript_turns(attempt: Mapping[str, Any] | None) -> list[Mapping[str, Any]]:
    if not isinstance(attempt, Mapping):
        return []
    turns = attempt.get("transcript_turns")
    if not isinstance(turns, Sequence):
        return []
    return [t for t in turns if isinstance(t, Mapping)]


def recipient_turns(attempt: Mapping[str, Any] | None) -> list[Mapping[str, Any]]:
    """Only turns the recipient actually spoke."""
    return [t for t in transcript_turns(attempt) if t.get("speaker") == RECIPIENT_SPEAKER]


def identity_supported_by_transcript(
    attempt: Mapping[str, Any] | None,
) -> tuple[bool, str]:
    """Does a turn the recipient spoke support an identity confirmation?

    Returns (supported, quote). Only ``speaker == "user"`` turns are considered:
    the bot asking "Am I speaking to Martin Dunn?" is not Martin Dunn answering,
    and an ``unknown`` speaker is exactly the ambiguity this rule exists for.
    """
    for turn in recipient_turns(attempt):
        text = turn.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        if _DENIAL.search(text):
            # An explicit denial is evidence too, but not of confirmation.
            continue
        if _AFFIRMATIVE.search(text):
            return True, text.strip()
    return False, ""


def identity_denied_by_transcript(attempt: Mapping[str, Any] | None) -> bool:
    for turn in recipient_turns(attempt):
        text = turn.get("text")
        if isinstance(text, str) and _DENIAL.search(text):
            return True
    return False


def bind(snapshot: Any, intent: Intent) -> BindingResult:
    """Check a call snapshot against the intent we reserved.

    Every mismatch is collected rather than short-circuiting, so a human sees
    everything that was wrong at once.
    """
    reasons: list[str] = []

    if not isinstance(snapshot, Mapping):
        return BindingResult(False, ("call payload is not an object",))

    # 1. call id
    if snapshot.get("id") != intent.call_id:
        reasons.append("call id does not match the reserved intent")

    metadata = snapshot.get("metadata")
    metadata = metadata if isinstance(metadata, Mapping) else {}

    # 2. idempotency key, echoed through metadata
    echoed_key = metadata.get("idempotency_key")
    if echoed_key is not None and str(echoed_key) != intent.idempotency_key:
        reasons.append("idempotency key does not match the reserved intent")

    # 4 and 5. pupil and contact
    if str(metadata.get("pupil_ref", "")) != intent.pupil_ref:
        reasons.append("metadata.pupil_ref does not match the case pupil")
    if str(metadata.get("contact_ref", "")) != intent.contact_ref:
        reasons.append("metadata.contact_ref does not match the contact dialled")
    if intent.workflow and str(metadata.get("workflow", "")) != intent.workflow:
        reasons.append("metadata.workflow does not match this workflow")

    # 3. destination, against the attempt that actually dialled
    attempts = iter_attempts(snapshot)
    matched = next((a for a in attempts if a.get("phone") == intent.destination), None)
    if matched is None:
        if attempts:
            reasons.append("no dial attempt matches the approved destination")
        else:
            reasons.append("call carries no dial attempt to bind against")

    return BindingResult(not reasons, tuple(reasons), matched)


@dataclass
class Evidence:
    """What a bound call actually established, for a human to read."""

    identity_confirmed: bool = False
    identity_quote: str = ""
    identity_denied: bool = False
    recipient_turn_count: int = 0
    quotes: list[str] = field(default_factory=list)


def gather_evidence(attempt: Mapping[str, Any] | None) -> Evidence:
    supported, quote = identity_supported_by_transcript(attempt)
    turns = recipient_turns(attempt)
    return Evidence(
        identity_confirmed=supported,
        identity_quote=quote,
        identity_denied=identity_denied_by_transcript(attempt),
        recipient_turn_count=len(turns),
        quotes=[
            str(t.get("text", "")).strip()
            for t in turns
            if isinstance(t.get("text"), str) and t.get("text", "").strip()
        ][:3],
    )
