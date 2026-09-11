from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar

from app.config import settings
from app.core.redact import redact_text

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get("-")
        return True


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        record.msg = redact_text(message)
        record.args = ()
        return True


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": redact_text(record.getMessage()),
        }
        if record.exc_info:
            payload["exc_info"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


class _RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact_text(super().format(record))


def _build_formatter() -> logging.Formatter:
    if settings.is_deployed:
        return _JsonFormatter()
    return _RedactingFormatter(
        "%(asctime)s %(levelname)s [%(name)s] [%(request_id)s] %(message)s"
    )


def _ensure_filter(handler: logging.Handler, filter_cls: type[logging.Filter]) -> None:
    if not any(isinstance(item, filter_cls) for item in handler.filters):
        handler.addFilter(filter_cls())


def configure_logging(level: str | None = None) -> None:
    root = logging.getLogger()
    resolved = (level or settings.log_level).upper()
    root.setLevel(resolved)

    formatter = _build_formatter()

    if root.handlers:
        for handler in root.handlers:
            _ensure_filter(handler, RequestIdFilter)
            _ensure_filter(handler, RedactFilter)
            handler.setFormatter(formatter)
    else:
        handler = logging.StreamHandler(sys.stdout)
        _ensure_filter(handler, RequestIdFilter)
        _ensure_filter(handler, RedactFilter)
        handler.setFormatter(formatter)
        root.addHandler(handler)

    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    logging.getLogger("apscheduler").setLevel(logging.INFO)
