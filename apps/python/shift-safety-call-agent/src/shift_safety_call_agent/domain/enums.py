"""Enumerations used by the domain model."""

from enum import StrEnum


class IncidentLevel(StrEnum):
    """Supported safety incident classifications."""

    NONE = "none"
    MINOR = "minor"
    MODERATE = "moderate"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


class InterviewStatus(StrEnum):
    """Lifecycle states for a safety interview."""

    DRAFT = "draft"
    PLANNED = "planned"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    CALLING = "calling"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ReviewDisposition(StrEnum):
    """Deterministic human-review outcomes derived from recorded facts."""

    ACTION_REQUIRED = "action_required"
    NEEDS_CLARIFICATION = "needs_clarification"
    NO_IMMEDIATE_ACTION = "no_immediate_action"
    NOT_ASSESSED = "not_assessed"
