"""Live transport: the real CALL-E REST API.

This is the only module in the app that opens a socket. It is never imported by a test and
never reached unless `PC_MODE=live` passed every gate in `config.py`.

It speaks REST rather than going through the `calle-ai` SDK. The reasoning is recorded in
`docs/adapter-notes.md`: the SDK does accept an idempotency key, but this app needs
`recipient_result_schema` (whose SDK keyword availability is version-dependent) and needs
byte-faithful wire payloads for `pc record`.

There is no cancel method here because CALL-E publishes no cancel endpoint. After
`submit()` returns a call id, the app's only remaining power is to stop asking.
"""

from __future__ import annotations

import time
from typing import Callable

import httpx

from ..config import OFFICIAL_CALLE_BASE_URL
from .base import CallSnapshot, SubmitResult, TransportError, parse_call_task

# Error codes from the contract that mean "this submission definitely did not happen".
DEFINITE_REJECTION_CODES = frozenset(
    {
        "invalid_request",
        "unauthorized",
        "forbidden",
        "no_recipients",
        "invalid_recipient",
        "invalid_phone",
        "unsupported_region",
        "unsupported_language",
        "recipient_blocked",
        "policy_violation",
        "result_schema_invalid",
        "recipient_result_schema_invalid",
        "insufficient_balance",
    }
)

# Codes where the call may or may not have been accepted. These become SUBMISSION_UNKNOWN
# and are reconciled by replaying the same key, never by minting a new one.
AMBIGUOUS_CODES = frozenset(
    {"rate_limit_exceeded", "provider_unavailable", "internal_error", "idempotency_conflict"}
)

FIRST_POLL_DELAY_SECONDS = 60
POLL_INTERVAL_SECONDS = 8
DEFAULT_POLL_TIMEOUT_SECONDS = 900


class CalleTransport:
    """Thin, explicit client for the two endpoints this app uses."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = OFFICIAL_CALLE_BASE_URL,
        timeout_seconds: float = 30.0,
        webhook_url: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key:
            raise TransportError("CALLE_API_KEY is required for a live run")
        normalized = base_url.rstrip("/")
        if normalized != OFFICIAL_CALLE_BASE_URL:
            raise TransportError(
                "live CALL-E credentials may only be sent to the official API origin "
                f"{OFFICIAL_CALLE_BASE_URL}"
            )
        self.base_url = normalized
        self.webhook_url = webhook_url
        self._sleep = sleep
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout_seconds,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> CalleTransport:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    # -- CallTransport ----------------------------------------------------------

    def submit(
        self,
        *,
        task_text: str,
        phone_e164: str,
        locale: str,
        region: str,
        recipient_result_schema: dict,
        idempotency_key: str,
        metadata: dict,
    ) -> SubmitResult:
        body: dict = {
            "task": task_text,
            "recipients": [{"phones": [phone_e164], "locale": locale, "region": region}],
            "recipient_result_schema": recipient_result_schema,
            "metadata": metadata,
        }
        if self.webhook_url:
            body["webhook_url"] = self.webhook_url

        try:
            response = self._client.post(
                "/v1/calls", json=body, headers={"Idempotency-Key": idempotency_key}
            )
        except httpx.HTTPError as exc:
            # The request may have reached CALL-E. Never assume it did not.
            return SubmitResult.unknown(f"transport error contacting CALL-E: {exc}")

        if response.status_code in (200, 201):
            try:
                payload = response.json()
            except ValueError:
                return SubmitResult.unknown("CALL-E accepted the call but returned unreadable JSON")
            call_id = payload.get("id")
            if not isinstance(call_id, str):
                return SubmitResult.unknown("CALL-E response carried no call id")
            return SubmitResult.accepted(call_id)

        code, message = _read_error(response)
        if code in DEFINITE_REJECTION_CODES:
            return SubmitResult.rejected(message, code)
        if code in AMBIGUOUS_CODES or response.status_code >= 500 or response.status_code == 429:
            return SubmitResult.unknown(message, code)
        return SubmitResult.rejected(message, code)

    def read(self, call_id: str) -> CallSnapshot:
        try:
            response = self._client.get(f"/v1/calls/{call_id}")
        except httpx.HTTPError as exc:
            raise TransportError(f"could not re-read call {call_id}: {exc}") from exc
        if response.status_code != 200:
            code, message = _read_error(response)
            raise TransportError(f"CALL-E returned {response.status_code} for {call_id}: {message}")
        try:
            return parse_call_task(response.json())
        except ValueError as exc:
            raise TransportError(f"unreadable call payload for {call_id}: {exc}") from exc

    def raw_payload(self, call_id: str) -> dict:
        response = self._client.get(f"/v1/calls/{call_id}")
        response.raise_for_status()
        return response.json()

    # -- polling ----------------------------------------------------------------

    def wait_for_terminal(
        self,
        call_id: str,
        *,
        first_delay_seconds: int = FIRST_POLL_DELAY_SECONDS,
        interval_seconds: int = POLL_INTERVAL_SECONDS,
        timeout_seconds: int = DEFAULT_POLL_TIMEOUT_SECONDS,
    ) -> CallSnapshot:
        """Poll one already-submitted call until it reaches a terminal status.

        The call id is persisted by the dispatcher before this is ever called, so a
        restart resumes polling an existing call instead of submitting a second one. A
        timeout here does not mean the call failed; it means we stopped asking.
        """
        deadline = time.monotonic() + timeout_seconds
        self._sleep(min(first_delay_seconds, max(timeout_seconds - 1, 0)))
        while True:
            snapshot = self.read(call_id)
            if snapshot.is_terminal:
                return snapshot
            if time.monotonic() >= deadline:
                raise TransportError(
                    f"stopped polling {call_id} after {timeout_seconds}s while it was still "
                    f"{snapshot.status}. The call may still be running; CALL-E publishes no "
                    "cancel endpoint. Reuse this call id, do not submit a new call."
                )
            self._sleep(interval_seconds)


def _read_error(response: httpx.Response) -> tuple[str | None, str]:
    """Pull `error.code` and `error.message` out of the contract's error envelope."""
    try:
        payload = response.json()
    except ValueError:
        return None, f"HTTP {response.status_code} with a non-JSON body"
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return error.get("code"), str(error.get("message") or f"HTTP {response.status_code}")
    return None, f"HTTP {response.status_code}"
