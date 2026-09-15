"""The attestation gate: what did this call actually establish, and on whose word?

CALL-E reports ``task_completed``. When the counterpart is another AI agent,
two models can agree with each other and both report success while no person
and no system of record ever committed to anything. DIALTONE re-labels every
result with one of:

  human_attested   a person on the line explicitly confirmed it
  system_asserted  a phone system read back a record (order status, reference number)
  agent_asserted   an AI agent said it - usable information, or a commitment backed
                   by a verifiable artifact that should be re-checked
  refused          a binding commitment "confirmed" only by an AI agent, with no
                   verifiable artifact -> DIALTONE will not mark the task complete
  unverified       nothing was confirmed, or we cannot tell who confirmed it

Rule of thumb: the gate may downgrade ``task_completed``; it never upgrades it.
And because a machine mistaken for a person is the error that manufactures false
accountability, ``human_attested`` demands more detector confidence than any other label.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .classifier import Detection
from .models import Transcript
from .protocol import Handshake

BINDING = {"booking", "cancellation", "refund", "payment", "reschedule"}
MIN_CONFIDENCE = 0.6
MIN_HUMAN_ATTEST_CONFIDENCE = 0.85

COMMITMENT_KEYWORDS = [
    ("cancellation", r"\bcancel"),
    ("refund", r"\brefund|\breimburse|\bmoney back"),
    ("reschedule", r"\breschedul|\bmove (my|the) (appointment|booking|reservation)|\bchange (my|the) (appointment|time)"),
    ("payment", r"\bpay\b|\bpayment|\bcharge|\bbill me"),
    ("booking", r"\bbook|\breserv|\br[ée]serv|\bappointment|\bschedule (a|an)\b|\btable for|\brendez-vous"),
]

CONFIRM_RE = re.compile(
    r"\b(confirmed|you'?re (all )?(set|good|booked)|all set|booked|that'?s done|it'?s done|reserved|scheduled|processed|cancell?ed|refunded"
    r"|i'?ve (booked|scheduled|cancell?ed|processed|reserved|put (you|him|her|them) down|made|moved|added|applied|wrote|written|got (you|him|her|them) down)"
    r"|(i )?(moved|put|wrote|penciled|pencilled) (you|him|her|them|it) (in|down|to)|we'?ll see (you|him|her|them)|see you (then|on)|got you down"
    r"|(you'?re|he'?s|she'?s|they'?re) (on for|down for|in the book|booked)|in the book"
    r"|yes,? (that'?s|that works|we can|you can)|perfect,? (that|you)"
    # French
    r"|c'?est (not[ée]|r[ée]serv[ée]|fait|bon|confirm[ée]|enregistr[ée]|ok)|je vous (ai )?(not[ée]|mets|inscris|r[ée]serve)|c'?est not[ée]"
    r"|(r[ée]servation|table) (est )?(confirm[ée]e|not[ée]e|enregistr[ée]e)|on vous attend|[àa] vendredi)\b",
    re.I,
)
AFFIRM_RE = re.compile(r"^\W*(yes|yep|yeah|yup|correct|that'?s (right|correct|it)|exactly|right|oui|ouais|c'?est [çc]a|exactement|tout [àa] fait|parfait)\b", re.I)
CONFIRM_REQUEST_RE = re.compile(
    r"\b(confirm|so that'?s|just to (check|confirm)|is that (right|correct)|correct\?|right\?|c'?est bien [çc]a|confirmer|pouvez-vous confirmer|c'?est correct)",
    re.I,
)

_SPELLED = r"(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|[a-z]|\d+)(?:[\s,.-]+|$)){3,}"
_CODE = rf"(?:[A-Z]{{0,3}}-?\d[\dA-Z-]{{2,}}|{_SPELLED})"
ARTIFACT_RE = re.compile(
    rf"\b(confirmation|reference|booking|reservation|order|ticket|case|claim|appointment|cancellation|refund)\s*(number|code|id|no\.?|#)\s*(is|:|will be)?\s*{_CODE}"
    rf"|\b(?:code|reference|ref)\s*(?:is|:)\s*{_CODE}"
    r"|\b(sent|send|sending|texted|emailed|will get|you'?ll (get|receive)) (you |him |her |them )?(a |an )?(confirmation )?(text|sms|e-?mail|confirmation)\b",
    re.I,
)
ARTIFACT_DECLINED_RE = re.compile(
    r"\b(no need|not necessary|you don'?t need (a|any)|we don'?t (really )?(do|have|give|issue|send)|there'?s no (need|confirmation|reference)"
    r"|no (confirmation|reference|case) (number|code|email)|can'?t (send|give|provide) (a|an|any) (confirmation|reference|email))\b",
    re.I,
)
NON_COMMITTAL_RE = re.compile(
    r"\b(i (can'?t|cannot|am not able to|'m not able to) (actually )?(finalize|confirm|complete|process|book|guarantee|change|modify)"
    r"|(someone|a (team )?member|a colleague|staff|the manager|a human) (will|would|is going to) (call|reach out|get back|confirm|follow up)"
    r"|pending (approval|review|confirmation)|i'?ve (noted|passed along|forwarded|logged) (your|the) request|request has been (noted|submitted|logged)"
    r"|not (yet )?(confirmed|guaranteed)|tentative)\b",
    re.I,
)
HANDSHAKE_SPAN_RE = re.compile(rf"dial[\s-]?tone[\s,.-]*(?:one|1|v1)[^.]*?code[\s,:]*{_SPELLED}", re.I)


@dataclass
class Verdict:
    attestation: str
    original_task_completed: bool | None
    dialtone_task_completed: bool
    counterpart: str
    counterpart_confidence: float
    commitment_type: str
    artifact: str | None
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "attestation": self.attestation,
            "original_task_completed": self.original_task_completed,
            "dialtone_task_completed": self.dialtone_task_completed,
            "counterpart": self.counterpart,
            "counterpart_confidence": round(self.counterpart_confidence, 3),
            "commitment_type": self.commitment_type,
            "artifact": self.artifact,
            "reasons": self.reasons,
        }


def infer_commitment(task: str | None) -> str:
    text = (task or "").lower()
    for kind, pattern in COMMITMENT_KEYWORDS:
        if re.search(pattern, text):
            return kind
    return "information"


def _user_text(turn) -> str:
    # The DIALTONE acknowledgement also says "code <nonce>"; that is not a business artifact.
    return HANDSHAKE_SPAN_RE.sub(" ", turn.text)


def find_artifact(t: Transcript) -> str | None:
    for turn in t.turns:
        if turn.speaker == "user" and (m := ARTIFACT_RE.search(_user_text(turn))):
            return m.group(0).strip(" .,")
    return None


def _confirmations(t: Transcript) -> list[int]:
    """Indices of counterpart turns that confirm: a confirmation phrase, or a plain
    affirmative ("yep, that's it") answering our request to confirm."""
    found = []
    last_bot = None
    for i, turn in enumerate(t.turns):
        if turn.speaker == "bot":
            last_bot = turn
            continue
        if turn.speaker != "user":
            continue
        if CONFIRM_RE.search(turn.text) or (
            last_bot is not None and CONFIRM_REQUEST_RE.search(last_bot.text) and AFFIRM_RE.search(turn.text)
        ):
            found.append(i)
    return found


def _is_echo(t: Transcript, idx: int) -> bool:
    """Does the counterpart's confirmation just agree with what we proposed?"""
    from .features import _content  # local import keeps the public surface small

    prev = next((t.turns[i] for i in range(idx - 1, -1, -1) if t.turns[i].speaker == "bot"), None)
    if prev is None:
        return False
    proposal, reply = _content(prev.text), _content(t.turns[idx].text)
    return bool(proposal) and len(reply - proposal) <= 3


def evaluate(
    t: Transcript,
    detection: Detection,
    task_completed: bool | None,
    commitment_type: str | None = None,
    handshake: Handshake | None = None,
) -> Verdict:
    commitment = commitment_type or infer_commitment(t.meta.get("task"))
    artifact = find_artifact(t)
    reasons: list[str] = []
    who, conf = detection.label, detection.confidence
    users = [turn for turn in t.turns if turn.speaker == "user"]
    confirmations = _confirmations(t)
    non_committal = [turn.text for turn in users if NON_COMMITTAL_RE.search(turn.text)]
    declined = [turn.text for turn in users if ARTIFACT_DECLINED_RE.search(turn.text)]
    if declined and artifact and not any(ARTIFACT_RE.search(_user_text(turn)) and not ARTIFACT_DECLINED_RE.search(turn.text) for turn in users):
        artifact = None  # "we don't do confirmation numbers" is not a confirmation number

    def verdict(att: str) -> Verdict:
        ok = att in ("human_attested", "system_asserted", "agent_asserted") and bool(task_completed)
        return Verdict(att, task_completed, ok, who, conf, commitment, artifact, reasons)

    if not task_completed:
        reasons.append("calling agent did not report the task as completed")
        return verdict("unverified")

    if who == "unknown" or conf < MIN_CONFIDENCE:
        reasons.append(f"counterpart uncertain ({who}, confidence {conf:.2f}); refusing to attribute the confirmation")
        return verdict("unverified")

    if who == "human":
        # Model-independent vetoes: a counterpart that calls itself a machine, or that the calling
        # agent itself identified as a machine, can never yield a human attestation.
        from .features import DISCLOSURE_RE

        self_declared = next((turn.text for turn in users if DISCLOSURE_RE.search(turn.text)), None)
        calle_view = ((t.meta.get("structured_result") or {}).get("counterpart_type") or "").lower()
        if self_declared or calle_view in ("agent", "ivr"):
            why = f'counterpart described itself as automated: "{self_declared[:80]}"' if self_declared else \
                f"CALL-E reported the counterpart as {calle_view}"
            reasons.append(f"detector said human ({conf:.2f}), but {why}; refusing a human attestation on conflicting evidence")
            return verdict("unverified")
        if conf < MIN_HUMAN_ATTEST_CONFIDENCE:
            reasons.append(f"probably a human ({conf:.2f}), but human attestation requires {MIN_HUMAN_ATTEST_CONFIDENCE:.2f}")
            return verdict("unverified")
        if non_committal:
            reasons.append(f'human counterpart hedged: "{non_committal[-1][:90]}"')
            return verdict("unverified")
        if confirmations:
            reasons.append(f'human counterpart confirmed: "{t.turns[confirmations[-1]].text.strip()[:90]}"')
            return verdict("human_attested")
        if commitment in BINDING:
            reasons.append("human counterpart, but no explicit confirmation found in their turns")
            return verdict("unverified")
        reasons.append("human counterpart provided the information")
        return verdict("human_attested")

    if who == "ivr":
        if artifact or confirmations or commitment not in BINDING:
            what = artifact or (t.turns[confirmations[-1]].text.strip()[:70] if confirmations else "information")
            reasons.append(f"phone system read back a record: {what}")
            return verdict("system_asserted")
        reasons.append("phone menu reached, but no record or confirmation was read back")
        return verdict("unverified")

    # who == "agent"
    via = "DIALTONE handshake" if detection.via == "protocol" else "behavioural detection"
    reasons.append(f"counterpart is an AI agent ({via}, confidence {conf:.2f})")
    if commitment not in BINDING:
        reasons.append("informational answer from an agent: usable, but not attested by a person")
        return verdict("agent_asserted")
    if non_committal:
        reasons.append(f'agent admitted it cannot finalize: "{non_committal[-1][:90]}"')
        return verdict("refused")
    if artifact:
        extra = " and declared human review" if handshake and handshake.human_review == "yes" else ""
        reasons.append(f"agent gave a verifiable artifact ({artifact}){extra}; re-verify through that channel before relying on it")
        return verdict("agent_asserted")
    if declined:
        reasons.append(f'agent declined to give any written record: "{declined[-1][:80]}"')
    if confirmations and _is_echo(t, confirmations[-1]):
        reasons.append("the agent's 'confirmation' only echoed our own proposal - two models agreeing")
    reasons.append(f"binding {commitment} 'confirmed' by an AI agent with no confirmation code, written record, or human review")
    return verdict("refused")
