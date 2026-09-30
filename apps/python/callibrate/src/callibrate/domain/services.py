"""The record fields Callibrate can hold, and the requests that arrive from the web."""

from __future__ import annotations

from datetime import date
from typing import Literal, get_args

from pydantic import BaseModel, Field, model_validator

FieldName = Literal[
    "name",
    "description",
    "status",
    "schedule",
    "phone",
    "eligibility",
    "fees",
    "application_process",
    "alert",
    "address",
]

FIELD_NAMES: tuple[str, ...] = get_args(FieldName)

# What a field is called when it is read out loud on a phone call. The CALL-E
# goal is built from these, so the provider hears "the Wednesday opening hours",
# not "schedule".
FIELD_LABELS: dict[str, str] = {
    "name": "the name of the service",
    "description": "what the service provides",
    "status": "whether the service is still running",
    "schedule": "the opening hours",
    "phone": "the public phone number",
    "eligibility": "who is eligible to use the service",
    "fees": "what it costs",
    "application_process": "how somebody applies or arrives",
    "alert": "any temporary notice",
    "address": "the street address",
}


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=1000)


class DecisionRequest(BaseModel):
    action: Literal["approve", "reject", "edit", "acknowledge"]
    edited_value: str | None = Field(default=None, max_length=2000)
    note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def edit_requires_value(self):
        if self.action == "edit" and not self.edited_value:
            raise ValueError("edited_value is required when action is edit")
        return self


class IntakeSearch(BaseModel):
    need: str = Field(min_length=2, max_length=120)
    postal_code: str = Field(default="", max_length=20)
    limit: int = Field(default=5, ge=1, le=20)


class FailureReportRequest(BaseModel):
    service_id: str
    reason: Literal["disconnected", "closed", "wrong_hours", "ineligible", "moved", "other"]
    details: str = Field(default="", max_length=1000)
    referral_id: str | None = None


class ReferralAcceptRequest(BaseModel):
    service_id: str = Field(min_length=1, max_length=120)
    need: str = Field(min_length=2, max_length=120)
    postal_code: str = Field(default="", max_length=20)


class VerifyNowRequest(BaseModel):
    """A visitor pressing "Verify before I go" on a public record."""

    model_config = {"extra": "forbid"}
    service_id: str = Field(min_length=1, max_length=120)
    fields: list[FieldName] = Field(default_factory=lambda: ["schedule"], max_length=10)
    note: str = Field(default="", max_length=500)


class ConsentRequest(BaseModel):
    model_config = {"extra": "forbid"}
    organization_id: str = Field(min_length=1, max_length=120)
    phone_number: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    timezone: str = Field(min_length=1, max_length=100)
    allowed_days: list[Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]] = Field(
        min_length=1, max_length=7
    )
    earliest_local: str = Field(pattern=r"^\d{2}:\d{2}$")
    latest_local: str = Field(pattern=r"^\d{2}:\d{2}$")
    valid_from: date
    valid_until: date
    max_calls: int = Field(ge=1, le=10_000)
    recording_allowed: bool = False
    consented_by: str = Field(min_length=1, max_length=300)
    evidence_reference: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid_window(self):
        if self.valid_until < self.valid_from:
            raise ValueError("valid_until must be on or after valid_from")
        for value in (self.earliest_local, self.latest_local):
            hour, minute = map(int, value.split(":"))
            if hour > 23 or minute > 59:
                raise ValueError("call window times must be valid 24-hour times")
        if len(set(self.allowed_days)) != len(self.allowed_days):
            raise ValueError("allowed_days cannot contain duplicates")
        return self
