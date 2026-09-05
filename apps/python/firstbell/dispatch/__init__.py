"""Dispatch phone work in waves, classify what came back, and be able to stop.

CALL-E has no cancel endpoint, no sandbox, and warns against dispatching everything at
once. This package is the layer that makes those facts survivable.
"""

from .models import (
    DispatchReport,
    Escalation,
    ItemResult,
    Resolution,
    WorkItem,
    mask,
    redact_free_text,
)
from .sources import CsvSource, MemorySource, SourceError, WorkSource
from .scheduler import Cancelled, RetryPolicy, WaveDispatcher, default_idempotency_key
from .validation import UnsupportedSchema, is_valid, problems

__all__ = [
    "WaveDispatcher", "RetryPolicy", "Cancelled", "default_idempotency_key",
    "WorkItem", "ItemResult", "DispatchReport", "Resolution", "Escalation",
    "mask", "redact_free_text",
    "is_valid", "problems", "UnsupportedSchema",
    "WorkSource", "CsvSource", "MemorySource", "SourceError",
]
