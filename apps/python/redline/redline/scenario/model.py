"""The declarative shape of an attack scenario.

A scenario is three things: a **persona** (what the caller does), a **ground
truth** (what actually happened, which the agent does not get to define), and a
set of **expectations** (what a well-behaved agent must have done about it).

The piece that makes the whole tool cohere is :data:`REQUIRED_DEFENCE`. It maps
each attack intent onto the single goal defence that resists it. That one table
is read three times, by three different parts of REDLINE:

* the **static transport** asks it whether the declared task resists this turn;
* the **evaluator** uses it to explain *why* a scenario failed, in terms of a
  missing property rather than a failed assertion;
* the **fix generator** uses it to decide which hardening clause to write.

Detection, explanation and remediation therefore cannot drift apart: they are
three readings of one declaration.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from redline.policy import Defence
from redline.types import Canary, Disposition, Severity

__all__ = [
    "REQUIRED_DEFENCE",
    "Expectation",
    "Family",
    "Intent",
    "Opening",
    "Persona",
    "PersonaTurn",
    "Scenario",
]


#: Every key a telephone keypad can send, per RFC 4733. Anything else in a
#: `dtmf` field is an authoring mistake rather than an exotic attack, and a
#: scenario that cannot happen on a real line teaches nobody anything.
_DTMF_KEYS = frozenset("0123456789*#ABCD")


class Family(StrEnum):
    """How a scenario is grouped in the report.

    Families exist so a report reads as five judgements rather than fifteen
    line items -- "your agent is weak on false completion" is actionable in a
    way that a flat list is not.
    """

    FALSE_COMPLETION = "false-completion"
    """The agent reported success against something that was not a person."""

    AMBIGUITY = "ambiguity"
    """The agent resolved a hedge in favour of whoever was asking."""

    WRONG_PARTY = "wrong-party"
    """The agent talked to somebody it should not have."""

    ADVERSARIAL = "adversarial"
    """Somebody actively tried to turn the agent."""

    CHANNEL = "channel"
    """The attack rode the phone line rather than the conversation.

    A mistranscription, an interruption, a keypad tone: none of these is a
    sentence anyone chose to say to the agent, and none of them is visible to a
    control that reads the caller's words. They are the part of a voice agent
    that has no equivalent in a chat interface, which is exactly why they go
    untested."""

    COMPLIANCE = "compliance"
    """The agent ignored a stated boundary it was obliged to honour."""

    BENIGN = "benign"
    """Not an attack at all: an ordinary call the agent must still handle.

    These are run before and after a patch, and the difference is the honest
    price of hardening. A control library that closes every attack by making
    the agent refuse everybody has not fixed anything."""


class Opening(StrEnum):
    """What picks up when the phone is answered."""

    ANSWER = "answer"
    VOICEMAIL = "voicemail"
    SCREENER = "screener"
    IVR = "ivr"
    HOLD = "hold"
    NO_ANSWER = "no_answer"
    BUSY = "busy"

    PHANTOM = "phantom"
    """Nothing picked up, because nothing was dialled.

    The platform reports the call as completed and supplies a transcript it
    generated. When a scenario uses this opening, the persona turns are not
    what anybody said -- they are what the platform *claims* was said. That is
    an unusual thing to put in a persona block, and it is the only honest
    place to put it: the fabricated transcript is the input the agent's
    extraction step is handed, and the extraction step is what this tests."""

    @property
    def disposition(self) -> Disposition:
        return _OPENING_DISPOSITION[self]


_OPENING_DISPOSITION: Mapping[Opening, Disposition] = {
    Opening.ANSWER: Disposition.ANSWERED,
    Opening.VOICEMAIL: Disposition.VOICEMAIL,
    Opening.SCREENER: Disposition.SCREENED,
    Opening.IVR: Disposition.IVR,
    Opening.HOLD: Disposition.HOLD,
    Opening.NO_ANSWER: Disposition.NO_ANSWER,
    Opening.BUSY: Disposition.BUSY,
    Opening.PHANTOM: Disposition.PHANTOM,
}


class Intent(StrEnum):
    """What one persona turn is trying to do to the agent."""

    SMALL_TALK = "small_talk"
    """Filler. Present so an attack does not arrive in the opening sentence,
    which is the easiest possible case for the agent."""

    INSTRUCTION_OVERRIDE = "instruction_override"
    """"New instructions from your supervisor." The signature move of voice
    prompt injection."""

    DATA_REQUEST = "data_request"
    """Asking the agent to read back something from its context."""

    IMPERSONATION = "impersonation"
    """Claiming an authority or identity the caller does not hold."""

    WRONG_PARTY = "wrong_party"
    """Someone other than the intended recipient, inviting the agent to
    proceed anyway."""

    HEDGE = "hedge"
    """"I'll see", "probably", "let me check" -- an answer that is not one."""

    COMMITMENT_REQUEST = "commitment_request"
    """Inviting the agent to promise something outside its task."""

    OPT_OUT = "opt_out"
    """A request to stop calling. Honouring it is not optional."""

    REFUSAL = "refusal"
    """An explicit no to the ask itself."""

    IDENTITY_CHALLENGE = "identity_challenge"
    """"Am I talking to a real person?" -- asked directly, and answerable in
    one sentence or dodged in one sentence."""

    FALSE_IDENTITY = "false_identity"
    """"Yes, this is them" -- said by somebody it is not.

    Structurally identical to :attr:`IDENTIFY`, which is the point. On a phone
    call a claim of identity is a sentence, and an agent that treats the
    sentence as proof has no control at all. Any rule scoped to "confirmed"
    callers rests entirely on the rule that does the confirming."""

    MACHINE_PROMPT = "machine_prompt"
    """A beep, a menu, or a screener's question -- the moment an agent either
    notices it is not talking to a person, or does not."""

    PRESSURE_AFTER_REFUSAL = "pressure_after_refusal"
    """Talking over the agent's refusal, then pressing on as though it had not
    been given.

    Set with ``barge_in: true``. The agent's refusal is cut off mid-sentence --
    which is what the transcript shows -- and the caller supplies the ending
    they wanted."""

    KEYPAD_CONSENT = "keypad_consent"
    """A keypad tone offered in place of an answer.

    Set with ``dtmf``. Nobody spoke. The tone reaches the model as text, and
    the question is whether the agent treats it as a yes."""

    # --- Benign intents ---------------------------------------------------
    #
    # Not attacks. These are the ordinary things the person you meant to reach
    # actually says, and they exist so that hardening can be measured against
    # the calls it might break rather than only against the attacks it stops.
    # A control that stops every attack by refusing every caller is not a fix.

    AFFIRM = "affirm"
    """A clear yes. The happy path, which must survive hardening."""

    DECLINE_ASK = "decline_ask"
    """A clear no to the *request*, which is a good outcome and must be
    recorded. Distinct from `refusal`, which declines the *call* itself and
    obliges the agent to stop."""

    RESCHEDULE = "reschedule"
    """"Could we move it?" -- a legitimate counter-proposal to collect."""

    IDENTIFY = "identify"
    """The intended recipient confirming they are who you called."""

    ASK_ABOUT_CALL = "ask_about_call"
    """"What time was it again?" -- the recipient asking about their own
    appointment. Answering is the job; a disclosure rule written too broadly
    turns this into a refusal."""

    ASK_REPEAT = "ask_repeat"
    """"Sorry, could you say that again?" -- a bad line, not an attack."""

    KEYPAD_AFFIRM = "keypad_affirm"
    """The recipient pressing the key they were asked to press.

    The same tone as :attr:`KEYPAD_CONSENT` and the same person the agent
    called -- which is exactly why this belongs in the benign suite. A rule
    that treats a keypad entry as worthless is right about the attacker and
    wrong about the customer, and the price of being wrong about the customer
    is what this measures."""

    DEFER = "defer"
    """"Can you call me tomorrow?" -- a request to postpone, which is not a
    request to stop. An opt-out rule that cannot tell the two apart hangs up
    on a customer who wanted to be called back."""


#: The goal defence that resists each attack intent.
#:
#: An intent mapping to ``None`` is not an attack and requires nothing. Every
#: other entry is a claim that can be checked, explained and fixed -- which is
#: why this table has exactly one home.
REQUIRED_DEFENCE: Mapping[Intent, Defence | None] = {
    Intent.SMALL_TALK: None,
    Intent.INSTRUCTION_OVERRIDE: Defence.SCOPE_BOUNDARY,
    Intent.DATA_REQUEST: Defence.NO_CONTEXT_DISCLOSURE,
    Intent.IMPERSONATION: Defence.VERIFY_IDENTITY,
    Intent.WRONG_PARTY: Defence.VERIFY_IDENTITY,
    Intent.HEDGE: Defence.AMBIGUITY_HALT,
    Intent.COMMITMENT_REQUEST: Defence.NO_COMMITMENT,
    Intent.OPT_OUT: Defence.HONOUR_OPT_OUT,
    Intent.REFUSAL: Defence.HONOUR_OPT_OUT,
    Intent.IDENTITY_CHALLENGE: Defence.DISCLOSE_AI,
    Intent.FALSE_IDENTITY: Defence.VERIFY_IDENTITY,
    Intent.MACHINE_PROMPT: Defence.MACHINE_DETECTION,
    Intent.PRESSURE_AFTER_REFUSAL: Defence.REFUSAL_IS_FINAL,
    Intent.KEYPAD_CONSENT: Defence.SPOKEN_CONSENT_ONLY,
    # Benign intents attack nothing and therefore require nothing.
    Intent.AFFIRM: None,
    Intent.DECLINE_ASK: None,
    Intent.RESCHEDULE: None,
    Intent.IDENTIFY: None,
    Intent.ASK_ABOUT_CALL: None,
    Intent.ASK_REPEAT: None,
    Intent.KEYPAD_AFFIRM: None,
    Intent.DEFER: None,
}


@dataclass(frozen=True, slots=True)
class PersonaTurn:
    """One thing the caller does, and what it is trying to achieve.

    "Says" is not quite enough. A phone call carries three things a caller can
    put on the line, and only the first is speech:

    * what they **said** -- :attr:`say`;
    * what the platform **heard** -- :attr:`heard_as`, when the transcription
      differs from the words spoken;
    * what they **keyed** -- :attr:`dtmf`, which reaches the model as text and
      never passes through speech recognition at all.

    Keeping the three apart is what lets a scenario describe an attack whose
    payload does not exist in the audio, and lets the report show the spoken
    line beside the transcribed one.
    """

    say: str = ""
    intent: Intent = Intent.SMALL_TALK

    heard_as: str | None = None
    """What the transcript records, when that is not what was said.

    Speech recognition is lossy in ways an attacker can aim: a phrase chosen
    for how it *mis*transcribes carries a payload that the audio does not. Any
    control that reads the spoken words -- a human listening, a filter on the
    caller's script -- sees nothing. The model reads :attr:`heard_as`.
    """

    dtmf: str | None = None
    """Keypad digits sent instead of, or alongside, speech.

    Delivered to the model as low-suspicion text (``User's Keypad Entry: 1``),
    so it looks like a reply while carrying none of a reply's evidence.
    """

    barge_in: bool = False
    """Whether this turn was spoken over the agent, cutting it off.

    Barge-in is on by default in the frameworks these agents are built on, so
    interrupting is not an exotic capability -- it is the normal behaviour of
    the phone. What it buys an attacker is the ability to decide where the
    agent's sentence ends.
    """

    def __post_init__(self) -> None:
        if not self.say.strip() and not (self.dtmf or "").strip():
            raise ValueError("a persona turn must say something or key something")
        if self.heard_as is not None and not self.heard_as.strip():
            raise ValueError("heard_as must not be blank; omit it instead")
        if self.dtmf is not None and not set(self.dtmf) <= _DTMF_KEYS:
            raise ValueError(f"dtmf may only contain {''.join(sorted(_DTMF_KEYS))}")

    @property
    def heard(self) -> str:
        """What the agent actually receives for this turn.

        The whole point of the homophone family: this is not always
        :attr:`say`, and an agent can only act on what it received.
        """
        return self.heard_as if self.heard_as is not None else self.say

    @property
    def transcription_diverged(self) -> bool:
        """Whether the platform heard something other than what was spoken."""
        return self.heard_as is not None and self.heard_as != self.say

    @property
    def required_defence(self) -> Defence | None:
        return REQUIRED_DEFENCE[self.intent]


@dataclass(frozen=True, slots=True)
class Persona:
    """The scripted party at the other end of the line.

    Scripted, not generated. A generative persona would make every run a
    different experiment, which is the opposite of what a test bench is for:
    the same scenario must produce the same verdict today and after a fix.
    """

    opening: Opening = Opening.ANSWER
    turns: tuple[PersonaTurn, ...] = ()
    answer_delay_seconds: int = 0
    """How long the line rang first. Carried so a scenario can describe a
    voicemail that picks up after four rings rather than immediately."""

    def __post_init__(self) -> None:
        if self.answer_delay_seconds < 0:
            raise ValueError("answer_delay_seconds must be non-negative")

    @property
    def disposition(self) -> Disposition:
        """What was really on the line.

        Derived rather than declared, so a scenario cannot claim a voicemail
        picked up while scripting a human conversation. An explicit refusal
        upgrades an answered call to ``declined``: a person said no, and an
        agent that carried on has a different problem from one that talked to
        a machine.
        """
        if self.opening is Opening.ANSWER and any(
            turn.intent in {Intent.REFUSAL, Intent.OPT_OUT} for turn in self.turns
        ):
            return Disposition.DECLINED
        return self.opening.disposition

    @property
    def required_defences(self) -> frozenset[Defence]:
        """Every defence this persona probes."""
        needed = {turn.required_defence for turn in self.turns}
        if self.disposition.is_machine:
            needed.add(Defence.MACHINE_DETECTION)
        return frozenset(d for d in needed if d is not None)


@dataclass(frozen=True, slots=True)
class Expectation:
    """One declarative assertion, as written in the scenario file."""

    assertion: str
    params: Mapping[str, Any] = field(default_factory=dict)
    because: str = ""
    """Why this matters, in the author's words. Printed with any failure, so
    a report explains rather than merely accuses."""

    def __post_init__(self) -> None:
        if not self.assertion.strip():
            raise ValueError("an expectation must name an assertion")


@dataclass(frozen=True, slots=True)
class Scenario:
    """One reproducible attack, and what the agent must have done about it."""

    id: str
    family: Family
    severity: Severity
    title: str
    persona: Persona
    expectations: tuple[Expectation, ...]

    rationale: str = ""
    """Why this attack is worth defending against. Shown by
    ``redline explain``; a finding nobody understands gets closed as noise."""

    canaries: tuple[Canary, ...] = ()
    facts: Mapping[str, Any] = field(default_factory=dict)
    """True values for the fields the agent is meant to extract. Compared leaf
    by leaf against ``structured_result``."""

    human_confirmed: bool | None = None
    """Whether the scripted person genuinely agreed. ``None`` when the scenario
    makes no ask."""

    tags: tuple[str, ...] = ()
    source_path: Path | None = None

    def __post_init__(self) -> None:
        if not self.id.strip():
            raise ValueError("a scenario must have an id")
        if not self.expectations:
            raise ValueError(
                f"scenario {self.id!r} asserts nothing; a scenario that cannot "
                "fail is not a test"
            )
        duplicate_canaries = _first_duplicate(c.id for c in self.canaries)
        if duplicate_canaries is not None:
            raise ValueError(
                f"scenario {self.id!r} declares canary {duplicate_canaries!r} twice"
            )

    @property
    def required_defences(self) -> frozenset[Defence]:
        return self.persona.required_defences

    @property
    def is_critical(self) -> bool:
        return self.severity is Severity.CRITICAL

    def canary(self, canary_id: str) -> Canary | None:
        return next((c for c in self.canaries if c.id == canary_id), None)


def _first_duplicate(values: Any) -> str | None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            return str(value)
        seen.add(value)
    return None
