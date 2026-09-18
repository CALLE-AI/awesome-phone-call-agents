"""Observability for the CALL-E integration: one structured log line per API interaction, and a
redaction filter so a phone number or a secret can never reach a log file.

The point of this module is that a live call must be verifiable after the fact from artifacts
alone: what we sent, what CALL-E returned, how long each leg took, and which of our gates fired.
`GET /api/runs/{id}/trace` assembles those artifacts; this module makes sure they exist and that
they are safe to paste into a pull request.
"""
from __future__ import annotations

import json
import logging
import re
import time
from contextlib import contextmanager
from typing import Any, Iterator

log = logging.getLogger("buddye.calle")

_E164 = re.compile(r"\+\d{7,15}")
_SECRET_HINT = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|Bearer\s+[A-Za-z0-9._\-]{8,})")


def mask_phone(phone: str | None) -> str:
    if not phone:
        return ""
    return ("*" * max(0, len(phone) - 4)) + phone[-4:] if len(phone) > 4 else "***"


def redact(value: Any) -> Any:
    """Recursively mask phone numbers and anything that looks like a credential.
    Applied to every provider payload before it is stored or logged."""
    if isinstance(value, str):
        out = _E164.sub(lambda m: mask_phone(m.group(0)), value)
        return _SECRET_HINT.sub("[redacted]", out)
    if isinstance(value, dict):
        return {k: ("[redacted]" if _is_secret_key(k) else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


_TOKEN_COUNT_KEYS = {"prompt_tokens", "completion_tokens", "total_tokens", "max_tokens", "tokens"}


def _is_secret_key(key: str) -> bool:
    k = key.lower()
    if k in _TOKEN_COUNT_KEYS:  # usage counters, not credentials
        return False
    return any(t in k for t in ("api_key", "authorization", "secret", "token", "webhook_url", "callback_url"))


class RedactingFilter(logging.Filter):
    """Last line of defence: scrubs formatted log records on the way out."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        scrubbed = redact(msg)
        if scrubbed != msg:
            record.msg = scrubbed
            record.args = ()
        return True


def install(level: int = logging.INFO) -> None:
    """Attach the redaction filter and keep HTTP client loggers from printing headers."""
    root = logging.getLogger()
    if not any(isinstance(f, RedactingFilter) for h in root.handlers for f in h.filters):
        for h in root.handlers:
            h.addFilter(RedactingFilter())
    for noisy in ("httpx", "httpcore", "openai"):
        logging.getLogger(noisy).setLevel(max(level, logging.INFO))
    log.setLevel(level)


def event(name: str, **fields: Any) -> None:
    """One structured JSON line. Values are redacted; None values are dropped."""
    payload = {k: redact(v) for k, v in fields.items() if v is not None}
    log.info("%s %s", name, json.dumps(payload, default=str, sort_keys=True))


@contextmanager
def timed(name: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """Time one provider leg and log it exactly once, success or failure.

    The yielded dict is writable, so the caller can attach what it learns (http_status,
    provider_call_id) before the line is emitted.
    """
    started = time.monotonic()
    extra: dict[str, Any] = {}
    try:
        yield extra
    except Exception as exc:  # noqa: BLE001
        event(
            name,
            **fields, **extra,
            duration_ms=int((time.monotonic() - started) * 1000),
            outcome="error",
            error_type=type(exc).__name__,
            error_code=getattr(exc, "code", None),
            http_status=getattr(exc, "status_code", None),
        )
        raise
    else:
        event(name, **fields, **extra, duration_ms=int((time.monotonic() - started) * 1000), outcome="ok")
