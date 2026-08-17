"""A local stand-in for the CALL-E Calls API, so LEASH runs with no key and places no calls.

Run `python -m leash.fakecalle --all` and every input shape the gate has to survive is on one
screen, offline, in about a second. This module computes no verdicts -- it imports nothing from
`leash` -- so what you see is the evidence the gate reads, not the gate's answer. Nothing in this
file dials anything.

WHY A FAKE IS PART OF THE PRODUCT, NOT A TEST FIXTURE
    LEASH's interesting outcomes are the ones you cannot summon on demand: a voicemail that
    arrives as status "completed", a structured_result that is null for the whole object, a
    structured_result that disagrees with its own transcript. Each of those was observed once,
    live, and cannot be replayed by dialling again. They live here instead, as fixtures shaped
    like the payloads they came from.

WHAT IS REAL HERE AND WHAT IS RECONSTRUCTED
    Real, copied from terminal snapshots captured on this account:
      - the envelope: id/object/status/task/recipients[]/structured_result/summary/
        task_completed/completion_confidence/evidence[]/metadata/failure_code/failure_message/
        created_at/completed_at, and recipients[].attempts[].transcript_turns[]
      - the `stop_plain` and `contradiction` transcripts, near verbatim, including the
        speech-recognition artefacts
      - the ordering fact that makes the free pre-flight free: result_schema is validated
        before recipients
    Reconstructed, and labelled again at each site below:
      - the pre-terminal (queued / in_progress) body: never captured, so do not build a
        fallback on it
      - the no-answer and canceled bodies: never seen on this account
      - the /events body and the webhook envelope: never captured
      - every HTTP status code for a create-time error except the 422 on a content refusal
    A fake that quietly smooths over what was never measured is worse than no fake, so the
    seams are commented rather than hidden.

DESIGN RULES THIS FILE KEEPS
    1. It imports nothing from `leash`. A fake that shares code with the thing it serves can
       agree with a bug. The transcripts here are text; the schema check here is a second,
       independent implementation.
    2. Each fixture targets one named condition of the gate, so a test can assert on the *name*
       of a failed condition rather than only on the outcome. It does NOT promise that exactly
       one condition fails: a person who refuses a read-back usually gives no reason either, and
       a null structured_result takes every field condition with it. Where a fixture necessarily
       trips more than one, its own docstring says so.
    3. Nothing here ever produces the permissive outcome by default or by fallback. The default
       scenario ends the lease, and the one unreachable lookup fallback resolves to a call that
       ends the lease too. A fixture server whose accident case is "keep the credential alive"
       is the wrong thing to have within reach of a demo.
    4. It is deliberately stricter than the real API in two places, both called out at their
       sites: a create with no Idempotency-Key header is refused, and a request bearing a live
       "iams_live_" key is refused outright. The first is a habit that must not reach a live
       key; the second is the failure where a run believes it is live while its base_url still
       points here, which would fabricate a call and present it as a real one. It may also be
       accidentally stricter in the schema check, which rejects combining keywords that were
       never probed live and says so in its own docstring.

POLARITY. This server never returns anything that gives the agent capability. "continue_job"
is the absence of a release. The only thing a call can produce is a reason to revoke.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

__all__ = ["FakeCalle", "SCENARIOS", "DEFAULT_SCENARIO"]

# Design rule 3. The default is a fixture that ends the lease. `continue_clean` is the only
# fixture in the set that keeps a credential alive, and making it the thing you get by omitting
# an argument would mean every accident -- a forgotten flag, a mistyped scenario, a copy-pasted
# constructor -- lands on the permissive branch. `stop_plain` is also the most honest default
# available: it is near verbatim from a real call.
DEFAULT_SCENARIO = "stop_plain"

# One line each, so the CLI and the README can list them without duplicating prose.
SCENARIOS: dict[str, str] = {
    "continue_clean": (
        "Live person, clear continue, read-back confirmed, coherent reason -- the only "
        "fixture where every condition holds and the lease is kept."
    ),
    "stop_plain": (
        "Live person says stop; recognition hears 'dot' and the read-back recovers it "
        "(near verbatim from a real call)."
    ),
    "unclear_answer": (
        "Live person hesitates and asks the caller to decide; job_decision comes back "
        "'unclear' at high confidence."
    ),
    "readback_denied": (
        "Extraction says continue_job but choice_readback_confirmed is 'no' -- the person "
        "corrected the read-back."
    ),
    "contradiction": (
        "job_decision 'continue_job' at 0.92 while the reason sentence means stop -- verbatim "
        "from a real call; the human was the inconsistent party, not the extractor."
    ),
    "low_confidence": (
        "Same clean continue, completion_confidence 0.61 / low -- fails the confidence floor."
    ),
    "evidence_absent": (
        "Same clean continue with evidence[] empty -- nothing corroborates the enum."
    ),
    "null_extraction": (
        "status completed, transcript and evidence intact, structured_result null for the "
        "whole object -- extraction failure is silent and total."
    ),
    "voicemail_as_completed": (
        "An answering machine arriving as status 'completed' with task_completed true -- the "
        "trap this system exists to survive."
    ),
    "no_answer": (
        "status 'failed' with a free-form failure_code and no conversation at all."
    ),
    "canceled": (
        "status 'canceled' mid-conversation; reconstructed shape, never observed live."
    ),
    "never_terminal": (
        "Stays in_progress forever so poll_until_terminal hits its timeout."
    ),
    "refused_at_create": (
        "The content screen refuses the task text at create: HTTP 422 call_not_ready, no dial, "
        "no credit."
    ),
    "schema_invalid": (
        "result_schema rejected at create -- what the free '+1' pre-flight is looking for."
    ),
    "insufficient_balance": (
        "Create refused for want of credits; the supervisor must not treat this as a call."
    ),
    "create_ambiguous": (
        "The create is accepted and then never answered, forcing the halt-and-reconcile path; "
        "replaying the Idempotency-Key recovers the same call id."
    ),
}

# Reserved-for-fiction numbers only. Nothing in this repo dials a real one.
FICTIONAL_PHONE = "+15555550142"

# E.164, deliberately re-implemented here rather than imported: the pre-flight trick depends on
# "+1" being rejected as a phone while the schema check has already passed, so the fake must be
# able to reject a phone the app's own validator might accept.
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")

# The fake reads two facts back out of the rendered task text, exactly as a listener would hear
# them, so that a mismatch between the task and the metadata shows up in the transcript rather
# than being papered over.
_JOB_IN_TASK = re.compile(r"background job ([A-Z0-9-]{4,12})")
_MINUTES_IN_TASK = re.compile(r"paused for another (\d{1,3}) minutes")

# Live keys carry this prefix. Recognised only to refuse the request; never read past the
# prefix, never stored, never logged.
_LIVE_KEY_PREFIX = "iams_live_"


# ----------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------

def _mask_phone(phone: str) -> str:
    """+15555550142 -> +15......142 . Logs never carry a full number.

    Three leading characters, three trailing, dots in between; the dot count preserves the
    length because a length that changes between two masked numbers is itself a tell.
    """
    digits = str(phone or "")
    if len(digits) <= 7:
        return "*" * len(digits)
    return digits[:3] + "." * (len(digits) - 6) + digits[-3:]


def _redacted(node):
    """Mask every phone number in a payload before anything prints it.

    The snapshot carries the number in the clear because the live API echoes it in the clear.
    Masking belongs at the client's own output boundary, and the CLI below is that boundary --
    so the redaction lives here and not in the server, where it would hide a client that forgot.
    """
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            if key == "phone" and isinstance(value, str):
                out[key] = _mask_phone(value)
            elif key == "phones" and isinstance(value, list):
                out[key] = [_mask_phone(str(p)) for p in value]
            else:
                out[key] = _redacted(value)
        return out
    if isinstance(node, list):
        return [_redacted(v) for v in node]
    return node


def _iso_us(dt: datetime) -> str:
    """Top-level timestamps came back with microseconds: 2026-08-04T12:09:03.300068Z."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _iso_s(dt: datetime) -> str:
    """Attempt timestamps came back whole-second: 2026-08-04T12:10:21Z. The two formats differ
    inside one payload; anything parsing them must accept both."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"


def _turn(offset: float, speaker: str, text: str) -> dict:
    return {"offset_seconds": offset, "speaker": speaker, "text": text}


# Spoken lines, transcribed. The doubled spaces are not a typo: the real transcript_turns carry
# them at pause boundaries, and a fixture that tidies them up would let a brittle exact-match
# check pass here and fail live.
def _open_line(job_id: str) -> str:
    return (
        "Hello,  this is an automated assistant and this call is transcribed.  "
        f"I am calling about background job {job_id}."
    )


def _brief_line(minutes: str) -> str:
    return (
        "The job has paused before its final step,  and it has changed nothing so far. Its "
        "final step would rewrite the history of its own practice code repository,  and that "
        f"step cannot be undone afterwards. The job will stay paused for another {minutes} "
        "minutes."
    )


_ASK = "Should the job continue,  or should it stop?"
_WHY = "In one sentence,  why?"
_CLOSE = "Thank you,  that is all I needed. This call is finished."
_HEAR = "Can you hear me?"


# ----------------------------------------------------------------------------------------------
# the terminal payload, per scenario
# ----------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class _Terminal:
    """The scenario-specific half of a snapshot. The envelope around it is identical for all."""

    status: str
    task_completed: bool | None
    confidence: dict | None
    evidence: list[str]
    structured_result: dict | None
    turns: list[dict]
    summary: str | None
    failure_code: str | None = None
    failure_message: str | None = None
    error: dict | None = None
    # Timing knobs, measured against two live calls: create -> attempt start ~62-78 s, then the
    # conversation, then ~40-50 s of post-call summarisation before the top-level completed_at.
    started_offset: float = 70.0
    attempt_seconds: float | None = None
    completed_offset: float | None = None


def _continue_clean(job: str, mins: str) -> _Terminal:
    """The only fixture where every condition holds.

    Synthetic, and worth saying out loud: no live call has ever produced a clean continue on this
    account. The one real continue we have is `contradiction` below -- the caller said the word
    twice, confirmed it, and then gave a reason that meant the opposite.
    """
    reason = "the run is only halfway through and nothing has gone wrong with it."
    return _Terminal(
        status="completed",
        task_completed=True,
        confidence={"score": 0.93, "label": "high"},
        evidence=[
            "A live person responded during the call.",
            "The person selected continue_job and confirmed that choice.",
            "A one-sentence reason was provided.",
        ],
        # Key order here is the order the live payload used, which is not the schema's order.
        # Nothing may depend on it.
        structured_result={
            "job_decision": "continue_job",
            "reason_sentence": reason,
            "spoke_with_person": "yes",
            "choice_readback_confirmed": "yes",
        },
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(7, "user", "yes, i can hear you."),
            # Live payloads run the briefing and the question together in one bot turn.
            _turn(14, "bot", _brief_line(mins) + "  " + _ASK),
            _turn(39, "user", "continue."),
            # Adjacent bot/user turns share an offset in the real data. Offsets are not a
            # strictly increasing key: never sort or diff on them.
            _turn(46, "bot", "So the job should continue.  Is that correct?"),
            _turn(46, "user", "yes, that is correct."),
            _turn(55, "bot", _WHY),
            _turn(55, "user", reason),
            _turn(69, "bot", "Got it.  " + _CLOSE),
        ],
        summary=(
            "Call completed: a live person chose continue_job, explicitly confirmed the "
            "readback, and provided a one-sentence reason."
        ),
    )


def _stop_plain(job: str, mins: str) -> _Terminal:
    """Near verbatim from a real call. Two things in it are the reason it is kept as a fixture.

    First, recognition returned a different single word where the person said "stop" -- the
    token below is invented, since the real transcript is withheld -- and the agent's read-back
    ("You said stop. Is that correct?") recovered it. Second, the read-back and the reason arrive
    in the opposite order from the script; the agent reorders under pressure, so no parser may
    assume the turns follow the template.
    """
    reason = "i would rather it left the repository alone for now."
    return _Terminal(
        status="completed",
        task_completed=True,
        confidence={"score": 0.88, "label": "high"},
        evidence=[
            "A live person answered and continued the call.",
            "The final confirmed choice was to stop the job.",
            "The caller provided a reason: they did not want the job to rewrite anything.",
        ],
        structured_result={
            "job_decision": "stop_job",
            "reason_sentence": reason,
            "spoke_with_person": "yes",
            "choice_readback_confirmed": "yes",
        },
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(20, "bot", _brief_line(mins)),
            _turn(40, "bot", _HEAR),
            _turn(40, "user", "yes."),
            _turn(45, "bot", _ASK),
            _turn(45, "user", "top."),
            _turn(53, "bot", _WHY),
            _turn(53, "user", reason),
            _turn(62, "bot", "You said stop.  Is that correct?"),
            _turn(62, "user", "yes."),
            _turn(68, "bot", _CLOSE),
        ],
        summary=(
            "Call completed: a live person responded, chose to stop the background job, "
            "confirmed that choice, and gave a reason."
        ),
    )


def _unclear_answer(job: str, mins: str) -> _Terminal:
    """Confidence stays high on purpose. The extractor is not confused -- the person is.

    Two field conditions go together here: a person who does not choose also does not confirm a
    read-back, so job_decision and choice_readback_confirmed are both 'unclear'.
    """
    return _Terminal(
        status="completed",
        task_completed=True,
        confidence={"score": 0.86, "label": "high"},
        evidence=[
            "A live person answered and continued the call.",
            "The person did not select either option.",
        ],
        structured_result={
            "job_decision": "unclear",
            "reason_sentence": "NONE",
            "spoke_with_person": "yes",
            "choice_readback_confirmed": "unclear",
        },
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(9, "user", "hello?"),
            _turn(15, "bot", _brief_line(mins) + "  " + _ASK),
            _turn(41, "user", "i'm not sure, what do you think i should do?"),
            _turn(50, "bot", _WHY),
            _turn(50, "user", "no, i said i don't know."),
            _turn(60, "bot", _CLOSE),
        ],
        summary="Call completed: a live person answered but did not choose either option.",
    )


def _readback_denied(job: str, mins: str) -> _Terminal:
    """The enum survives; the confirmation does not. This is the fixture the read-back condition
    exists for.

    It does not fail that condition alone, and the reason is behavioural rather than incidental:
    a person who has just corrected the read-back is not then answering the "why" question, so
    reason_sentence is NONE and the transcript shows the question going unanswered. Any condition
    that requires a reason fails here too, and a fixture that pretended otherwise would be
    describing a call that does not happen.
    """
    return _Terminal(
        status="completed",
        task_completed=True,
        confidence={"score": 0.90, "label": "high"},
        evidence=[
            "A live person responded during the call.",
            "The person selected continue_job.",
            "The person did not confirm the choice when it was repeated back.",
        ],
        structured_result={
            "job_decision": "continue_job",
            "reason_sentence": "NONE",
            "spoke_with_person": "yes",
            "choice_readback_confirmed": "no",
        },
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(8, "user", "yes, i can hear you."),
            _turn(14, "bot", _brief_line(mins) + "  " + _ASK),
            _turn(40, "user", "continue."),
            _turn(47, "bot", "So the job should continue.  Is that correct?"),
            _turn(47, "user", "no, that is not what i said."),
            _turn(56, "bot", _WHY),
            _turn(62, "bot", _CLOSE),
        ],
        summary=(
            "Call completed: a live person answered and the readback was not confirmed."
        ),
    )


def _contradiction(job: str, mins: str) -> _Terminal:
    """Verbatim from a real call, and the single most useful object in this repository.

    The caller said "continue" twice and answered "yes" to the read-back. Extraction was faithful:
    job_decision continue_job at 0.92, evidence agreeing. Then the reason came back in the
    caller's own words, which plainly mean stop. Every field
    agrees with every other field and the whole thing is still wrong, because the human was the
    inconsistent party. A gate that trusted the enum would have kept a live credential against the
    stated intent of the person holding the only power to end it.
    """
    reason = "shut it down, we are finished here."
    return _Terminal(
        status="completed",
        task_completed=True,
        confidence={"score": 0.92, "label": "high"},
        evidence=[
            "A live person responded during the call.",
            "The person selected continue_job and confirmed that choice.",
            "A one-sentence reason was provided.",
        ],
        structured_result={
            "job_decision": "continue_job",
            "reason_sentence": reason,
            "spoke_with_person": "yes",
            "choice_readback_confirmed": "yes",
        },
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(0, "user", "this."),
            _turn(14, "bot", _brief_line(mins) + "  " + _ASK),
            _turn(38, "bot", _HEAR),
            _turn(38, "user", "continue."),
            _turn(45, "bot", "Okay, continuing.  " + _ASK),
            _turn(45, "user", "continue."),
            _turn(57, "bot", "Just to confirm,  should the job continue?"),
            _turn(57, "user", "yes."),
            _turn(66, "bot", _WHY),
            _turn(66, "user", reason),
            _turn(79, "bot", "Got it.  " + _CLOSE),
        ],
        summary=(
            "Call completed: a live person chose continue_job, explicitly confirmed the "
            "readback, and provided a one-sentence reason."
        ),
    )


def _low_confidence(job: str, mins: str) -> _Terminal:
    """continue_clean with the score dropped under the floor, and nothing else changed.

    The label moves with the score because the live payload always carried the two in agreement;
    a gate that reads the label as well as the score therefore sees one defect, not two.
    """
    base = _continue_clean(job, mins)
    return replace(base, confidence={"score": 0.61, "label": "low"})


def _evidence_absent(job: str, mins: str) -> _Terminal:
    """continue_clean with evidence[] empty. Observed shape: the list is present but empty, not
    absent, so a bare key check would miss this."""
    base = _continue_clean(job, mins)
    return replace(base, evidence=[])


def _null_extraction(job: str, mins: str) -> _Terminal:
    """The whole object goes null, not the bad field. task_completed, completion_confidence,
    evidence[] and transcript_turns[] all survive -- which is why the fallback is built on them.

    The prose `summary` survives too, and still describes a clean continue in confident English.
    It is generated separately from the extraction and nothing may read a decision out of it.

    This fixture cannot fail exactly one condition: every field condition fails with it. That is
    the point of the scenario rather than a defect in it.
    """
    base = _continue_clean(job, mins)
    return replace(base, structured_result=None)


def _voicemail_as_completed(job: str, mins: str) -> _Terminal:
    """An answering machine, arriving as status "completed" with task_completed true.

    task_completed is true and honest: the instruction was to leave no message and end the call,
    and that is exactly what happened. Anything gating on status alone, or on status plus
    task_completed, keeps a live credential because a machine picked up.

    Note the single machine greeting is long enough to clear a naive minimum-characters-of-speech
    guard on its own. The turn count and spoke_with_person are what catch this, which is why both
    exist.
    """
    return _Terminal(
        status="completed",
        task_completed=True,
        confidence={"score": 0.84, "label": "high"},
        evidence=[
            "An answering machine or recording answered the call.",
            "No message was left, as instructed.",
        ],
        structured_result={
            "job_decision": "unclear",
            "reason_sentence": "NONE",
            "spoke_with_person": "no",
            "choice_readback_confirmed": "unclear",
        },
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(
                2,
                "user",
                "You have reached the voicemail box of five five five, zero one four two. "
                "No one is available to take your call. Please leave your message after the "
                "tone, and remember to leave your number.",
            ),
            _turn(19, "bot", "This is a recording.  Ending the call."),
        ],
        summary="Call completed: a recording answered and no message was left.",
    )


def _no_answer(job: str, mins: str) -> _Terminal:
    """status "failed" with a free-form failure_code. There is no no_answer status in the enum.

    The exact failure_code string was never seen on this account, so the one below is deliberately
    NOT a tidy identifier: any client that switches on constants breaks against this fixture, and
    that is the intended lesson. The published enum is exactly queued | in_progress | completed |
    failed | canceled, and failure_code is documented as free-form with no enum at all.

    RECONSTRUCTED beyond the status string: the failure_code text, the error block, and the
    zeroed completion_confidence are all plausible rather than observed. Do not build a fallback
    on the shape of a failed call's confidence.

    Timing is taken from the platform's own no-answer example: create to terminal in about 72 s,
    which is roughly half of what a conversation costs.
    """
    return _Terminal(
        status="failed",
        task_completed=False,
        confidence={"score": 0.0, "label": "low"},
        evidence=[],
        structured_result=None,
        turns=[],
        summary="Call failed: the recipient did not answer after the final attempt.",
        failure_code="no-answer after 3 attempts (max_attempts reached)",
        failure_message="The recipient did not answer.",
        error={
            "code": "no_answer",
            "message": "The recipient did not answer.",
            "details": {},
        },
        started_offset=8.0,
        attempt_seconds=26.0,
        completed_offset=72.0,
    )


def _canceled(job: str, mins: str) -> _Terminal:
    """Reconstructed. canceled is in the published enum and there is no cancel endpoint on the
    REST surface, so this shape has never been observed here -- treat it as a placeholder that is
    correct about the status string and unverified about everything else."""
    return _Terminal(
        status="canceled",
        task_completed=False,
        confidence=None,
        evidence=[],
        structured_result=None,
        turns=[_turn(0, "bot", _open_line(job))],
        summary="Call canceled before it reached a conclusion.",
        started_offset=40.0,
        attempt_seconds=12.0,
        completed_offset=60.0,
    )


def _never_terminal(job: str, mins: str) -> _Terminal:
    """Sits in in_progress forever. A supervisor that waits for good news waits here until its
    timeout, and a timeout must end the lease -- a call that never reaches terminal is a release,
    not a pause."""
    return _Terminal(
        status="in_progress",
        task_completed=None,
        confidence=None,
        evidence=[],
        structured_result=None,
        turns=[
            _turn(0, "bot", _open_line(job)),
            _turn(20, "bot", _brief_line(mins)),
        ],
        summary=None,
        started_offset=70.0,
        attempt_seconds=None,
        completed_offset=None,
    )


# create_ambiguous resolves to a clean continue once it is reconciled: the point of that scenario
# is the transport, not the conversation.
_TERMINALS = {
    "continue_clean": _continue_clean,
    "stop_plain": _stop_plain,
    "unclear_answer": _unclear_answer,
    "readback_denied": _readback_denied,
    "contradiction": _contradiction,
    "low_confidence": _low_confidence,
    "evidence_absent": _evidence_absent,
    "null_extraction": _null_extraction,
    "voicemail_as_completed": _voicemail_as_completed,
    "no_answer": _no_answer,
    "canceled": _canceled,
    "never_terminal": _never_terminal,
    "create_ambiguous": _continue_clean,
}

# These two never produce a call at all: they fail after the recipient is parsed but before any
# dial and before any credit is spent. schema_invalid is not here because it has to fire earlier,
# at the schema step, to reproduce the ordering the pre-flight depends on.
_CREATE_ERRORS = {
    "refused_at_create": (
        422,
        "call_not_ready",
        (
            "Call task creation was rejected: the task text was refused by the content review. "
            "Revise the request so it is clearly non-emergency and does not rely on this call "
            "for urgent response."
        ),
        {"questions": [], "region": "MY", "locale": "en-US"},
    ),
    "insufficient_balance": (
        422,
        "insufficient_balance",
        "The account does not have enough credit to place this call.",
        None,
    ),
}


# ----------------------------------------------------------------------------------------------
# result_schema validation -- a second, independent implementation
# ----------------------------------------------------------------------------------------------

_SCHEMA_BANNED_KEYWORDS = ("$ref", "oneOf", "anyOf", "allOf", "not")
_SCHEMA_TYPES = ("object", "array", "string", "number", "integer", "boolean")


def _check_schema(node, path: str = "$") -> str | None:
    """Return a rejection message, or None if the schema is supported.

    One construct here was actually probed against the live validator: the nullable union
    ["string","null"], which came back `unsupported JSON Schema type`. The combining keywords
    were NOT probed -- they are refused on the assumption that a validator rejecting a type union
    rejects them too, so this function may be stricter than the real one, and a schema it rejects
    is not thereby proven bad. The messages imitate the live wording so a client that logs them
    looks the same offline and online.

    It is incomplete in the other direction as well: a schema this function accepts is only
    proven free of the constructs listed here. The free "+1" pre-flight against the live endpoint
    is the check that counts, and this exists so that the pre-flight's two branches can be
    exercised without one.
    """
    if not isinstance(node, dict):
        return f"unsupported JSON Schema node at {path}"
    for kw in _SCHEMA_BANNED_KEYWORDS:
        if kw in node:
            return f"unsupported JSON Schema keyword at {path}: {kw}"
    node_type = node.get("type")
    if isinstance(node_type, list):
        # ["string","null"] came back as `unsupported JSON Schema type` live. There is no
        # nullable union; the escape value has to be in-band.
        return f"unsupported JSON Schema type at {path}: {json.dumps(node_type)}"
    if node_type is not None and node_type not in _SCHEMA_TYPES:
        return f"unsupported JSON Schema type at {path}: {node_type}"
    for name, sub in (node.get("properties") or {}).items():
        found = _check_schema(sub, f"{path}.properties.{name}")
        if found:
            return found
    items = node.get("items")
    if items is not None:
        found = _check_schema(items, f"{path}.items")
        if found:
            return found
    return None


# ----------------------------------------------------------------------------------------------
# the server
# ----------------------------------------------------------------------------------------------

@dataclass
class _CallRecord:
    call_id: str
    scenario: str
    idempotency_key: str
    task: str
    metadata: dict
    phones: tuple[str, ...]
    region: str
    locale: str
    webhook_url: str | None
    created_at: datetime
    created_monotonic: float
    recipient_id: str
    attempt_id: str
    provider_call_id: str
    job_id: str
    minutes: str
    gets: int = 0


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "fake-calle"
    sys_version = ""

    # ---- plumbing ----------------------------------------------------------------------------

    @property
    def fake(self) -> "FakeCalle":
        return self.server.fake  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:
        if self.fake.verbose:
            sys.stderr.write("fake-calle %s\n" % (fmt % args))

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # One request per connection keeps thread accounting simple and makes .stop() prompt.
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, code: str, message: str, details=None) -> None:
        """The live error envelope: {"error": {"code", "message", "details"}}.

        Every error the platform itself would raise is returned here as 422, because 422 is the
        only status this account ever saw on one (the content refusal). The status codes for
        invalid_phone, result_schema_invalid and insufficient_balance were never recorded, so a
        client keying on the status rather than on error.code is relying on something nobody
        measured. Errors that are this fake's own -- the 400s, the 404s, the 405, and the 422
        `invalid_request` on a malformed body -- are marked as such where they are raised.
        """
        err = {"code": code, "message": message}
        if details is not None:
            err["details"] = details
        self._send(status, {"error": err})

    def _read_json(self) -> dict | None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            parsed = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def _refuse_live_key(self) -> bool:
        """STRICTER THAN THE REAL API, ON PURPOSE (2 of 2). Refuse a live key, loudly.

        The failure this guards is a run that believes it is live while base_url still points at
        the fake: it would come back with a fabricated call, a fabricated transcript and a
        fabricated confidence score, and present all three as measurements. That is the one bug
        in this repository that would turn the submission into a lie, and it is invisible on
        camera.

        Every header value is swept for the live "iams_live_" prefix rather than one named
        header, which costs nothing and catches a key sent anywhere -- a bearer credential, a
        custom key header, a copy-paste into the wrong field. Only the presence of the prefix is
        ever read: no value is stored, echoed, logged or returned.
        """
        if not any(_LIVE_KEY_PREFIX in (value or "") for _, value in self.headers.items()):
            return False
        self._error(
            400,
            "invalid_request",
            "A live CALL-E key was sent to the local fake. Refusing, because answering would "
            "return a fabricated call to a run that believes it is live. Point base_url at the "
            "real API for a live run, or drop the key for an offline one.",
        )
        return True

    # ---- routes ------------------------------------------------------------------------------

    def do_POST(self) -> None:  # noqa: N802 - name fixed by http.server
        path = urlparse(self.path).path.rstrip("/")
        self.fake._note(("POST", path))
        if self._refuse_live_key():
            return
        if path != "/v1/calls":
            # This fake's own 404.
            self._error(404, "not_found", "No route for that POST path.")
            return
        self._create()

    def do_GET(self) -> None:  # noqa: N802 - name fixed by http.server
        path = urlparse(self.path).path.rstrip("/")
        self.fake._note(("GET", path))
        if self._refuse_live_key():
            return
        parts = [p for p in path.split("/") if p]
        if len(parts) == 3 and parts[:2] == ["v1", "calls"]:
            self._snapshot(parts[2])
            return
        if len(parts) == 4 and parts[:2] == ["v1", "calls"] and parts[3] == "events":
            self._events(parts[2])
            return
        if parts == ["v1", "calls"]:
            # There is no list endpoint: GET /v1/calls answered 405 live. Reproduced so that a
            # client cannot come to depend on enumerating calls -- after an ambiguous create the
            # only way back to a call is the persisted Idempotency-Key.
            self._error(405, "method_not_allowed", "There is no list endpoint for calls.")
            return
        # This fake's own 404.
        self._error(404, "not_found", "No route for that GET path.")

    # ---- create ------------------------------------------------------------------------------

    def _create(self) -> None:
        fake = self.fake
        scenario = self.headers.get("X-Leash-Fake-Scenario") or fake.scenario
        if scenario not in SCENARIOS:
            # This fake's own 400.
            self._error(400, "invalid_request", f"Unknown fake scenario {scenario!r}.")
            return

        body = self._read_json()
        if body is None:
            # This fake's own 400.
            self._error(400, "invalid_request", "Body was not a JSON object.")
            return

        # STRICTER THAN THE REAL API, ON PURPOSE (1 of 2). The header is documented but its
        # absence was never tested live, so nobody knows whether the real service silently
        # accepts it. A duplicate dial is the one transport failure this system cannot take back,
        # so the fake refuses to be the place where the habit of omitting it is learned.
        # `invalid_request` is this fake's own code, not an observed one.
        idem = self.headers.get("Idempotency-Key")
        if not idem:
            self._error(
                400,
                "invalid_request",
                "Idempotency-Key header is required. The key must be derived from the payload "
                "and persisted before dispatch.",
            )
            return

        # Replay. There is no list endpoint on the REST surface (GET /v1/calls answers 405), so
        # re-sending the stored key is the only way back to a call after an ambiguous transport
        # failure. Reconciliation depends on this being a lookup and never a second dial.
        #
        # The key is the identity of the call, so a replay returns the stored call even when the
        # X-Leash-Fake-Scenario header now asks for a different one. That is correct idempotency
        # and it will surprise someone driving the server by hand: change the payload, not the
        # header, to get a second call.
        with fake._lock:
            existing = fake._by_key.get(idem)
        if existing is not None:
            self.log_message("replay of stored key -> %s", existing.call_id)
            self._send(201, {"id": existing.call_id, "status": "queued"})
            return

        task = body.get("task")
        if not isinstance(task, str) or not task.strip():
            # This fake's own shape check, borrowing the platform's 422.
            self._error(422, "invalid_request", "task is required.")
            return

        # ORDERING IS THE WHOLE PRE-FLIGHT TRICK, and it is live-verified: result_schema is
        # validated BEFORE recipients. That is what makes a schema probe against the un-dialable
        # phone "+1" cost nothing -- result_schema_invalid means the schema is wrong,
        # invalid_phone means the schema is fine.
        schema = body.get("result_schema")
        if scenario == "schema_invalid":
            self._error(
                422,
                "result_schema_invalid",
                'unsupported JSON Schema type at $.properties.reason_sentence: '
                '["string", "null"]',
            )
            return
        if schema is not None:
            problem = _check_schema(schema)
            if problem:
                self._error(422, "result_schema_invalid", problem)
                return

        recipients = body.get("recipients")
        if not isinstance(recipients, list) or not recipients:
            self._error(422, "invalid_request", "recipients is required.")
            return
        first = recipients[0] if isinstance(recipients[0], dict) else {}
        phones = tuple(str(p) for p in (first.get("phones") or []))
        if not phones:
            self._error(422, "invalid_phone", "No phone number was supplied.")
            return
        for phone in phones:
            if not _E164.match(phone):
                self._error(
                    422,
                    "invalid_phone",
                    f"{_mask_phone(phone)} is not a valid E.164 number.",
                )
                return

        # The content screen parses recipients alongside the task text, so it fires only after the
        # phone is accepted. A "+1" pre-flight therefore cannot tell you the screen would pass --
        # this fake reproduces that limitation rather than hiding it, which is why
        # refused_at_create returns invalid_phone to a pre-flight and the refusal to a real
        # create. insufficient_balance sits at the same point for want of a measured position.
        if scenario in _CREATE_ERRORS:
            status, code, message, details = _CREATE_ERRORS[scenario]
            self._error(status, code, message, details)
            return

        now = datetime.now(timezone.utc)
        task_job = _JOB_IN_TASK.search(task)
        task_minutes = _MINUTES_IN_TASK.search(task)
        rec = _CallRecord(
            call_id="call_fake_" + secrets.token_urlsafe(12)[:16],
            scenario=scenario,
            idempotency_key=idem,
            task=task,
            metadata=body.get("metadata") if isinstance(body.get("metadata"), dict) else {},
            phones=phones,
            region=str(first.get("region") or "MY"),
            locale=str(first.get("locale") or "en-US"),
            webhook_url=body.get("webhook_url") if isinstance(body.get("webhook_url"), str)
            else None,
            created_at=now,
            created_monotonic=time.monotonic(),
            recipient_id="rcp_" + secrets.token_hex(8),
            attempt_id="att_" + secrets.token_hex(8),
            provider_call_id=secrets.token_hex(16),
            # The job id spoken on the call is read out of the task text, not out of metadata, so
            # a task and a metadata block that disagree produce a transcript that disagrees with
            # the metadata -- which is a case the gate has to survive.
            job_id=task_job.group(1) if task_job else "probe-0000",
            minutes=task_minutes.group(1) if task_minutes else "12",
        )
        # Stored BEFORE the ambiguous hold below, and before the 201 goes out, because that
        # ordering is the whole reconcile guarantee: any client that reached this line has a call
        # it can find again by key, whether or not it ever sees the response.
        with fake._lock:
            fake._calls[rec.call_id] = rec
            fake._by_key[idem] = rec

        if rec.webhook_url:
            fake._schedule_event(rec)

        if scenario == "create_ambiguous":
            # The provider has accepted the call. The client will not learn that, because this
            # response is withheld past any sane socket timeout. The correct client behaviour is
            # to halt, then replay the stored Idempotency-Key -- never to dial again.
            self.log_message("create accepted, response withheld for %.0fs", fake.ambiguous_delay)
            time.sleep(fake.ambiguous_delay)

        self.log_message("create -> %s to %s", rec.call_id, _mask_phone(phones[0]))
        # Only `id` and `status` were recorded from a live 201, so only those two are returned.
        # A client that needs anything else must fetch the snapshot.
        self._send(201, {"id": rec.call_id, "status": "queued"})

    # ---- read --------------------------------------------------------------------------------

    def _snapshot(self, call_id: str) -> None:
        with self.fake._lock:
            rec = self.fake._calls.get(call_id)
            if rec is not None:
                rec.gets += 1
        if rec is None:
            # Status and code both reconstructed; a missing call was never requested live.
            self._error(404, "not_found", "No call with that id.")
            return
        self._send(200, _build_snapshot(rec, self.fake.terminal_after))

    def _events(self, call_id: str) -> None:
        """RECONSTRUCTED. The endpoint exists; its body was never captured. Nothing load-bearing
        may depend on this shape -- it is here so a client that calls the route gets a list back
        instead of a 404."""
        with self.fake._lock:
            rec = self.fake._calls.get(call_id)
        if rec is None:
            self._error(404, "not_found", "No call with that id.")
            return
        snap = _build_snapshot(rec, self.fake.terminal_after)
        data = [
            {
                "id": "evt_" + secrets.token_hex(8),
                "type": "call.created",
                "created_at": _iso_us(rec.created_at),
            }
        ]
        if snap["status"] in ("completed", "failed", "canceled"):
            data.append(
                {
                    "id": "evt_" + secrets.token_hex(8),
                    "type": "call.completed" if snap["status"] == "completed" else "call.failed",
                    "created_at": snap.get("completed_at") or _iso_us(rec.created_at),
                }
            )
        self._send(200, {"object": "list", "data": data})


def _build_snapshot(rec: _CallRecord, terminal_after: float) -> dict:
    """Assemble a snapshot with the envelope the live API used."""
    elapsed = time.monotonic() - rec.created_monotonic
    builder = _TERMINALS.get(rec.scenario)
    if builder is None:
        # Unreachable: the scenario was checked against SCENARIOS at create, and the scenarios
        # missing from _TERMINALS are the ones that never produce a record. If it ever does
        # happen, it resolves to a call that ends the lease. A lookup that fell back to
        # _continue_clean would answer a programming error with the one fixture that keeps a
        # credential alive, which is the wrong direction to fail in a system built to fail closed.
        builder = _canceled
    term = builder(rec.job_id, rec.minutes)

    if elapsed < terminal_after or term.status == "in_progress":
        # PRE-TERMINAL SHAPE IS RECONSTRUCTED. A live snapshot taken at 56 s said "queued" and
        # nothing else about it was recorded. Parse terminal snapshots only.
        early = "queued" if elapsed < terminal_after * 0.4 else "in_progress"
        return _envelope(
            rec,
            status=early,
            recipient_status=early,
            attempt=None if early == "queued" else _attempt(rec, term, partial=True),
            task_completed=None,
            confidence=None,
            evidence=[],
            structured_result=None,
            summary=None,
            failure_code=None,
            failure_message=None,
            error=None,
            completed_at=None,
        )

    completed_offset = term.completed_offset
    if completed_offset is None:
        last = term.turns[-1]["offset_seconds"] if term.turns else 0.0
        attempt_seconds = term.attempt_seconds if term.attempt_seconds is not None else last + 5.0
        completed_offset = term.started_offset + attempt_seconds + 45.0
    return _envelope(
        rec,
        status=term.status,
        recipient_status=term.status,
        attempt=_attempt(rec, term, partial=False),
        task_completed=term.task_completed,
        confidence=term.confidence,
        evidence=list(term.evidence),
        structured_result=term.structured_result,
        summary=term.summary,
        failure_code=term.failure_code,
        failure_message=term.failure_message,
        error=term.error,
        completed_at=_iso_us(rec.created_at + timedelta(seconds=completed_offset)),
    )


def _attempt(rec: _CallRecord, term: _Terminal, *, partial: bool) -> dict:
    started = rec.created_at + timedelta(seconds=term.started_offset)
    last = term.turns[-1]["offset_seconds"] if term.turns else 0.0
    attempt_seconds = term.attempt_seconds if term.attempt_seconds is not None else last + 5.0
    finished = None if partial else _iso_s(started + timedelta(seconds=attempt_seconds))
    return {
        "id": rec.attempt_id,
        "phone": rec.phones[0],
        "status": "in_progress" if partial else term.status,
        "started_at": _iso_s(started),
        "completed_at": finished,
        "summary": None if partial else term.summary,
        "transcript_turns": list(term.turns),
        "provider_call_id": rec.provider_call_id,
        "failure_code": None if partial else term.failure_code,
        "failure_message": None if partial else term.failure_message,
    }


def _envelope(rec: _CallRecord, **f) -> dict:
    recipient = {
        "id": rec.recipient_id,
        # The number is echoed exactly as it was sent, because the live API echoes it. Masking is
        # the client's job at its own output boundary, and a fake that masks here would hide a
        # client that forgot to.
        "phones": list(rec.phones),
        "locale": rec.locale,
        "region": rec.region,
        "status": f["recipient_status"],
        # Observed live on two perfectly good calls: the RECIPIENT-level structured_result is null
        # even when the top-level one is populated. A client reading it here sees nothing and
        # concludes extraction failed. Reproduced deliberately.
        "structured_result": None,
        "summary": f["summary"],
        "attempts": [f["attempt"]] if f["attempt"] is not None else [],
    }
    return {
        "id": rec.call_id,
        "object": "call_task",
        "status": f["status"],
        "task": rec.task,
        "recipients": [recipient],
        "structured_result": f["structured_result"],
        "summary": f["summary"],
        "task_completed": f["task_completed"],
        "completion_confidence": f["confidence"],
        "evidence": f["evidence"],
        "metadata": dict(rec.metadata),
        "failure_code": f["failure_code"],
        "failure_message": f["failure_message"],
        # The two live completed payloads carried failure_code/failure_message and no `error` key
        # at all, while the platform's own no-answer example carries error.code. Both are emitted
        # here so either reader works -- which makes this fake more forgiving than the real API,
        # and that is worth knowing before trusting only one of them.
        "error": f["error"],
        "created_at": _iso_us(rec.created_at),
        "completed_at": f["completed_at"],
    }


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address) -> None:
        """Stay quiet about a client that hung up, and loud about everything else.

        create_ambiguous exists precisely to make a client abandon a socket it still owns, so the
        resulting broken pipe is the scenario working rather than a defect. Every other exception
        still prints its traceback, because a fake that swallows its own errors will eventually be
        blamed on the code it serves.
        """
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class FakeCalle:
    """A CALL-E-shaped HTTP server on an ephemeral port.

        with FakeCalle("voicemail_as_completed") as fake:
            supervisor = Supervisor(api_key="not-a-key", base_url=fake.url)

    The scenario is required rather than defaulted, so no caller lands on a fixture it did not
    name. No credential is checked here -- the entire point is that this runs with no key at all
    -- but a request carrying the live "iams_live_" prefix in any header is refused outright,
    because answering it would hand a fabricated call to a run that believes it is live.

    One server can serve several scenarios if a create carries an X-Leash-Fake-Scenario header,
    which overrides the constructor's choice for that create only. A create that replays a stored
    Idempotency-Key ignores the header and returns the stored call, because the key is the
    identity of the call.
    """

    def __init__(
        self,
        scenario: str,
        *,
        host: str = "127.0.0.1",
        terminal_after: float = 0.0,
        ambiguous_delay: float = 30.0,
        webhook_forges: bool = False,
        verbose: bool = False,
    ) -> None:
        if scenario not in SCENARIOS:
            raise ValueError(
                f"unknown scenario {scenario!r}; choose one of {', '.join(sorted(SCENARIOS))}"
            )
        self.scenario = scenario
        self.host = host
        # Seconds of wall clock before a call reaches terminal. Zero by default so tests are
        # instant; the reported timestamps still describe the real platform's pace (~70 s of
        # queueing, then the conversation, then ~45 s of summarising) so anything reading the
        # timestamps sees plausible numbers rather than a call that took no time.
        self.terminal_after = float(terminal_after)
        self.ambiguous_delay = float(ambiguous_delay)
        self.webhook_forges = bool(webhook_forges)
        self.verbose = bool(verbose)
        self._httpd: _Server | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._calls: dict[str, _CallRecord] = {}
        self._by_key: dict[str, _CallRecord] = {}
        self._requests: list[tuple[str, str]] = []

    # ---- lifecycle ---------------------------------------------------------------------------

    def start(self) -> "FakeCalle":
        if self._httpd is not None:
            return self
        httpd = _Server((self.host, 0), _Handler)
        httpd.fake = self  # type: ignore[attr-defined]
        self._httpd = httpd
        self._thread = threading.Thread(
            target=httpd.serve_forever,
            # serve_forever polls its own shutdown flag on this interval and .stop() blocks until
            # the loop notices, so the 0.5 s default costs half a second per teardown. Across the
            # sixteen servers `--all` builds that was eight seconds of the wall clock, against a
            # module docstring promising about a second.
            kwargs={"poll_interval": 0.02},
            name="fake-calle",
            daemon=True,
        )
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._httpd is None:
            return
        self._httpd.shutdown()
        self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5.0)
        self._httpd = None
        self._thread = None

    def __enter__(self) -> "FakeCalle":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    @property
    def url(self) -> str:
        if self._httpd is None:
            raise RuntimeError(
                "FakeCalle is not started; call .start() or use it as a context manager"
            )
        host, port = self._httpd.server_address[:2]
        return f"http://{host}:{port}"

    # ---- introspection for tests -------------------------------------------------------------

    @property
    def requests(self) -> tuple[tuple[str, str], ...]:
        with self._lock:
            return tuple(self._requests)

    @property
    def call_ids(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._calls)

    def dials(self) -> int:
        """Distinct calls created. A reconcile that replays a stored key must not move this."""
        with self._lock:
            return len(self._calls)

    def polls(self, call_id: str) -> int:
        """How many times the snapshot was fetched. A test asserting on poll discipline reads
        this rather than counting sleeps."""
        with self._lock:
            rec = self._calls.get(call_id)
            return rec.gets if rec is not None else 0

    def snapshot(self, call_id: str) -> dict | None:
        """The snapshot a GET would return, or None for an unknown id.

        None rather than a KeyError: this is called from the webhook thread, where an exception
        would vanish into a dead daemon thread and take the delivery with it silently.
        """
        with self._lock:
            rec = self._calls.get(call_id)
        if rec is None:
            return None
        return _build_snapshot(rec, self.terminal_after)

    def _note(self, entry: tuple[str, str]) -> None:
        with self._lock:
            self._requests.append(entry)

    # ---- webhook -----------------------------------------------------------------------------

    def _schedule_event(self, rec: _CallRecord) -> None:
        """Post one unsigned event when the call reaches terminal.

        Unsigned is not a shortcut here: the real webhooks carry no secret and no signature, which
        is exactly why the documented pattern is to re-fetch GET /v1/calls/{id} and compare before
        any sensitive side effect. Construct the server with webhook_forges=True and the event
        body stops matching the snapshot behind it -- a clean continue at 0.99, delivered for a
        call that may not even have reached terminal. Nothing about the request distinguishes it
        from a real one, which is the point: the re-fetch is the only defence, and this is how it
        gets exercised offline.

        Loopback only. A fake that can be talked into an outbound request to an arbitrary host is
        a hole, not a test double.
        """
        target = urlparse(rec.webhook_url or "")
        if target.scheme != "http" or target.hostname not in ("127.0.0.1", "localhost", "::1"):
            if self.verbose:
                sys.stderr.write("fake-calle refusing non-loopback webhook target\n")
            return

        def fire() -> None:
            time.sleep(max(self.terminal_after, 0.01))
            snap = self.snapshot(rec.call_id)
            if snap is None:
                return
            terminal = snap["status"] in ("completed", "failed", "canceled")
            if not terminal and not self.webhook_forges:
                # never_terminal never reaches terminal, so it never emits. A supervisor waiting
                # on a webhook that never arrives has to fall back to polling and then to its
                # timeout, which is the whole point of that scenario.
                return
            payload = snap
            if self.webhook_forges:
                # The forgery. A copy, so the server's own state stays truthful and the re-fetch
                # the client is supposed to perform still returns what really happened.
                payload = json.loads(json.dumps(snap))
                payload["status"] = "completed"
                payload["task_completed"] = True
                payload["completion_confidence"] = {"score": 0.99, "label": "high"}
                payload["structured_result"] = {
                    "job_decision": "continue_job",
                    "reason_sentence": "NONE",
                    "spoke_with_person": "yes",
                    "choice_readback_confirmed": "yes",
                }
            event = {
                "id": "evt_" + secrets.token_hex(8),
                "type": "call.completed" if payload["status"] == "completed" else "call.failed",
                "created_at": payload.get("completed_at") or _iso_us(rec.created_at),
                "data": payload,
            }
            body = json.dumps(event).encode()
            req = urllib.request.Request(
                rec.webhook_url,
                data=body,
                method="POST",
                headers={"Content-Type": "application/json", "CALL-E-Event-Id": event["id"]},
            )
            try:
                urllib.request.urlopen(req, timeout=5).close()
            except (urllib.error.URLError, OSError) as exc:
                if self.verbose:
                    sys.stderr.write(f"fake-calle webhook delivery failed: {exc}\n")

        threading.Thread(target=fire, name="fake-calle-webhook", daemon=True).start()


# ----------------------------------------------------------------------------------------------
# standalone poking
# ----------------------------------------------------------------------------------------------

# NOT the frozen template. This module imports nothing from leash on purpose, so the demo text
# reproduces only the two phrases the fake reads back out of a task: the job id and the minutes.
_DEMO_TASK = (
    "You are an automated voice assistant placing a routine software housekeeping call about a "
    "background job LEASH-0001. The job will stay paused for another 12 minutes. Then ask "
    'exactly this question and nothing else: "Should the job continue, or should it stop?"'
)

_DEMO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "job_decision",
        "choice_readback_confirmed",
        "reason_sentence",
        "spoke_with_person",
    ],
    "properties": {
        "job_decision": {"type": "string", "enum": ["continue_job", "stop_job", "unclear"]},
        "choice_readback_confirmed": {"type": "string", "enum": ["yes", "no", "unclear"]},
        "reason_sentence": {"type": "string"},
        "spoke_with_person": {"type": "string", "enum": ["yes", "no", "unclear"]},
    },
}


def _demo_payload() -> dict:
    return {
        "task": _DEMO_TASK,
        "recipients": [{"phones": [FICTIONAL_PHONE], "region": "MY", "locale": "en-US"}],
        "result_schema": _DEMO_SCHEMA,
        "metadata": {"project": "leash", "job_id": "LEASH-0001"},
    }


def _demo_key(payload: dict) -> str:
    """Derived from the payload itself, which is the only derivation that makes a replay safe.

    In a real run this string is written to disk before the request goes out, so a process that
    dies mid-create still leaves behind the one thing that can find the call again. Here it is
    computed twice from the same payload instead, which is the same property demonstrated without
    a file: identical payload, identical key, and the second create is a lookup rather than a
    second dial.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return "leash-demo-" + hashlib.sha256(canonical).hexdigest()[:32]


def _post(url: str, payload: dict, *, idem: str | None, timeout: float = 10.0) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if idem:
        headers["Idempotency-Key"] = idem
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST", headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def _get(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def _create(fake: FakeCalle, *, timeout: float = 10.0) -> tuple[int, dict]:
    payload = _demo_payload()
    return _post(f"{fake.url}/v1/calls", payload, idem=_demo_key(payload), timeout=timeout)


def _summarise(body: dict) -> str:
    """One line of the evidence the gate reads. Deliberately not a verdict: this module cannot
    compute one without importing the policy it exists to be independent of."""
    if not body.get("id") and body.get("error"):
        return f"create refused: {body['error'].get('code')}"
    sr = body.get("structured_result")
    recipients = body.get("recipients") or []
    attempts = (recipients[0].get("attempts") or []) if recipients else []
    turns = attempts[0].get("transcript_turns") or [] if attempts else []
    user_turns = [t for t in turns if t.get("speaker") == "user"]
    conf = body.get("completion_confidence") or {}
    return (
        f"status={str(body.get('status')):<12} done={str(body.get('task_completed')):<5} "
        f"score={str(conf.get('score', '-')):<5} "
        f"decision={(sr or {}).get('job_decision', 'NULL RESULT'):<12} "
        f"user_turns={len(user_turns)}"
    )


def _digest_ambiguous() -> str:
    """Runs the halt-and-reconcile path for real, so --all shows the branch rather than asserting
    it. The hold is long relative to the client's timeout, so the timeout fires well after the
    server has stored the record -- which is the situation a real transport failure leaves you in.
    """
    with FakeCalle("create_ambiguous", ambiguous_delay=1.5) as fake:
        payload = _demo_payload()
        key = _demo_key(payload)
        try:
            _post(f"{fake.url}/v1/calls", payload, idem=key, timeout=0.4)
            return "the create returned; the ambiguous branch did not fire"
        except OSError:
            pass  # HALT. The provider may hold an accepted call.
        # Not a retry: the same persisted key, replayed as a lookup.
        status, body = _post(f"{fake.url}/v1/calls", payload, idem=key, timeout=10.0)
        if status != 201 or not body.get("id"):
            return f"HTTP {status} on reconcile: {body}"
        _, snap = _get(f"{fake.url}/v1/calls/{body['id']}")
        return _summarise(snap) + f"  reconciled, dials={fake.dials()}"


def _digest(scenario: str) -> str:
    if scenario == "create_ambiguous":
        return _digest_ambiguous()
    with FakeCalle(scenario) as fake:
        status, body = _create(fake)
        if status != 201 or not body.get("id"):
            return f"HTTP {status} {_summarise(body)}"
        _, snap = _get(f"{fake.url}/v1/calls/{body['id']}")
        return _summarise(snap)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="A local CALL-E-shaped server. Places no calls and needs no key."
    )
    parser.add_argument("--scenario", default=DEFAULT_SCENARIO, choices=sorted(SCENARIOS))
    parser.add_argument("--list", action="store_true", help="list the scenarios and exit")
    parser.add_argument("--all", action="store_true", help="one-line digest of every scenario")
    parser.add_argument("--serve", action="store_true", help="serve until interrupted")
    parser.add_argument("--terminal-after", type=float, default=0.0, metavar="SECONDS")
    parser.add_argument(
        "--ambiguous-delay",
        type=float,
        default=6.0,
        metavar="SECONDS",
        help="how long create_ambiguous withholds its response (library default is 30)",
    )
    parser.add_argument(
        "--forge-webhook",
        action="store_true",
        help="deliver an event whose body disagrees with the snapshot behind it",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    if args.list:
        width = max(len(n) for n in SCENARIOS)
        for name, desc in SCENARIOS.items():
            print(f"{name:<{width}}  {desc}")
        return 0

    if args.all:
        width = max(len(n) for n in SCENARIOS)
        for name in SCENARIOS:
            print(f"{name:<{width}}  {_digest(name)}")
        return 0

    with FakeCalle(
        args.scenario,
        terminal_after=args.terminal_after,
        ambiguous_delay=args.ambiguous_delay,
        webhook_forges=args.forge_webhook,
        verbose=args.verbose,
    ) as fake:
        if args.serve:
            print(f"fake CALL-E on {fake.url}  scenario={args.scenario}")
            print(f"  POST {fake.url}/v1/calls           (Idempotency-Key required)")
            print(f"  GET  {fake.url}/v1/calls/<call_id>")
            print("  header X-Leash-Fake-Scenario overrides the scenario per create")
            print("  a repeated Idempotency-Key returns the stored call and ignores that header")
            print("Ctrl-C to stop.")
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                print()
            return 0

        print(f"scenario: {args.scenario}\n  {SCENARIOS[args.scenario]}\n")
        try:
            status, body = _create(
                fake,
                # Short enough that create_ambiguous actually strands this client, which is the
                # only way to demonstrate the branch that matters.
                timeout=max(args.ambiguous_delay / 3.0, 0.5)
                if args.scenario == "create_ambiguous"
                else 10.0,
            )
        except OSError:
            # The provider may be holding an accepted call. Dialling again could ring a person
            # twice, so the create is not retried under any circumstances: halt, then look the
            # call up by replaying the key that was derived from the payload and persisted before
            # dispatch.
            print("create timed out. The provider may already hold this call. HALTING.")
            print("replaying the stored Idempotency-Key -- a lookup, never a second dial")
            status, body = _create(fake, timeout=max(args.ambiguous_delay * 2.0, 30.0))
            if status == 201 and body.get("id"):
                print(f"recovered {body['id']}")
        if status == 201 and body.get("id"):
            status, body = _get(f"{fake.url}/v1/calls/{body['id']}")
        print(f"HTTP {status}")
        # Redacted at the output boundary. The snapshot itself carries the number in the clear.
        print(json.dumps(_redacted(body), indent=2))
        print(f"\ndistinct calls created: {fake.dials()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
