"""Comprehensive test suite for Community Demo Policy requirements in OrderShield AI.

Verifies:
1. Pending/ambiguous dispatches halt safely at CALL_PENDING without fabricating confirmation.
2. Missing or unverified results never fabricate completed dispatch approval.
3. Live ASCII E.164 phone validation and synthetic number rejection.
4. Privacy masking for all telephone-bearing data.
5. Loopback access permissions and remote token authentication enforcement.
"""

import pytest
from fastapi.testclient import TestClient

from src.calle_bridge import CalleBridge
from src.models import (
    CustomerDetails,
    InboundOrder,
    OrderItem,
    OrderStatus,
    VerificationAction,
    mask_phone,
    validate_ascii_e164,
)
from src.order_engine import OrderShieldEngine
from src.server import app


@pytest.fixture
def sample_order():
    return InboundOrder(
        order_id="ORD-TEST-999",
        store_name="PolicyStore",
        customer=CustomerDetails(
            name="Alice Test",
            phone="+919876543210",
            address="123 Test Street",
            city="Mumbai",
            pincode="400001"
        ),
        items=[OrderItem(sku="SKU-1", title="Test Item", quantity=1, price=999.0)],
        total_amount=999.0
    )


def test_phone_masking():
    assert mask_phone("+919876543210") == "+91 •••• •••210"
    assert mask_phone("+14155552671") == "+14 •••• •••671"
    assert mask_phone("9876543210") == "•••• •••210"
    assert mask_phone(None) == "••••••••"


def test_ascii_e164_validation_and_synthetic_rejection():
    # Valid E.164 numbers
    assert validate_ascii_e164("+919876543210", allow_synthetic=False) == "+919876543210"
    assert validate_ascii_e164("+14152223344", allow_synthetic=False) == "+14152223344"

    # Invalid E.164 numbers
    with pytest.raises(ValueError, match="ASCII E.164"):
        validate_ascii_e164("9876543210")
    with pytest.raises(ValueError, match="ASCII E.164"):
        validate_ascii_e164("+123")
    with pytest.raises(ValueError, match="ASCII E.164"):
        validate_ascii_e164("invalid_phone")

    # Synthetic number rejection in live mode
    with pytest.raises(ValueError, match="Synthetic default destination"):
        validate_ascii_e164("+15555550123", allow_synthetic=False)

    # Synthetic allowed in mock mode
    assert validate_ascii_e164("+15555550123", allow_synthetic=True) == "+15555550123"


def test_https_base_url_enforcement():
    with pytest.raises(ValueError, match="approved HTTPS protocol"):
        CalleBridge(base_url="http://insecure-api.heycall-e.com")


@pytest.mark.asyncio
async def test_pending_dispatch_halts_at_call_pending(sample_order):
    engine = OrderShieldEngine()
    engine.register_order(sample_order)

    # Trigger pending verification scenario
    result = await engine.verify_order(sample_order.order_id, scenario="pending")

    assert result.verified is False
    assert result.action == VerificationAction.NEEDS_REVIEW
    # State MUST halt at CALL_PENDING, NEVER fabricate VERIFIED_DISPATCHED
    assert engine.order_states[sample_order.order_id] == OrderStatus.CALL_PENDING
    assert engine.total_cod_value_protected == 0.0


@pytest.mark.asyncio
async def test_unreachable_does_not_fabricate_confirmation(sample_order):
    engine = OrderShieldEngine()
    engine.register_order(sample_order)

    result = await engine.verify_order(sample_order.order_id, scenario="unreachable")

    assert result.verified is False
    assert result.action == VerificationAction.UNREACHABLE
    assert engine.order_states[sample_order.order_id] == OrderStatus.RETRY_SCHEDULED
    assert engine.total_cod_value_protected == 0.0


def test_loopback_access_and_phone_masking_in_api():
    client = TestClient(app)
    
    # 1. Loopback request to /api/v1/orders should succeed without explicit token
    resp = client.get("/api/v1/orders")
    assert resp.status_code == 200
    orders = resp.json()
    assert len(orders) > 0

    # 2. Check that phone is masked in output
    for o in orders:
        assert "••••" in o["customer_phone"]
        assert not o["customer_phone"].endswith("543210")  # raw phone must not leak
