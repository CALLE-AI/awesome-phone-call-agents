"""Dispatch phone work in waves, classify what came back, and be able to stop.

CALL-E has no cancel endpoint, no sandbox, and warns against dispatching everything at
once. This package is the layer that makes those facts survivable.
"""

from .models import (
    CANCELLED,
    NEVER_CARRIED,
    NO_CONSENT,
    NO_VOICE_CHANNEL,
    dial_refusal,
    DispatchReport,
    Escalation,
    ItemResult,
    Resolution,
    WorkItem,
    mask,
    redact,
    redact_free_text,
)
from .households import HOUSEHOLD_HELD, calls_removed, group as group_households
from .sources import CsvSource, DropSource, MemorySource, SourceError, WorkSource
from .scheduler import Cancelled, RetryPolicy, WaveDispatcher, default_idempotency_key
from .validation import UnsupportedSchema, is_valid, problems

__all__ = [
    "WaveDispatcher", "RetryPolicy", "Cancelled", "default_idempotency_key",
    "WorkItem", "ItemResult", "DispatchReport", "Resolution", "Escalation",
    "mask", "redact", "redact_free_text",
    "NO_CONSENT", "NO_VOICE_CHANNEL", "CANCELLED", "HOUSEHOLD_HELD",
    "dial_refusal",
    "NEVER_CARRIED",
    "group_households", "calls_removed",
    "is_valid", "problems", "UnsupportedSchema",
    "WorkSource", "CsvSource", "DropSource", "MemorySource", "SourceError",
]
