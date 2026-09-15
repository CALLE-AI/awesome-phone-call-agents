"""Structured JSON logging with secret/phone redaction.

Every log line is JSON (readiness: structured_logging). Phone digits and API
keys are masked before they reach any handler, so logs are safe to keep and
to show in the demo video.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import structlog

_DIGITS = re.compile(r"\d")
_KEY_RE = re.compile(
    r"(iams_live_[A-Za-z0-9_\-]+|calle_[A-Za-z0-9_\-]+"
    r"|sk-[A-Za-z0-9\-_]+"
    r"|Bearer\s+\S+"
    r"|api[_-]?key\s*[:=]\s*\S+)"
)
_PLUS_PHONE_RE = re.compile(r"\+\d[\d\s\-()]{6,}\d")
_BARE_PHONE_RE = re.compile(
    r"(?<!\d)(?:\(\d{3}\)\s*|\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)"
)
_SENSITIVE_KEY_PARTS = ("key", "token", "secret", "password", "auth")


def mask_phone(value: str) -> str:
    """Mask every digit of a phone-like string (fail-safe, no partial leaks)."""
    digits = _DIGITS.sub("#", value)
    return digits


def redact_value(value: Any) -> Any:
    """Redact secrets and phone-like digit runs inside arbitrary values."""
    if isinstance(value, str):
        redacted = _KEY_RE.sub("<redacted-key>", value)
        # Mask +-prefixed numbers first, then bare 7+-digit runs.
        masked = _PLUS_PHONE_RE.sub(lambda m: mask_phone(m.group(0)), redacted)
        return _BARE_PHONE_RE.sub(lambda m: mask_phone(m.group(0)), masked)
    if isinstance(value, dict):
        redacted_dict: dict[Any, Any] = {}
        for dict_key, item in value.items():
            if isinstance(dict_key, str) and any(
                part in dict_key.lower() for part in _SENSITIVE_KEY_PARTS
            ):
                redacted_dict[dict_key] = "<redacted-key>"
            else:
                redacted_dict[dict_key] = redact_value(item)
        return redacted_dict
    if isinstance(value, (list, tuple)):
        return [redact_value(item) for item in value]
    return value


def _redact_processor(
    _logger: logging.Logger, _method: str, event_dict: structlog.types.EventDict
) -> structlog.types.EventDict:
    redacted: structlog.types.EventDict = redact_value(event_dict)
    return redacted


_configured = False


def configure_logging(level: str = "info") -> None:
    """Configure structlog JSON output; later calls update the level."""
    global _configured
    numeric = getattr(logging, level.upper(), logging.INFO)
    if not _configured:
        logging.basicConfig(level=numeric)
        _configured = True
    logging.getLogger().setLevel(numeric)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _redact_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.typing.FilteringBoundLogger:
    """Return a redacting JSON logger (configures defaults on first use)."""
    configure_logging()
    logger: structlog.typing.FilteringBoundLogger = structlog.get_logger(name)
    return logger
