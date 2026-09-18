"""Verify a finding that did not come from our own rules.

Two sources hand us findings we cannot simply believe: the optional model pass,
and the browser panel, which sends back the finding a person chose to act on.
Both are outside this server, and a finding is an offer to telephone a real
person, so both go through the same check.

Nothing here trusts the claim. Every field that reaches the call or the gate is
re-established against the thread itself:

* the question and the reply must appear **verbatim** in the messages they are
  attributed to, so a paraphrase is discarded rather than spoken to somebody;
* the ask must come from the user and the non-answer from the other party, in
  that order, because a misread of who said what proposes the wrong call;
* every offered option must appear in the ask, because those options become the
  menu the gate later measures the answer against.

Display-only fields are rebuilt here rather than accepted.
"""

from __future__ import annotations

from .detect import Finding
from .numbers import mask_text
from .thread import Thread

KINDS = {"unclear_choice", "vague_commitment"}
MAX_CALL_QUESTION = 200
MAX_OPTIONS = 4


def normalise(text: str) -> str:
    """Whitespace and case only. Nothing else is softened."""
    return " ".join((text or "").split()).casefold()


def quoted_in(candidate: str, haystack: str) -> bool:
    """Is this sentence actually present in the message it claims to come from?

    A model that paraphrases, merges two sentences, or invents one fails this,
    and the finding is dropped rather than shown to the user.

    Both sides are masked before comparing. Findings leave this server with any
    phone-shaped run masked, so a client returning one is returning the masked
    form; masking the thread too compares like with like. Masking is
    deterministic, so this neither weakens the check nor accepts a paraphrase.
    """
    needle = normalise(mask_text(candidate))
    return bool(needle) and needle in normalise(mask_text(haystack))


def verify_finding(thread: Thread, data: dict, *, source: str) -> Finding | None:
    """Rebuild a Finding from untrusted input, or return None.

    `source` is "model" or "client" and says who is making the claim. A model
    finding is never marked high confidence; a client is relaying a finding this
    server already produced, so its own label is kept once validated.
    """
    if not isinstance(data, dict):
        return None

    kind = data.get("kind")
    if kind not in KINDS:
        return None

    try:
        asked_index = int(data["asked_index"])
        replied_index = int(data["replied_index"])
    except (KeyError, TypeError, ValueError):
        return None

    messages = thread.messages
    if not (0 <= asked_index < len(messages)) or not (0 <= replied_index < len(messages)):
        return None
    if not messages[asked_index].from_me or messages[replied_index].from_me:
        return None
    if replied_index <= asked_index:
        return None

    question = (data.get("question") or "").strip()
    reply = (data.get("reply") or "").strip()
    if not quoted_in(question, messages[asked_index].body):
        return None
    if not quoted_in(reply, messages[replied_index].body):
        return None

    call_question = (data.get("call_question") or "").strip()
    if not call_question or len(call_question) > MAX_CALL_QUESTION:
        return None

    options = [str(o).strip() for o in (data.get("options") or []) if str(o).strip()]
    if kind == "vague_commitment":
        options = []
    else:
        options = options[:MAX_OPTIONS]
        if len(options) < 2:
            return None
        # The gate refuses an answer that was not on the menu, so the menu has to
        # be the one the user actually offered -- not one supplied alongside the
        # finding.
        if any(not quoted_in(option, messages[asked_index].body) for option in options):
            return None

    if source == "model":
        confidence, label = "medium", "model"
    else:
        confidence = data.get("confidence") if data.get("confidence") in {"high", "medium"} else "medium"
        label = data.get("source") if data.get("source") in {"rules", "model"} else "rules"

    return Finding(
        kind=kind,
        confidence=confidence,
        asked_index=asked_index,
        replied_index=replied_index,
        question=question,
        reply=reply,
        options=options,
        headline=(f"They agreed without saying which: {' or '.join(options)}"
                  if kind == "unclear_choice" else "They agreed, but named no date"),
        call_question=call_question,
        source=label,
    )
