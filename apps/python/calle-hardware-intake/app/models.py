"""Pydantic request/response schemas for the API."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TicketCreate(BaseModel):
    device_type: str
    issue_description: str
    priority: str = "normal"
    customer_name: Optional[str] = None
    status: str = "open"


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_number: str
    device_type: Optional[str] = None
    issue_description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    customer_name: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    created_at: datetime


class CallCreate(BaseModel):
    phone: str = Field(description="Destination number in E.164, e.g. +15551234567")
    goal: str = Field(description="What the agent should accomplish on the call")


class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: Optional[str] = None
    plan_id: Optional[str] = None
    phone: str
    goal: str
    status: str
    summary: Optional[str] = None
    error: Optional[str] = None
    ticket: Optional[TicketOut] = None
    created_at: datetime


class IntakeRequest(BaseModel):
    transcript: str = Field(description="Raw call transcript / notes to analyze")


class IntakeResponse(BaseModel):
    ticket: Optional[TicketOut] = None
    actions: list[str] = []
    notes: str = ""
