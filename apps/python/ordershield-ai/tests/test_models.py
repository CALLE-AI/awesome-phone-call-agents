"""Unit tests for OrderShield data models and audit hashing."""

import pytest
from src.models import (
    CustomerDetails,
    InboundOrder,
    OrderItem,
    OrderAuditRecord,
    OrderStatus,
    VerificationAction,
)


def test_inbound_order_creation():
    order = InboundOrder(
        order_id="TEST-001",
        customer=CustomerDetails(
            name="Rahul Sharma",
            phone="+919876543210",
            address="123 Main St",
            city="Delhi",
            pincode="110001"
        ),
        items=[OrderItem(sku="SKU-1", title="Sneaker", quantity=1, price=1999.0)],
        total_amount=1999.0
    )
    assert order.order_id == "TEST-001"
    assert order.total_amount == 1999.0
    assert order.customer.city == "Delhi"


def test_order_audit_hash_chain():
    record = OrderAuditRecord(
        order_id="TEST-001",
        previous_status=OrderStatus.PENDING_VERIFICATION,
        new_status=OrderStatus.VERIFIED_DISPATCHED,
        action=VerificationAction.CONFIRM
    )
    h1 = record.calculate_hash("0" * 64)
    assert len(h1) == 64
    assert isinstance(h1, str)

    # Deterministic check
    h2 = record.calculate_hash("0" * 64)
    assert h1 == h2
