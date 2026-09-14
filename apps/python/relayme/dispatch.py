#!/usr/bin/env python3
"""RelayMe dispatch safety.

Two responsibilities, both enforced in code rather than left to prose:

1. Reserve-before-dial idempotency. A task is reserved on disk *before* a call is
   placed, keyed on the authorization (task_id), not on the attempt. A second
   attempt for the same task_id is refused rather than dialling again. An
   uncertain outcome stays reserved so a crash cannot silently redial.

2. Fail-closed outcome classification. A raw call result is coerced into the
   RelayMe schema. Anything ambiguous, unrecognised, or unconfirmed becomes
   needs_human. A spoken answer is never upgraded into a confirmed fact, and an
   answer only survives when the transcript actually supports it.

Pure standard library. The reservation store is a small JSON file so the
behaviour is durable across processes and inspectable in the demo.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

# Full ASCII E.164: a leading '+', a nonzero country-code digit, then up to 14
# more ASCII digits (8-15 digits total). Rejects spaces, punctuation, and
# non-ASCII digit lookalikes, which a live transport must never receive.
_E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")


def is_e164(phone: str) -> bool:
    """True only for a full, ASCII-only E.164 number (+ then 8-15 digits)."""
    if not phone or not phone.isascii():
        return False
    return bool(_E164_RE.match(phone))

VALID_OUTCOMES = {
    "answered", "partial", "refused", "voicemail",
    "no_answer", "wrong_number", "needs_human",
}
# Only these outcomes may carry a user-facing answer.
_ANSWER_BEARING = {"answered", "partial"}
# Terminal outcomes release the reservation; uncertain ones hold it.
_TERMINAL = {"answered", "partial", "refused", "voicemail", "no_answer", "wrong_number"}


class DispatchError(RuntimeError):
    pass


@dataclass
class Reservation:
    task_id: str
    state: str  # "reserved" | "done"
    outcome: str | None = None
    intent: str = "live"  # "live" | "preview"


class ReservationStore:
    """Durable, JSON-backed reserve-before-dial store keyed on (intent, task_id).

    The key is namespaced by `intent` so a mock/preview run and a live run of the
    same task_id do not collide. A preview reserves under "preview:"; a live dial
    reserves under "live:". This is what lets the documented preview-then-live
    flow work: previewing a task does not consume its one live reservation. Two
    live runs of the same task_id still collide and the second is refused.
    """

    def __init__(self, path: str | os.PathLike):
        self.path = Path(path)
        if not self.path.exists():
            self._write({})

    @staticmethod
    def _key(intent: str, task_id: str) -> str:
        return f"{intent}:{task_id}"

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (json.JSONDecodeError, FileNotFoundError):
            # Fail closed: a corrupt journal must not permit a fresh dial.
            raise DispatchError("reservation store is unreadable; refusing to dial")

    def _write(self, data: dict) -> None:
        # Atomic write so a crash mid-write cannot corrupt the journal.
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent or "."), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def reserve(self, task_id: str, intent: str = "live") -> None:
        """Reserve a task before dialling. Refuse if already reserved or done.

        `intent` namespaces the reservation ("live" or "preview"), so a preview
        never blocks the one live dial for the same task_id.
        """
        if not task_id:
            raise DispatchError("task_id is required to reserve a dial")
        key = self._key(intent, task_id)
        data = self._read()
        existing = data.get(key)
        if existing is not None:
            state = existing.get("state")
            raise DispatchError(
                f"{intent} task {task_id} already {state}; refusing to run again "
                f"(recover the prior attempt instead of starting over)"
            )
        data[key] = {"task_id": task_id, "intent": intent,
                     "state": "reserved", "outcome": None}
        self._write(data)

    def complete(self, task_id: str, outcome: str, intent: str = "live") -> None:
        """Mark a reserved task done once a terminal outcome is confirmed.

        A non-terminal (uncertain) outcome leaves the reservation held, so the
        task cannot be redialled from a fresh plan; it must be recovered.
        """
        key = self._key(intent, task_id)
        data = self._read()
        if key not in data:
            raise DispatchError(f"{intent} task {task_id} was never reserved")
        if outcome in _TERMINAL:
            data[key] = {"task_id": task_id, "intent": intent,
                         "state": "done", "outcome": outcome}
            self._write(data)
        # else: leave it reserved (held) for recovery.

    def status(self, task_id: str, intent: str = "live") -> Reservation | None:
        rec = self._read().get(self._key(intent, task_id))
        if not rec:
            return None
        return Reservation(task_id=rec["task_id"], state=rec["state"],
                           outcome=rec.get("outcome"), intent=rec.get("intent", intent))


def _transcript_supports(answer: str, transcript: list[dict] | None) -> bool:
    """Advisory-only heuristic that the answer is grounded in what was said.

    This is NOT semantic entailment and does not verify the answer is correct.
    It only checks that the callee actually spoke at least one non-empty turn,
    so an "answer" with no callee turn behind it cannot be reported as confirmed.
    A live deployment should treat a surfaced answer as advisory and leave final
    judgement to the user; the strong guarantee here is the fail-closed downgrade
    to needs_human, not proof that the answer is true.
    """
    if not transcript:
        return False
    callee_said = [t.get("text", "") for t in transcript if t.get("speaker") == "callee"]
    return any(s.strip() for s in callee_said)


def classify(raw: dict, transcript: list[dict] | None = None) -> dict:
    """Coerce a raw result into the fail-closed RelayMe schema.

    Rules:
    - Unknown/missing outcome -> needs_human.
    - Only answered/partial may carry an answer; others are blanked.
    - An answered/partial result whose transcript has no callee turn is
      downgraded to needs_human: the agent must not report an answer no one
      spoke. This grounding check is advisory (see `_transcript_supports`); it
      confirms a callee spoke, not that the answer is true or entailed.
    - disclosed_ai must be explicitly true; otherwise the call is not trustworthy
      as a completed relay and routes to needs_human.

    Recovery of a held (uncertain) reservation is a manual operator step; this
    module does not invoke `calle call recover` automatically.
    """
    outcome = raw.get("outcome")
    if outcome not in VALID_OUTCOMES:
        outcome = "needs_human"

    answer = (raw.get("answer") or "").strip()

    if outcome in _ANSWER_BEARING:
        if not _transcript_supports(answer, transcript):
            outcome = "needs_human"
        if raw.get("disclosed_ai") is not True:
            # A relay that never disclosed it was AI is not a clean success.
            outcome = "needs_human"

    if outcome not in _ANSWER_BEARING:
        answer = ""

    return {
        "answer": answer,
        "outcome": outcome,
        "transcript_summary": (raw.get("transcript_summary") or "").strip(),
        "follow_up_needed": bool(raw.get("follow_up_needed", outcome != "answered")),
        "disclosed_ai": bool(raw.get("disclosed_ai", False)),
    }


def enforce_followup_budget(allowed_followups: list[str] | None) -> list[str]:
    """The agent may ask only the pre-authorized clarifiers, capped at 3."""
    followups = [f.strip() for f in (allowed_followups or []) if f and f.strip()]
    if len(followups) > 3:
        raise DispatchError("allowed_followups is capped at 3")
    return followups
