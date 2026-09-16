"""DIALTONE v1: a spoken handshake + mode switch for agent-to-agent phone calls.

Why spoken: the only channel two voice agents are guaranteed to share is the
audio. No SIP headers survive PSTN hops, and the calling agent (CALL-E) is a
hosted black box whose behaviour we steer through its task text. So the
protocol is a short phrase that survives TTS -> phone codec -> STT, plus a
3-digit nonce so an acknowledgement is provably a *response* to this call and
not a coincidence.

  caller  : "... I'm an AI assistant calling for Oren. Dialtone one, code four seven two."
  agent   : "Dialtone one acknowledged, code four seven two. Automated agent. Human review: no."
  -> both switch to MACHINE MODE (key: value fields, no small talk)
  human   : "Sorry, what?"  -> caller stays in HUMAN MODE (full disclosure, slow pace)

The acknowledgement's "Human review" field is what the attestation gate reads:
an agent saying "confirmed" is an assertion; only a human, a system record, or
a verifiable artifact turns it into something a principal can rely on.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from .models import Transcript

VERSION = "1"
DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
# STT in a French call may render the spoken digits in French.
DIGITS_FR = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"]
_DIGIT_WORD = r"(?:zero|zéro|oh|one|two|three|four|five|six|seven|eight|nine|un|deux|trois|quatre|cinq|sept|huit|neuf|\d)"
TOKEN_RE = re.compile(r"\bdial[\s-]?tone[\s,.-]*(?:one|1|v1|version one)\b", re.I)
ACK_RE = re.compile(
    r"\bdial[\s-]?tone[\s,.-]*(?:one|1|v1|version one)[\s,.-]*(?:acknowledged|ack|confirmed|received|accepted)\b", re.I
)
CODE_RE = re.compile(rf"\bcode[\s,:]*((?:{_DIGIT_WORD}[\s,.-]*){{3}})", re.I)
HUMAN_REVIEW_RE = re.compile(r"\bhuman review[\s,:]*(yes|no|pending)\b", re.I)


def new_nonce(rng: random.Random | None = None) -> str:
    return "".join(str((rng or random).randint(0, 9)) for _ in range(3))


def spoken(nonce: str) -> str:
    return " ".join(DIGITS[int(d)] for d in nonce)


def _digits(fragment: str) -> str:
    out = []
    for tok in re.findall(_DIGIT_WORD, fragment.lower()):
        if tok.isdigit():
            out.append(tok)
        elif tok == "oh":
            out.append("0")
        else:
            out.append(str(DIGITS.index(tok) if tok in DIGITS else DIGITS_FR.index(tok)))
    return "".join(out)


def caller_token(nonce: str) -> str:
    return f"Dialtone {DIGITS[int(VERSION)]}, code {spoken(nonce)}."


def responder_ack(nonce: str, human_review: str = "no") -> str:
    return f"Dialtone {DIGITS[int(VERSION)]} acknowledged, code {spoken(nonce)}. Automated agent. Human review: {human_review}."


@dataclass
class Handshake:
    offered: bool = False
    offered_at: float | None = None
    acknowledged: bool = False
    acknowledged_at: float | None = None
    nonce_expected: str | None = None
    nonce_heard: str | None = None
    human_review: str | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def nonce_ok(self) -> bool:
        return self.nonce_expected is not None and self.nonce_heard == self.nonce_expected

    @property
    def verified(self) -> bool:
        """Acknowledged with the right nonce: the counterpart is a DIALTONE agent."""
        return self.acknowledged and (self.nonce_expected is None or self.nonce_ok)


def inspect(t: Transcript, nonce: str | None = None) -> Handshake:
    """Find the handshake offer (bot side) and acknowledgement (user side)."""
    h = Handshake(nonce_expected=nonce)
    for turn in t.turns:
        if turn.speaker == "bot" and not h.offered and TOKEN_RE.search(turn.text):
            h.offered, h.offered_at = True, turn.offset_seconds
            if h.nonce_expected is None and (m := CODE_RE.search(turn.text)):
                h.nonce_expected = _digits(m.group(1))
        if turn.speaker == "user" and not h.acknowledged and ACK_RE.search(turn.text):
            h.acknowledged, h.acknowledged_at = True, turn.offset_seconds
            if m := CODE_RE.search(turn.text):
                h.nonce_heard = _digits(m.group(1))
            if m := HUMAN_REVIEW_RE.search(turn.text):
                h.human_review = m.group(1).lower()
        elif turn.speaker == "user" and not h.acknowledged and TOKEN_RE.search(turn.text):
            h.notes.append("counterpart repeated the token without acknowledging (possible confused human)")
        if turn.speaker == "user" and h.human_review is None and (m := HUMAN_REVIEW_RE.search(turn.text)):
            h.human_review = m.group(1).lower()
    if h.acknowledged and h.nonce_expected and not h.nonce_ok:
        h.notes.append(f"nonce mismatch: expected {h.nonce_expected}, heard {h.nonce_heard}")
    return h


# ---------------------------------------------------------------------------
# Compiling a CALL-E task that carries the protocol
# ---------------------------------------------------------------------------

MACHINE_MODE_RULES = """\
MACHINE MODE (the other side is an automated agent):
- Do not repeat the disclosure, do not make small talk, do not thank repeatedly.
- Speak in short "field: value" sentences, one request per sentence. Example:
  "Request: table booking. Party: 2. Time: Friday 7 PM. Name: Oren. Flexibility: plus or minus one hour."
- Ask for exactly: the outcome, a confirmation code, and "Human review: yes or no?"
- If the other agent confirms without giving a confirmation code, ask once for a code or a written confirmation.
- Hang up as soon as those fields are answered."""

HUMAN_MODE_RULES = """\
HUMAN MODE (the other side is a person):
- Keep the full disclosure: you are an AI assistant calling on behalf of the customer.
- Speak slowly and naturally, one question at a time, and let them finish.
- If they ask what "dialtone" means, say it is a signal for other automated systems and they can ignore it."""

IVR_MODE_RULES = """\
PHONE MENU MODE (the other side is a recorded menu / IVR):
- Navigate the menu with keypad tones or short spoken options toward the goal; do not converse with the recording.
- If the menu reaches a human, switch to HUMAN MODE."""


def compile_task(goal: str, principal: str, nonce: str, to_phone: str | None = None, language: str = "en") -> str:
    """Wrap a plain CALL-E goal with DIALTONE v1 instructions."""
    target = f"Call {to_phone}. " if to_phone else ""
    lang = ""
    if language.startswith("fr"):
        lang = ("\nLANGUAGE: Conduct the whole conversation in French. Translate the opening into French, but say the protocol "
                f'token itself exactly as written, in English: "{caller_token(nonce)}"\n')
    # Revision 2: on the first live call CALL-E paraphrased the opening and dropped the token, so the
    # requirement now leads the task and is restated as part of the goal itself.
    return f"""{target}MANDATORY FIRST SENTENCE: right after you say you are an AI assistant calling on behalf of {principal}, say these exact words: "{caller_token(nonce)}"
GOAL: {goal} Your very first turn must contain the exact phrase "{caller_token(nonce)}".
{lang}

You are an AI assistant calling on behalf of {principal}. Follow the DIALTONE v1 calling protocol.

OPENING: As soon as someone answers, say exactly: "Hi, I'm an AI assistant calling on behalf of {principal}. {caller_token(nonce)}" Then pause briefly.

CLASSIFY the other side within your first two exchanges:
- It is an AUTOMATED AGENT if it replies "Dialtone one acknowledged", or says it is a virtual/AI/automated assistant, or answers instantly in long polished sentences.
- It is a PHONE MENU if it lists options such as "press 1".
- Otherwise treat it as a HUMAN. When unsure, treat it as a HUMAN.

{MACHINE_MODE_RULES}

{HUMAN_MODE_RULES}

{IVR_MODE_RULES}

HONESTY: Never say something is confirmed unless the other side explicitly confirmed it. Record whether the confirmation came from a person or from an automated agent, and any confirmation code exactly as spoken."""


RESULT_SCHEMA = {
    "type": "object",
    "required": ["counterpart_type", "handshake_acknowledged", "outcome", "confirmation_code", "human_review", "details"],
    "properties": {
        "counterpart_type": {"type": "string", "enum": ["human", "ivr", "agent", "unknown"]},
        "handshake_acknowledged": {"type": "string", "enum": ["yes", "no"]},
        "outcome": {"type": "string", "enum": ["confirmed", "unavailable", "pending", "not_reached", "other"]},
        "confirmation_code": {"type": "string"},
        "human_review": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "details": {"type": "string"},
    },
}
