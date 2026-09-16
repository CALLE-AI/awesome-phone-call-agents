"""Python mirror of the parts of types/campaign.ts the engine needs — Contact as the
compiler's input, CalleCallRequest as its output. Campaign/CallResult persistence stays
in Supabase/Next.js; the engine never stores anything.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Contact(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    phone_number: str = Field(alias="phoneNumber")
    metadata: dict[str, str] | None = None


class CalleCallRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task: str
    result_schema: dict
    recipient_result_schema: dict | None = None
    metadata: dict[str, str]
    webhook_url: str
