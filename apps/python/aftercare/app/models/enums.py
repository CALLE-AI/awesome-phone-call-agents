from enum import Enum


class FollowUpStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CallStatus(str, Enum):
    QUEUED = "queued"
    FAILED = "failed"
    CANCELED = "canceled"
    DRY_RUN = "dry_run"
    OUTCOME_UNKNOWN = "outcome_unknown"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
