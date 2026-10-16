from pydantic import BaseModel, Field


class EscalationRequest(BaseModel):
    incident: str = Field(
        ...,
        min_length=5,
        max_length=5000,
    )
    severity: str
    approved: bool = Field(
        default=False,
        description="Explicit approval for this single live escalation.",
    )
