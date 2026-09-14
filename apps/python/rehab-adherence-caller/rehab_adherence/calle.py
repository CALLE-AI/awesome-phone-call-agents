"""CALL-E adapter.

The SDK is an optional dependency, installed with the `live` extra. A default
install cannot place a call, which is a structural guarantee rather than a
promise: `import calle` is not merely unused in the default path, it is absent.

Verified against `calle-ai==0.7.0` (signatures read from the installed package,
response shape from https://docs.heycall-e.com/api-reference/calls):

    client = CalleClient(api_key=..., base_url=...)
    created = client.calls.create(task=, recipients=, result_schema=, metadata=,
                                  idempotency_key=)
    completed = client.calls.wait_for_result(created["id"], timeout_seconds=,
                                             interval_seconds=)

The terminal payload nests the conversation three levels down:

    completed["recipients"][i]["attempts"][j]["transcript_turns"]
        -> [{"offset_seconds": 0, "speaker": "bot"|"user"|"unknown", "text": ...}]

`completion_confidence` is an object -- `{"score": 0.92, "label": "high"}` -- not
a bare float. `evidence` is a list of short strings from the post-call summary.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any, Protocol

PHONE_LIKE = re.compile(r"(?:\+\d[\d\s().-]{6,}\d)|(?:\b\d[\d\s().-]{7,}\d\b)")

# Anything that looks like a CALL-E key, in case one reaches an error string.
SECRET_LIKE = re.compile(r"iams_[A-Za-z0-9_\-]{8,}")

DEFAULT_BASE_URL = "https://api.heycall-e.com"

# The API key is only ever sent to these origins. A --base-url pointing anywhere
# else would hand a live credential to an arbitrary host, so it is refused rather
# than trusted. HTTP, loopback, userinfo, paths and query strings are all out.
APPROVED_ORIGINS = frozenset({"https://api.heycall-e.com"})


def check_base_url(base_url: str) -> str:
    """Refuse to send a credential anywhere that is not an approved origin."""
    from urllib.parse import urlsplit

    parts = urlsplit(base_url)
    if parts.scheme != "https":
        raise ValueError(f"base URL must use https, got {parts.scheme or 'no scheme'!r}")
    if parts.username or parts.password:
        raise ValueError("base URL must not carry credentials")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ValueError("base URL must be an origin only, with no path, query or fragment")
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in APPROVED_ORIGINS:
        raise ValueError(
            f"refusing to send a CALL-E API key to {origin}; "
            f"approved origins are {sorted(APPROVED_ORIGINS)}"
        )
    return origin

# Keys our own result schema defines. Used to decide whether a structured result
# came from our schema or is an aggregate the API produced at a different level.
RESULT_KEYS = {
    "reached_patient",
    "continued_after_ai_disclosure",
    "attendance_intent",
    "chosen_slot_id",
    "barrier",
    "symptom_volunteered",
    "evidence_summary",
}


class CallPort(Protocol):
    """What the workflow needs from a caller. Satisfied by the live client and by
    the fixture port, so the workflow itself has no live/fixture branch."""

    def place(self, arguments: dict[str, Any], *, patient_id: str) -> dict[str, Any]: ...


def _age_seconds(created_at: Any) -> float:
    """How long ago the provider says this call was created. Unknown reads as 0,
    so a missing timestamp never fabricates a replay warning."""
    if not isinstance(created_at, str):
        return 0.0
    from datetime import datetime, timezone

    try:
        stamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return (datetime.now(timezone.utc) - stamp).total_seconds()


def normalize_transcript(payload: Any) -> list[dict[str, str]]:
    """Pull the conversation out of a terminal call payload.

    The turns live at `recipients[].attempts[].transcript_turns[]`, not at the
    top level. An earlier version of this function read a top-level "transcript"
    key, which does not exist: it returned an empty list on every real call while
    passing every fixture test. Read the docs, not the fixture.

    Takes the last attempt that has any turns, because a redial supersedes the
    attempt before it. Speaker is normalised to BOT/USER/OTHER; `unknown` from
    the provider becomes OTHER rather than being guessed at. Phone-shaped text is
    redacted -- provider output is untrusted.
    """
    if not isinstance(payload, dict):
        return []

    raw_turns: list[Any] = []
    for recipient in payload.get("recipients") or []:
        if not isinstance(recipient, dict):
            continue
        for attempt in recipient.get("attempts") or []:
            if not isinstance(attempt, dict):
                continue
            turns = attempt.get("transcript_turns")
            if isinstance(turns, list) and turns:
                raw_turns = turns

    normalized: list[dict[str, str]] = []
    for item in raw_turns:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        speaker = str(item.get("speaker", "")).upper()
        if speaker not in {"BOT", "USER"}:
            speaker = "OTHER"
        offset = item.get("offset_seconds")
        stamp = ""
        if isinstance(offset, (int, float)) and offset >= 0:
            stamp = f"00:{int(offset) // 60:02d}:{int(offset) % 60:02d}"
        normalized.append(
            {
                "speaker": speaker,
                "text": redact(" ".join(text.split())),
                "ts": stamp,
            }
        )
    return normalized


def structured_result(payload: dict[str, Any], required: set[str]) -> Any:
    """Prefer the task-level structured result, fall back to the recipient's.

    Both exist. With one recipient per call the task-level object is normally the
    one shaped by our `result_schema`, but the API also returns a per-recipient
    result, and an aggregate task-level schema would not carry our fields. Check
    for a required key rather than assuming which level answered.
    """
    task_level = payload.get("structured_result")
    if isinstance(task_level, dict) and required & task_level.keys():
        return task_level
    for recipient in payload.get("recipients") or []:
        if isinstance(recipient, dict):
            candidate = recipient.get("structured_result")
            if isinstance(candidate, dict) and required & candidate.keys():
                return candidate
    return task_level


def confidence_score(raw: Any) -> float | None:
    """`completion_confidence` is `{"score": float, "label": str}`. Tolerate a
    bare number too, since fixtures and older payloads carry one."""
    if isinstance(raw, dict):
        score = raw.get("score")
        return float(score) if isinstance(score, (int, float)) else None
    if isinstance(raw, (int, float)):
        return float(raw)
    return None


def safe_error(exc: BaseException) -> str:
    """An exception type plus a scrubbed message.

    Provider errors quote the request back, so a raw exception can carry the
    recipient's number or the API key into a ledger or a terminal that is being
    recorded.
    """
    return f"{type(exc).__name__}: {redact(str(exc))}"


def redact(value: Any) -> Any:
    """Strip anything phone-shaped out of provider output before it is displayed
    or written. Provider text is untrusted; CALL-E's own skill says so."""
    if isinstance(value, str):
        return SECRET_LIKE.sub("[secret-redacted]", PHONE_LIKE.sub("[phone-redacted]", value))
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value


def _read_payload(payload: dict[str, Any], *, call_id: str | None, simulated: bool) -> dict[str, Any]:
    """Parse one terminal call payload.

    Both ports go through this, so a fixture exercises exactly the parsing the
    live path uses. When they diverged, a fixture could pass while the live call
    silently returned nothing.
    """
    return {
        "status": payload.get("status"),
        "task_completed": payload.get("task_completed"),
        "completion_confidence": confidence_score(payload.get("completion_confidence")),
        "structured_result": redact(structured_result(payload, RESULT_KEYS)),
        "transcript": normalize_transcript(payload),
        "evidence": redact(payload.get("evidence") or []),
        "call_id": call_id,
        "simulated": simulated,
    }


class FixturePort:
    """Replays recorded-by-hand responses. No network, no credentials, no call.

    Fixtures are authored, never captured: `SECURITY.md` forbids committing call
    recordings and private transcripts.
    """

    def __init__(self, responses: dict[str, Any]) -> None:
        self._responses = responses

    def place(self, arguments: dict[str, Any], *, patient_id: str) -> dict[str, Any]:
        response = self._responses.get(patient_id)
        if response is None:
            return {
                "status": "NO_ANSWER",
                "structured_result": None,
                "transcript": [],
                "call_id": None,
                "simulated": True,
            }
        return _read_payload(response, call_id=None, simulated=True)


class LivePort:
    """Places one real call per decision. Only reachable behind explicit flags."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: int = 600,
        checkpoint: "Path | None" = None,
        settle_seconds: float = 4.0,
        replay_after_seconds: float = 120.0,
    ) -> None:
        if not api_key:
            raise ValueError("a CALL-E API key is required for live mode")
        try:
            from calle import CalleClient  # noqa: PLC0415 - optional `live` extra
        except ImportError as exc:  # pragma: no cover - exercised only without the extra
            raise RuntimeError(
                "live mode needs the CALL-E SDK: pip install 'rehab-adherence-caller[live]'"
            ) from exc
        self._client = CalleClient(api_key=api_key, base_url=check_base_url(base_url))
        self._timeout_seconds = timeout_seconds
        self._checkpoint = checkpoint
        self._settle_seconds = settle_seconds
        self._replay_after_seconds = replay_after_seconds

    def place(self, arguments: dict[str, Any], *, patient_id: str) -> dict[str, Any]:
        created = self._client.calls.create(**arguments)
        call_id = created.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise RuntimeError("CALL-E create response contained no call id; reconcile before retrying")

        # An idempotency key that matches an earlier request returns that earlier
        # call rather than placing a new one. That is correct, and it is also how
        # a run can report a completed call that never happened: the same course,
        # patient, action, attempt count and task text produce the same key, so
        # re-running an unchanged plan replays a result that may be hours old.
        # Believing you rang a patient when you did not is not a cosmetic fault.
        replayed = _age_seconds(created.get("created_at")) > self._replay_after_seconds
        # Checkpoint the accepted id BEFORE polling. The call is already placed
        # and already billed at this point; if the poll is interrupted, times out,
        # or the process dies, the id is the only way to recover the result. It
        # used to be written to the ledger at the very end of the run, which meant
        # an interrupted poll lost a completed call entirely.
        self._note_checkpoint(call_id, patient_id)

        completed = self._client.calls.wait_for_result(
            call_id, timeout_seconds=self._timeout_seconds, interval_seconds=2
        )

        # A terminal status is not the same as a finalised result. On a real call
        # wait_for_result returned status "completed" while structured_result and
        # completion_confidence were still null; a second read a moment later had
        # both. Re-reading once costs nothing and no call, and without it a
        # completed booking is recorded as no_answer.
        if structured_result(completed, RESULT_KEYS) is None:
            time.sleep(self._settle_seconds)
            try:
                refetched = self._client.calls.get(call_id)
            except Exception:  # noqa: BLE001 - keep the result we already have
                refetched = None
            if refetched and structured_result(refetched, RESULT_KEYS) is not None:
                completed = refetched

        payload = _read_payload(completed, call_id=call_id, simulated=False)
        payload["replayed"] = replayed
        if replayed:
            payload["replayed_from"] = created.get("created_at")
        return payload

    def fetch(self, call_id: str) -> dict[str, Any]:
        """Re-read a call that was already placed. Recovery path for an
        interrupted poll -- costs nothing and places no call."""
        return _read_payload(self._client.calls.get(call_id), call_id=call_id, simulated=False)

    def _note_checkpoint(self, call_id: str, patient_id: str) -> None:
        if self._checkpoint is None:
            return
        try:
            self._checkpoint.parent.mkdir(parents=True, exist_ok=True)
            with self._checkpoint.open("a", encoding="utf-8") as handle:
                handle.write(f"{patient_id}\t{call_id}\n")
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:  # never let bookkeeping abort a placed call
            print(f"  WARNING: could not checkpoint {call_id}: {exc}", flush=True)
