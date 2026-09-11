class MedOpsBaseException(Exception):
    """Base for all MedOps domain exceptions."""


class AgentBoundaryViolation(MedOpsBaseException):
    """Agent received an event type outside its ALLOWED_EVENT_TYPES."""


class UnroutableEvent(MedOpsBaseException):
    """Supervisor received an event type with no registered agent."""


class DuplicateCallPrevented(MedOpsBaseException):
    """An active or completed CallPlan already exists for this idempotency key."""


class ConsentDenied(MedOpsBaseException):
    """ConsentGate returned DENIED or UNKNOWN — call must not proceed."""


class PlanExpired(MedOpsBaseException):
    """CallPlan TTL elapsed before reaching next state."""


class InvalidStateTransition(MedOpsBaseException):
    """Attempted an illegal state transition on a CallPlan."""
    def __init__(self, from_state: str, to_state: str):
        super().__init__(f"Cannot transition {from_state} -> {to_state}")


class UnapprovedDispatch(MedOpsBaseException):
    """Executor received a CallPlan without a valid approval record."""


class EHRAdapterError(MedOpsBaseException):
    """EHR adapter failed to normalize event or write result."""


class PHIScrubError(MedOpsBaseException):
    """Reaper failed to scrub PHI fields from a CallPlan."""
