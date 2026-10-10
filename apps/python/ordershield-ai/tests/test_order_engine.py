"""Unit tests for OrderShield state machine and RTO prevention engine."""

import pytest
from src.calle_bridge import CalleBridge
from src.models import (
    CustomerDetails,
    InboundOrder,
    OrderItem,
    OrderStatus,
    VerificationAction,
)
from src.order_engine import OrderShieldEngine


@pytest.fixture
def test_engine():
    return OrderShieldEngine(bridge=CalleBridge())


@pytest.fixture
def test_order():
    return InboundOrder(
        order_id="ORD-ENG-01",
        customer=CustomerDetails(
            name="Vikram Singh",
            phone="+919876543210",
            address="Sector 14",
            city="Gurugram",
            pincode="122001"
        ),
        items=[OrderItem(sku="WCH-01", title="Chronograph Watch", quantity=1, price=3999.0)],
        total_amount=3999.0
    )


@pytest.mark.asyncio
async def test_order_registration_and_confirm(test_engine, test_order):
    status = test_engine.register_order(test_order)
    assert status == OrderStatus.PENDING_VERIFICATION
    assert test_order.order_id in test_engine.orders

    # Verify confirmation flow
    result = await test_engine.verify_order(test_order.order_id, scenario="confirm")
    assert result.verified is True
    assert test_engine.order_states[test_order.order_id] == OrderStatus.VERIFIED_DISPATCHED
    
    metrics = test_engine.get_metrics()
    assert metrics["verified_orders"] == 1
    assert metrics["cod_value_protected_inr"] == 3999.0


@pytest.mark.asyncio
async def test_order_cancellation_and_rto_savings(test_engine):
    fake_order = InboundOrder(
        order_id="ORD-FAKE-02",
        customer=CustomerDetails(
            name="Impulse Buyer",
            phone="+919999988888",
            address="Unknown Alley",
            city="Pune",
            pincode="411001"
        ),
        items=[OrderItem(sku="TSH-01", title="Printed Tee", quantity=2, price=999.0)],
        total_amount=999.0
    )
    test_engine.register_order(fake_order)
    result = await test_engine.verify_order(fake_order.order_id, scenario="cancel")
    assert result.action == VerificationAction.CANCEL
    assert test_engine.order_states[fake_order.order_id] == OrderStatus.CANCELLED_RESTOCKED
    
    metrics = test_engine.get_metrics()
    assert metrics["cancelled_fake_orders"] == 1
    assert metrics["shipping_fees_saved_inr"] == 200.0
    assert len(test_engine.audit_log) >= 2
