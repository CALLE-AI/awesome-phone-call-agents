"""The shape of an email thread, and the small amount of parsing we do on it.

The extension supplies this. The server never fetches mail, never stores a
thread, and never sees an account credential.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field


@dataclass
class Message:
    """One message in a thread, as the extension read it off the page."""

    index: int
    sender: str
    from_me: bool
    body: str
    sent_at: str = ""

    @property
    def sentences(self) -> list[str]:
        return split_sentences(self.body)


@dataclass
class Thread:
    thread_id: str
    subject: str
    messages: list[Message] = field(default_factory=list)

    @property
    def counterparty(self) -> str:
        """Display name of the most recent person who is not the user."""
        for message in reversed(self.messages):
            if not message.from_me and message.sender:
                return message.sender
        return ""

    def fingerprint(self) -> str:
        """Stable id for this thread's content.

        Feeds the idempotency key, so re-analysing an unchanged thread can
        never produce a second call for the same question.
        """
        payload = "\n".join(f"{m.index}|{int(m.from_me)}|{m.body.strip()}" for m in self.messages)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# Sentence splitting that keeps the terminator, because a trailing "?" is the
# single strongest signal we have that a sentence was a question.
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")

# Quoted-reply chrome. Anything at or below these lines is previous thread
# content echoed back, not something the sender wrote now.
_QUOTE_MARKERS = (
    re.compile(r"^\s*>", re.MULTILINE),
    re.compile(r"^On .{0,80}wrote:\s*$", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^\s*From:\s.+$", re.MULTILINE),
)

# Signature block, which is where a phone number usually lives. We keep it for
# number extraction but exclude it from language analysis.
_SIGNATURE = re.compile(r"^\s*(--\s*$|Sent from my |Best regards|Regards,|Thanks,|Cheers,)", re.MULTILINE | re.IGNORECASE)


def strip_quoted(body: str) -> str:
    """Return only what this sender actually typed in this message."""
    cut = len(body)
    for marker in _QUOTE_MARKERS:
        match = marker.search(body)
        if match:
            cut = min(cut, match.start())
    return body[:cut].strip()


def strip_signature(body: str) -> str:
    match = _SIGNATURE.search(body)
    return (body[: match.start()] if match else body).strip()


def spoken_text(body: str) -> str:
    """What the sender wrote, minus quoted history and minus the signature."""
    return strip_signature(strip_quoted(body))


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text.strip()) if s.strip()]


def thread_from_payload(payload: dict) -> Thread:
    messages = [
        Message(
            index=i,
            sender=(m.get("sender") or "").strip(),
            from_me=bool(m.get("from_me")),
            body=m.get("body") or "",
            sent_at=(m.get("sent_at") or "").strip(),
        )
        for i, m in enumerate(payload.get("messages") or [])
    ]
    return Thread(
        thread_id=(payload.get("thread_id") or "").strip(),
        subject=(payload.get("subject") or "").strip(),
        messages=messages,
    )
