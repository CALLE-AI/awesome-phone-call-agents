"""Data models and type-safe schemas for OrderShield AI."""

from enum import Enum
import hashlib
import json
import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class OrderStatus(str, Enum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    CALL_IN_PROGRESS = "CALL_IN_PROGRESS"
    VERIFIED_DISPATCHED = "VERIFIED_DISPATCHED"
    CANCELLED_RESTOCKED = "CANCELLED_RESTOCKED"
    RETRY_SCHEDULED = "RETRY_SCHEDULED"
    HELD_FOR_MANUAL_REVIEW = "HELD_FOR_MANUAL_REVIEW"


class VerificationAction(str, Enum):
    CONFIRM = "CONFIRM"
    CANCEL = "CANCEL"
    UNREACHABLE = "UNREACHABLE"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class CustomerDetails(BaseModel):
    name: str = Field(..., description="Customer full name")
    phone: str = Field(..., description="E.164 phone number, e.g. +919876543210")
    address: str = Field(..., description="Street address")
    city: str = Field(..., description="Delivery city")
    pincode: str = Field(..., description="Postal/ZIP code")


class OrderItem(BaseModel):
    sku: str
    title: str
    quantity: int = 1
    price: float


class InboundOrder(BaseModel):
    order_id: str = Field(..., description="Unique merchant order ID, e.g. ORD-94021")
    store_name: str = Field("UrbanStride Shoes", description="Brand or store identifier")
    customer: CustomerDetails
    items: List[OrderItem]
    total_amount: float
    payment_method: str = "CASH_ON_DELIVERY"
    created_at: float = Field(default_factory=time.time)


class CalleVerificationResult(BaseModel):
    """Structured extraction returned by CALL-E agent via result_schema."""
    task_id: str = Field(..., description="CALL-E unique task identifier")
    order_id: str
    verified: bool = Field(..., description="Whether customer confirmed COD order")
    action: VerificationAction
    dtmf_key_pressed: Optional[int] = Field(None, description="1=Confirm, 2=Cancel")
    spoken_landmark: Optional[str] = Field(None, description="Verbal delivery instructions, e.g. 'Near Apollo Pharmacy'")
    call_confidence: float = Field(0.95, ge=0.0, le=1.0, description="Telecom carrier audio confidence")
    application_confidence: float = Field(0.98, ge=0.0, le=1.0, description="Contractual validation confidence")
    call_duration_seconds: float = Field(32.4, description="Call duration in seconds")
    cost_credits_settled: int = Field(24, description="CALL-E credits settled on billing ledger")


class OrderAuditRecord(BaseModel):
    """Tamper-evident audit record for order lifecycle."""
    order_id: str
    previous_status: OrderStatus
    new_status: OrderStatus
    timestamp: float = Field(default_factory=time.time)
    action: VerificationAction
    actor: str = "CALL_E_VOICE_AGENT"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    audit_hash: str = ""

    def calculate_hash(self, prev_hash: str = "0" * 64) -> str:
        payload = f"{prev_hash}|{self.order_id}|{self.previous_status}|{self.new_status}|{self.timestamp}|{self.action}"
        self.audit_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return self.audit_hash
