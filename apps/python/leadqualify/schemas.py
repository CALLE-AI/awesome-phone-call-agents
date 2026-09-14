from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict

# Input Schemas
class LeadCreate(BaseModel):
    name: str = Field(..., json_schema_extra={"examples": ["Taylor Swift"]})
    phone: str = Field(..., json_schema_extra={"examples": ["+15550199"]})
    company: Optional[str] = Field(None, json_schema_extra={"examples": ["Swift Enterprises"]})
    product_interest: Optional[str] = Field(None, json_schema_extra={"examples": ["Enterprise CRM Integration"]})

# Output Schemas
class LeadOut(BaseModel):
    id: int
    name: str
    phone: str
    company: Optional[str]
    product_interest: Optional[str]
    call_id: Optional[str]
    status: str
    pain_point: Optional[str]
    timeline_window: Optional[str]
    budget_status: Optional[str]
    interest_level: Optional[str]
    handoff_recommended: bool
    notes: Optional[str]
    transcript: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# Webhook payload schemas
class WebhookEvent(BaseModel):
    id: str
    type: str
    created_at: str
    data: Dict[str, Any]

