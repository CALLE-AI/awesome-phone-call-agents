"""QuoteWake application logging using Python's standard library.

The CLI writes readable events to a rotating project-local log file and to
stderr. Both streams use one event per line in the form
``timestamp [LEVEL] event: readable message``.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
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
_LABELS = {
    "run_id": "run",
    "quote_id": "quote",
    "contact_id": "contact",
    "task_id": "task",
    "plan_id": "plan",
    "simulation_id": "simulation",
    "error_type": "error type",
}


class _ReadableFormatter(logging.Formatter):
    """Render application records as concise, human-readable text."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, self.datefmt)
        event = str(getattr(record, "quotewake_event", record.getMessage()))
        fields = getattr(record, "quotewake_fields", {})
        details = []
        for name, value in fields.items():
            if value is None:
                continue
            label = _LABELS.get(name, name.replace("_", " "))
            details.append(f"{label} {value}")
        message = "; ".join(details) or event.replace("_", " ").capitalize() + "."
        return f"{timestamp} [{record.levelname.upper()}] {event}: {message}"


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
) -> logging.Logger:
    """Configure standard-library logging with rotating text output."""

    log_level = _log_level(level)
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
    formatter = _ReadableFormatter(datefmt="%Y-%m-%d %H:%M:%S")

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
    for handler in (file_handler, stderr_handler):
        handler._quotewake_managed = True  # type: ignore[attr-defined]
        handler.setLevel(log_level)
        handler.setFormatter(formatter)
        application_logger.addHandler(handler)
    application_logger.setLevel(log_level)
    application_logger.propagate = False
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
    **fields: Any,
) -> None:
    """Emit one readable event with optional correlation identifiers.

    Call sites intentionally pass only operational identifiers and bounded
    domain values. Credentials, raw payloads, and exception text are not
    accepted by the application event vocabulary.
    """

    event_fields = dict(_LOG_CONTEXT.get())
    event_fields.update(
        {
            key: value
            for key, value in {"run_id": run_id, "quote_id": quote_id}.items()
            if value is not None
        }
    )
    event_fields.update(fields)
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
]
