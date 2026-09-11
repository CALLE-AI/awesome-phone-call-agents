from enum import Enum


class PlanState(str, Enum):
    CREATED = "CREATED"
    QUEUED = "QUEUED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    DISPATCHED = "DISPATCHED"
    COMPLETED = "COMPLETED"
    DISMISSED = "DISMISSED"
    SNOOZED = "SNOOZED"
    EXPIRED = "EXPIRED"
    FAILED = "FAILED"
    STALE_PURGED = "STALE_PURGED"


TERMINAL_STATES: set[PlanState] = {
    PlanState.COMPLETED,
    PlanState.DISMISSED,
    PlanState.EXPIRED,
    PlanState.FAILED,
    PlanState.STALE_PURGED,
}

ACTIVE_STATES: set[PlanState] = {
    PlanState.CREATED,
    PlanState.QUEUED,
    PlanState.PENDING_APPROVAL,
    PlanState.APPROVED,
    PlanState.DISPATCHED,
    PlanState.SNOOZED,
}


class AgentType(str, Enum):
    PATIENT = "patient"
    BILLING = "billing"
    LENDING = "lending"


class ConsentStatus(str, Enum):
    GRANTED = "GRANTED"
    DENIED = "DENIED"
    UNKNOWN = "UNKNOWN"


class CallOutcome(str, Enum):
    ANSWERED = "ANSWERED"
    NO_ANSWER = "NO_ANSWER"
    VOICEMAIL = "VOICEMAIL"
    FAILED = "FAILED"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"
