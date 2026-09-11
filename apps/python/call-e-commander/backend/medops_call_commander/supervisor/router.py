from ..agents.base import BaseAgent
from ..agents.billing import BillingAgent
from ..agents.lending import LendingAgent
from ..agents.patient import PatientAgent
from ..core.exceptions import UnroutableEvent
from ..core.models import CallPlan, EHREvent

# Static dispatch table — no LLM routing, no fuzzy matching.
# Unknown event types hard-fail immediately.
ROUTING_TABLE: dict[str, type[BaseAgent]] = {
    "missed_appointment":     PatientAgent,
    "no_checkin_48h":         PatientAgent,
    "invoice_30_days":        BillingAgent,
    "invoice_60_days":        BillingAgent,
    "invoice_90_days":        BillingAgent,
    "loan_inquiry_submitted": LendingAgent,
}


def route(event: EHREvent) -> CallPlan:
    """
    Routes a normalized EHREvent to the correct domain agent.
    Returns a CallPlan with dry_run=True.
    Raises UnroutableEvent if event_type has no registered agent.
    Supervisor never touches CALL-E or EHR adapters directly.
    """
    agent_cls = ROUTING_TABLE.get(event.event_type)
    if not agent_cls:
        raise UnroutableEvent(
            f"No agent registered for event type: '{event.event_type}'. "
            f"Registered types: {list(ROUTING_TABLE.keys())}"
        )
    return agent_cls().handle(event)
