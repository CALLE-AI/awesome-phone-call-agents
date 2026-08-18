"""QuoteWake application logging using Python's standard library.

The CLI writes readable events to a rotating project-local log file and to
stderr. Both streams use one event per line in the form
``timestamp [LEVEL] [Service] [event]: readable message``.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
from typing import Any


LOGGER_NAME = "quotewake_salesforce"
DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_LOG_FORMAT = "text"
DEFAULT_LOG_DIRECTORY = "logs"
DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024
DEFAULT_LOG_BACKUP_COUNT = 5
PROJECT_ROOT = Path(__file__).resolve().parents[1]

_LOG_CONTEXT: ContextVar[dict[str, Any]] = ContextVar(
    "quotewake_log_context", default={}
)
_REDACT_SENSITIVE: ContextVar[bool] = ContextVar(
    "quotewake_redact_sensitive", default=False
)
_LABELS = {
    "run_id": "run",
    "quote_id": "quote",
    "contact_id": "contact",
    "call_id": "call",
    "task_id": "task",
    "plan_id": "plan",
    "phase": "phase",
    "reason": "reason",
    "error_type": "error type",
}
_HIDDEN_RENDER_FIELDS = frozenset({"run_id"})
_IDENTIFIER_FIELDS = frozenset(
    {"quote_id", "call_id", "provider_call_id", "task_id", "idempotency_key"}
)
_PHONE_SEPARATOR_PATTERN = r"(?:[^\S\r\n]|[.\-\u2010-\u2015\u2212])"
_PHONE_LIKE_PATTERN = re.compile(
    rf"(?<!\w)(?<!\d[.\-\u2010-\u2015\u2212])(?<!\d[^\S\r\n])"
    rf"\+?[1-9](?:{_PHONE_SEPARATOR_PATTERN}?\d){{7,14}}"
    rf"(?!{_PHONE_SEPARATOR_PATTERN}?\d|\w)"
)
_SECRET_KEY_PATTERN = re.compile(
    r"(?:authorization|headers?|cookie|secret|token|password|api[\s_-]?key|apikey|"
    r"access[_-]?token|refresh[_-]?token|client[_-]?secret)",
    re.I,
)
_SECRET_TEXT_PATTERN = re.compile(
    r"(?i)\b(?:authorization|api[\s_-]?key|apikey|access[_-]?token|refresh[_-]?token|"
    r"client[_-]?secret)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;\]}]+"
)
_BEARER_PATTERN = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")
_ANSI_RESET = "\x1b[0m"
_SERVICE_TAG_COLORS = {
    # Bright ANSI colors keep service boundaries legible on dark and light
    # terminals, following a high-contrast CLI palette.
    "[Salesforce]": "\x1b[94m",  # bright blue
    "[Call-E]": "\x1b[92m",  # bright green
    "[QuoteWake]": "\x1b[93m",  # bright yellow
}


def _service_tag(service: object) -> str:
    """Return the stable visual tag used by the human-readable formatter."""

    normalized = str(service or "").strip().lower().replace("_", "-")
    return {
        "salesforce": "[Salesforce]",
        "call-e": "[Call-E]",
        "quotewake": "[QuoteWake]",
    }.get(normalized, "[QuoteWake]")


def _colorize_service_tag(tag: str) -> str:
    color = _SERVICE_TAG_COLORS.get(tag)
    if color is None:
        return tag
    return f"{color}{tag}{_ANSI_RESET}"


def _colorize_with_service(text: str, service_tag: str) -> str:
    """Color arbitrary service-adjacent text with the service tag palette."""

    color = _SERVICE_TAG_COLORS.get(service_tag)
    return f"{color}{text}{_ANSI_RESET}" if color is not None else text


def _mask_identifier(value: object, *, key: str) -> object:
    """Keep a short diagnostic fingerprint without logging full identifiers."""

    if not isinstance(value, str) or not value:
        return value

    def mask_token(token: str) -> str:
        if len(token) <= 6:
            return "[id-redacted]"
        return f"{token[:3]}…{token[-4:]}"

    if key == "idempotency_key":
        parts = value.split("-")
        if len(parts) >= 4:
            return f"{parts[0]}-{mask_token(parts[1])}-{parts[2]}-[digest-redacted]"
    return mask_token(value)


def mask_identifier(value: object, *, key: str) -> str:
    """Return the safe display form used by logs and CLI diagnostics."""

    masked = _mask_identifier(value, key=key)
    return str(masked) if masked is not None else "unknown"


def _stream_supports_color(stream: object) -> bool:
    """Return whether a console stream should receive ANSI color sequences."""

    if "NO_COLOR" in os.environ:
        return False
    isatty = getattr(stream, "isatty", None)
    return callable(isatty) and bool(isatty())


def _redact_log_value(
    key: str,
    value: Any,
    *,
    preserve_phone_fields: bool = False,
) -> Any:
    if _SECRET_KEY_PATTERN.search(key):
        return "[redacted]"
    phone_field = key.strip().lower() in {"phone", "phones"}
    if isinstance(value, str):
        redacted = value if preserve_phone_fields and phone_field else _PHONE_LIKE_PATTERN.sub(
            "[phone-redacted]", value
        )
        redacted = _SECRET_TEXT_PATTERN.sub("[secret-redacted]", redacted)
        return _BEARER_PATTERN.sub("Bearer [secret-redacted]", redacted)
    if isinstance(value, dict):
        return {
            name: _redact_log_value(
                str(name), item, preserve_phone_fields=preserve_phone_fields
            )
            for name, item in value.items()
            if not _SECRET_KEY_PATTERN.search(str(name))
        }
    if isinstance(value, (list, tuple)):
        return type(value)(
            _redact_log_value(
                key, item, preserve_phone_fields=preserve_phone_fields
            )
            for item in value
        )
    return value


class _ReadableFormatter(logging.Formatter):
    """Render application records as concise, human-readable text."""

    def __init__(self, *args: Any, use_color: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, self.datefmt)
        event = str(getattr(record, "quotewake_event", record.getMessage()))
        fields = getattr(record, "quotewake_fields", {})
        details = []
        for name, value in fields.items():
            if value is None or name in _HIDDEN_RENDER_FIELDS:
                continue
            if name in _IDENTIFIER_FIELDS:
                value = _mask_identifier(value, key=name)
            label = _LABELS.get(name, name.replace("_", " "))
            details.append(f"{label} {value}")
        message = "; ".join(details) or event.replace("_", " ").capitalize() + "."
        service_tag = _service_tag(fields.get("service"))
        tag = service_tag
        if self.use_color:
            tag = _colorize_service_tag(tag)
            event = _colorize_with_service(f"[{event}]", service_tag)
        else:
            event = f"[{event}]"
        return f"{timestamp} [{record.levelname.upper()}] {tag} {event}: {message}"


def logger() -> logging.Logger:
    """Return the configured application logger."""

    return logging.getLogger(LOGGER_NAME)


def _log_level(level: str) -> int:
    value = getattr(logging, level.upper(), None)
    if not isinstance(value, int):
        raise ValueError(f"Unknown log level: {level}")
    return value


def _project_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def configure_logging(
    *,
    level: str = DEFAULT_LOG_LEVEL,
    log_format: str = DEFAULT_LOG_FORMAT,
    log_directory: str | Path = DEFAULT_LOG_DIRECTORY,
    max_bytes: int = DEFAULT_LOG_MAX_BYTES,
    backup_count: int = DEFAULT_LOG_BACKUP_COUNT,
    redact_sensitive: bool = False,
) -> logging.Logger:
    """Configure standard-library logging with rotating text output."""

    log_level = _log_level(level)
    if not isinstance(redact_sensitive, bool):
        raise ValueError("redact_sensitive must be a boolean.")
    normalized_format = log_format.lower()
    if normalized_format != "text":
        raise ValueError(f"Unknown log format: {log_format}")
    if max_bytes <= 0:
        raise ValueError("Log max bytes must be greater than zero.")
    if backup_count < 0:
        raise ValueError("Log backup count cannot be negative.")

    directory = _project_path(log_directory)
    directory.mkdir(parents=True, exist_ok=True)
    log_path = directory / "quotewake.log"
    file_formatter = _ReadableFormatter(datefmt="%Y-%m-%d %H:%M:%S")

    application_logger = logger()
    for handler in list(application_logger.handlers):
        if getattr(handler, "_quotewake_managed", False):
            application_logger.removeHandler(handler)
            handler.close()

    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    stderr_handler = logging.StreamHandler()
    stderr_formatter = _ReadableFormatter(
        datefmt="%Y-%m-%d %H:%M:%S",
        use_color=_stream_supports_color(stderr_handler.stream),
    )
    for handler, handler_formatter in (
        (file_handler, file_formatter),
        (stderr_handler, stderr_formatter),
    ):
        handler._quotewake_managed = True  # type: ignore[attr-defined]
        handler.setLevel(log_level)
        handler.setFormatter(handler_formatter)
        application_logger.addHandler(handler)
    application_logger.setLevel(log_level)
    application_logger.propagate = False
    _REDACT_SENSITIVE.set(redact_sensitive)
    return application_logger


@contextmanager
def log_context(*, run_id: str | None = None, quote_id: str | None = None) -> Iterator[None]:
    """Temporarily bind correlation identifiers to the current context."""

    values = {
        key: value
        for key, value in {"run_id": run_id, "quote_id": quote_id}.items()
        if value is not None
    }
    if not values:
        yield
        return

    current = _LOG_CONTEXT.get()
    token = _LOG_CONTEXT.set({**current, **values})
    try:
        yield
    finally:
        _LOG_CONTEXT.reset(token)


def _level_value(level: int | str) -> int:
    if isinstance(level, str):
        value = logging.getLevelNamesMapping().get(level.upper())
        if value is None:
            raise ValueError(f"Unknown log level: {level}")
        return value
    return level


def log_event(
    event: str,
    *,
    level: int | str = logging.INFO,
    run_id: str | None = None,
    quote_id: str | None = None,
    preserve_phone_fields: bool = False,
    **fields: Any,
) -> None:
    """Emit one readable event with optional correlation identifiers.

    Call sites normally pass only operational identifiers and bounded domain
    values. The explicitly opt-in CALL-E support events may pass a payload;
    values are recursively redacted before the record is created.
    """

    event_fields = dict(_LOG_CONTEXT.get())
    event_fields.update(
        {
            key: value
            for key, value in {"run_id": run_id, "quote_id": quote_id}.items()
            if value is not None
        }
    )
    event_fields.update(
        {
            key: _redact_log_value(
                key,
                value,
                preserve_phone_fields=preserve_phone_fields and not _REDACT_SENSITIVE.get(),
            )
            for key, value in fields.items()
        }
    )
    logger().log(
        _level_value(level),
        event,
        extra={"quotewake_event": event, "quotewake_fields": event_fields},
    )


def log_exception(
    event: str,
    error: BaseException,
    *,
    run_id: str | None = None,
    quote_id: str | None = None,
    level: int | str = logging.ERROR,
    **fields: Any,
) -> None:
    """Log failure type without serializing untrusted exception text."""

    log_event(
        event,
        level=level,
        run_id=run_id,
        quote_id=quote_id,
        error_type=type(error).__name__,
        **fields,
    )


__all__ = [
    "DEFAULT_LOG_BACKUP_COUNT",
    "DEFAULT_LOG_DIRECTORY",
    "DEFAULT_LOG_FORMAT",
    "DEFAULT_LOG_LEVEL",
    "DEFAULT_LOG_MAX_BYTES",
    "configure_logging",
    "log_context",
    "log_event",
    "log_exception",
    "logger",
    "mask_identifier",
]
