"""Open Referral HSDS 3.2 import shapes.

Callibrate's reference application is a community resource directory, so the
record it reconciles is an HSDS service. These are validation shapes for
importing one; the verification machinery upstream of them is not HSDS-specific.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class HSDSOrganizationInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=4000)
    email: str = Field(default="", max_length=320)
    website: str = Field(default="", max_length=2000)


class HSDSPhoneInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    number: str = Field(min_length=8, max_length=40)
    extension: str = Field(default="", max_length=20)
    type: str = Field(default="voice", max_length=40)
    description: str = Field(default="", max_length=500)


class HSDSScheduleInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    byday: str = Field(pattern=r"^(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*$")
    opens_at: str = Field(pattern=r"^\d{2}:\d{2}$")
    closes_at: str = Field(pattern=r"^\d{2}:\d{2}$")
    valid_from: date | None = None
    valid_to: date | None = None
    description: str = Field(default="", max_length=500)


class HSDSAddressInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    address_1: str = Field(min_length=1, max_length=500)
    city: str = Field(min_length=1, max_length=200)
    region: str = Field(min_length=1, max_length=100)
    postal_code: str = Field(min_length=1, max_length=30)


class HSDSLocationInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    location_type: Literal["physical"] = "physical"
    name: str = Field(default="", max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    addresses: list[HSDSAddressInput] = Field(min_length=1, max_length=10)


class HSDSServiceAtLocationInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    location: HSDSLocationInput


class HSDSServiceInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    organization_id: UUID
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=4000)
    status: Literal["active", "inactive", "defunct", "temporarily closed"]
    eligibility_description: str = Field(default="", max_length=4000)
    fees_description: str = Field(default="", max_length=2000)
    application_process: str = Field(default="", max_length=4000)
    alert: str = Field(default="", max_length=2000)
    organization: HSDSOrganizationInput
    phones: list[HSDSPhoneInput] = Field(default_factory=list, max_length=20)
    schedules: list[HSDSScheduleInput] = Field(default_factory=list, max_length=50)
    service_at_locations: list[HSDSServiceAtLocationInput] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def organization_ids_match(self):
        if self.organization_id != self.organization.id:
            raise ValueError("organization_id must match organization.id")
        return self


class HSDSImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    services: list[HSDSServiceInput] = Field(min_length=1, max_length=5000)
