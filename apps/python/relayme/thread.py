#!/usr/bin/env python3
"""RelayMe conversation thread.

The distinction of RelayMe is that a deaf, hard-of-hearing, or non-speaking user
experiences a phone call as a *text thread*, not as audio and not as a raw
transcript. This module turns a task plus a call transcript into an ordered list
of thread messages the user reads:

  you        -> the request the user typed
  relayme    -> the plan shown back before dialling ("Here's what I'll ask")
  relayme    -> status updates ("Calling...", "They picked up")
  agent      -> each thing the agent said on the call
  them       -> each thing the other party said
  relayme    -> the final answer, or a plain-language "couldn't get it" message

Sensitive values the *user* may have embedded (their own phone/email) are
redacted before display: the person on the other end never consented to the
call, and the thread may be shown on a shared screen.

Pure standard library. No network.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Iterable

# Roles kept deliberately human-readable; the web view styles on these.
ROLE_YOU = "you"          # the RelayMe user (deaf/HoH), typed
ROLE_RELAYME = "relayme"  # the app speaking to the user
ROLE_AGENT = "agent"      # the AI voice on the call
ROLE_THEM = "them"        # the business/person answering

_PHONE_RE = re.compile(r"(?:\+?\d[\d\-\s().]{6,}\d)")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def redact(text: str) -> str:
    """Mask phone-length digit runs and email addresses in free text.

    Partial by design: it does not detect spoken street addresses. Callers must
    treat the output as reduced exposure, not guaranteed anonymisation.
    """
    if not text:
        return text
    text = _EMAIL_RE.sub("[email hidden]", text)
    text = _PHONE_RE.sub("[number hidden]", text)
    return text


@dataclass
class Message:
    role: str
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


# Plain-language endings the user reads instead of a status code.
_OUTCOME_MESSAGES = {
    "answered": "Here's your answer:",
    "partial": "I got part of an answer, but not all of it:",
    "refused": "They wouldn't answer that over the phone. A person may need to follow up.",
    "voicemail": "It went to voicemail, so no one answered live. I didn't leave any private details.",
    "no_answer": "No one picked up. Nothing was shared. You can try again later.",
    "wrong_number": "That number reached the wrong place, so I stopped. Please check the number.",
    "needs_human": "I couldn't get a clear answer, so I've flagged this for a person to handle.",
}


def build_thread(task: dict, result: dict, transcript: Iterable[dict] | None) -> list[Message]:
    """Compose the full text thread from a task, its result, and the transcript.

    `transcript` is a list of {"speaker": "agent"|"callee", "text": str}. It may
    be None (e.g. no-answer), in which case only the framing messages appear.
    """
    thread: list[Message] = []

    # 1. What the user asked for, in their words.
    thread.append(Message(ROLE_YOU, redact(task.get("question", "").strip())))

    # 2. The plan shown back before the call, so the user stays in control.
    business = task.get("business_display_name", "the business")
    thread.append(Message(
        ROLE_RELAYME,
        f"I'll call {business}, say I'm an AI assistant calling for you, and ask that. "
        f"You'll see everything said here.",
    ))

    # 3. The call itself, turn by turn.
    turns = list(transcript or [])
    if turns:
        thread.append(Message(ROLE_RELAYME, f"Calling {business}\u2026"))
        for turn in turns:
            speaker = turn.get("speaker")
            text = redact((turn.get("text") or "").strip())
            if not text:
                continue
            if speaker == "agent":
                thread.append(Message(ROLE_AGENT, text))
            else:
                thread.append(Message(ROLE_THEM, text))

    # 4. The outcome, as a plain-language message plus the answer if there is one.
    outcome = result.get("outcome", "needs_human")
    lead = _OUTCOME_MESSAGES.get(outcome, _OUTCOME_MESSAGES["needs_human"])
    thread.append(Message(ROLE_RELAYME, lead))
    if outcome in {"answered", "partial"} and result.get("answer"):
        thread.append(Message(ROLE_RELAYME, redact(result["answer"].strip())))

    return thread


def thread_to_dicts(thread: list[Message]) -> list[dict]:
    return [m.to_dict() for m in thread]


def render_plaintext(thread: list[Message]) -> str:
    """Render the thread as a simple labeled text block for the terminal demo."""
    labels = {
        ROLE_YOU: "You",
        ROLE_RELAYME: "RelayMe",
        ROLE_AGENT: "Agent",
        ROLE_THEM: "Them",
    }
    lines = []
    for m in thread:
        lines.append(f"{labels.get(m.role, m.role):>8}: {m.text}")
    return "\n".join(lines)
