from __future__ import annotations

from pydantic import BaseModel, Field


class IncidentRequest(BaseModel):
    incident: str = Field(
        ...,
        min_length=5,
        max_length=5000,
        description="Description of the production incident.",
    )

    severity: str = Field(
        ...,
        description=(
            "Incident severity: Critical, High, Medium, or Low."
        ),
    )

    demo_mode: bool = Field(
        default=True,
        description=(
            "Safe Demo Mode is enabled by default. "
            "When enabled, CALL-E escalation is simulated and "
            "no real phone call is placed."
        ),
    )


class IncidentResponse(BaseModel):
    """
    Incident analysis returned to the API and dashboard.

    AI enrichment fields use safe defaults so deterministic fallback
    analysis remains available when external model credentials are absent.
    """

    priority: str = Field(
        ...,
        description=(
            "Calculated incident priority, such as "
            "P1, P2, P3, or P4."
        ),
    )

    summary: str = Field(
        ...,
        description="Concise executive summary of the incident.",
    )

    root_cause: str = Field(
        default=(
            "Root-cause hypothesis is not available; "
            "further investigation is required."
        ),
        description=(
            "Most likely root-cause hypothesis identified "
            "during incident analysis."
        ),
    )

    business_impact: str = Field(
        default=(
            "Business impact has not yet been fully assessed."
        ),
        description=(
            "Likely customer, service, operational, "
            "or business impact."
        ),
    )

    owner: str = Field(
        default="Site Reliability Engineering",
        description=(
            "Recommended incident owner or responsible team."
        ),
    )

    recommendation: list[str] = Field(
        default_factory=list,
        description="Recommended incident-response actions.",
    )
