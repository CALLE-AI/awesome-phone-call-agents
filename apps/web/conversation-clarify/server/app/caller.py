"""Placing the call. Fixtures by default; live only on explicit configuration.

Two boundaries are enforced here rather than documented:

* The API key is read from the server environment and never leaves this module.
  The browser extension has no path to it. This follows CALL-E's own guidance:
  "Do not call the Developer API directly from a browser, public frontend, or
  untrusted client."
* The credential-bearing origin is pinned to the official host. A configurable
  base URL that carries a bearer token is refused at startup, not at call time.
"""

from __future__ import annotations

import datetime
import json
import os
import time
from pathlib import Path

from .numbers import mask, mask_text

OFFICIAL_ORIGIN = "https://api.heycall-e.com"
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class ConfigurationError(RuntimeError):
    pass


class Caller:
    """Common interface: place(...) -> call_id, poll(call_id) -> call dict."""

    mode = "fixture"

    def place(self, *, task: str, phone: str, schema: dict, recipient: dict,
              idempotency_key: str, metadata: dict) -> str:
        raise NotImplementedError

    def poll(self, call_id: str) -> dict:
        raise NotImplementedError


class FixtureCaller(Caller):
    """Replays recorded terminal payloads. No network, no key, no phone rings.

    This is the default so that a checkout with no configuration cannot dial.
    Which fixture is returned is chosen by the operator through
    CONVERSATION_CLARIFY_FIXTURE, so every documented outcome -- resolved,
    voicemail, no-answer -- can be exercised deterministically.
    """

    mode = "fixture"

    def __init__(self, name: str = "resolved") -> None:
        self.name = name
        self._placed: dict[str, dict] = {}

    def _load(self) -> dict:
        path = FIXTURES / f"{self.name}.json"
        if not path.exists():
            available = ", ".join(sorted(p.stem for p in FIXTURES.glob("*.json"))) or "none"
            raise ConfigurationError(f"No fixture named {self.name!r}. Available: {available}")
        return json.loads(path.read_text(encoding="utf-8"))

    def place(self, *, task, phone, schema, recipient, idempotency_key, metadata) -> str:
        call_id = f"call_fixture_{idempotency_key[:16]}"
        payload = self._load()
        payload["id"] = call_id
        self._placed[call_id] = payload
        return call_id

    def poll(self, call_id: str) -> dict:
        if call_id not in self._placed:
            raise KeyError(call_id)
        return self._placed[call_id]


class LiveCaller(Caller):
    """Real calls through the CALL-E Python SDK."""

    mode = "live"

    def __init__(self, api_key: str, base_url: str = OFFICIAL_ORIGIN) -> None:
        if not api_key:
            raise ConfigurationError("CALLE_API_KEY is required for live mode.")
        if base_url != OFFICIAL_ORIGIN:
            raise ConfigurationError(
                f"Refusing to send credentials to {base_url!r}. "
                f"The only permitted origin is {OFFICIAL_ORIGIN}."
            )
        from calle import CalleClient  # imported lazily so fixture mode needs no SDK

        self._client = CalleClient(api_key=api_key, base_url=base_url)

    def place(self, *, task, phone, schema, recipient, idempotency_key, metadata) -> str:
        try:
            call = self._client.calls.create(
                task=task,
                recipients=[{"phones": [phone], **recipient}],
                result_schema=schema,
                metadata=metadata,
                idempotency_key=idempotency_key,
            )
        except Exception as exc:
            if _definitely_not_placed(exc):
                raise
            raise AmbiguousOutcome(
                f"The request to place the call failed as {type(exc).__name__} without a "
                f"reply from CALL-E. It may or may not have been accepted. Reconcile with "
                f"the same idempotency key before trying again; do not issue a new one."
            ) from exc
        call_id = call.get("id")
        if not call_id:
            # Accepted with no call id is ambiguous: a call may or may not be in
            # flight. Never retry with a fresh key -- that is how a person gets
            # dialled twice.
            raise AmbiguousOutcome(
                "CALL-E accepted the request but returned no call id. A call may already "
                "be in progress. Reconcile with the same idempotency key before retrying."
            )

        age = _age_seconds(call.get("created_at") or "")
        if age > REPLAY_AFTER_SECONDS:
            raise IdempotentReplay(
                f"CALL-E returned an existing call from {age / 60:.0f} minutes ago rather than "
                f"placing a new one, because this idempotency key has been used before. "
                f"Nothing was dialled."
            )
        return call_id

    def poll(self, call_id: str) -> dict:
        return self._client.calls.get(call_id)


class AmbiguousOutcome(RuntimeError):
    """Raised when we cannot tell whether a call was placed. Never auto-retried."""


def _rejected_status(exc: BaseException) -> int | None:
    """The HTTP status CALL-E answered with, if it answered at all."""
    for candidate in (exc, exc.__cause__, exc.__context__):
        if candidate is None:
            continue
        status = getattr(candidate, "status_code", None) or getattr(candidate, "status", None)
        if status is None:
            response = getattr(candidate, "response", None)
            status = getattr(response, "status_code", None) if response is not None else None
        if isinstance(status, int):
            return status
    return None


def _definitely_not_placed(exc: BaseException) -> bool:
    """Can we prove no call was created?

    Only one thing proves it: CALL-E answered and rejected the request. A 4xx
    means the submission was received and refused, so nothing was dialled.

    Everything else -- a timeout, a connection reset, a broken pipe, a 5xx --
    leaves it unknown. The request may have been accepted and the call placed
    before the failure. Guessing "failed" there releases the idempotency claim
    and frees a fresh key, which is how the same person gets dialled twice.
    """
    status = _rejected_status(exc)
    return status is not None and 400 <= status < 500


class IdempotentReplay(RuntimeError):
    """CALL-E returned an existing call instead of placing a new one.

    A reused idempotency key does not dial. CALL-E hands back the ORIGINAL
    call, and polling that reports an old outcome as though it had just
    happened -- an old failure looks like a fresh one, and an old SUCCESS would
    be drafted into the thread as "the call just now". Both are wrong, and the
    second is worse, so a replay is raised rather than returned.
    """


# A call we just created is seconds old. Anything appreciably older came from
# CALL-E's idempotency store, not from this request.
REPLAY_AFTER_SECONDS = 60


def _age_seconds(timestamp: str) -> float:
    try:
        created = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return 0.0
    return (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds()


def build_caller(env: dict | None = None) -> Caller:
    env = env if env is not None else os.environ
    mode = (env.get("CONVERSATION_CLARIFY_MODE") or "fixture").strip().lower()

    if mode == "fixture":
        return FixtureCaller(env.get("CONVERSATION_CLARIFY_FIXTURE", "resolved"))

    if mode != "live":
        raise ConfigurationError(
            f"CONVERSATION_CLARIFY_MODE must be 'fixture' or 'live', got {mode!r}."
        )

    base_url = (env.get("CALLE_BASE_URL") or OFFICIAL_ORIGIN).strip()
    return LiveCaller(env.get("CALLE_API_KEY") or env.get("CALLE_API") or "", base_url)


def safe_snapshot(call: dict) -> dict:
    """A terminal payload with every phone-shaped run masked, recursively.

    Provider text -- summaries, transcripts, failure messages -- can echo a
    destination back in a shape we never sent, so masking is applied to the
    whole structure rather than to the fields we happen to expect.
    """
    def _walk(value):
        if isinstance(value, str):
            return mask_text(value)
        if isinstance(value, list):
            return [_walk(v) for v in value]
        if isinstance(value, dict):
            return {k: (_walk(v) if k != "phones" else [mask(p) for p in v]) for k, v in value.items()}
        return value

    return _walk(call)


def transcript_of(call: dict) -> list[dict]:
    """Flatten the transcript turns of the last attempt, masked."""
    for recipient in reversed(call.get("recipients") or []):
        for attempt in reversed(recipient.get("attempts") or []):
            turns = attempt.get("transcript_turns") or []
            if turns:
                return [
                    {
                        "at": turn.get("offset_seconds"),
                        "speaker": turn.get("speaker"),
                        "text": mask_text(turn.get("text") or ""),
                    }
                    for turn in turns
                ]
    return []


def wait_for_terminal(caller: Caller, call_id: str, *, timeout: float = 420, interval: float = 5,
                      sleep=time.sleep) -> dict:
    """Poll to a terminal state. Webhooks are unsigned, so we never trust a push."""
    terminal = {"completed", "failed", "canceled"}
    deadline = time.monotonic() + timeout
    while True:
        call = caller.poll(call_id)
        if call.get("status") in terminal:
            return call
        if time.monotonic() >= deadline:
            raise AmbiguousOutcome(
                f"Call {call_id} did not reach a terminal state within {timeout:.0f}s. "
                "It may still be in progress; do not place another call for this question."
            )
        sleep(interval)
