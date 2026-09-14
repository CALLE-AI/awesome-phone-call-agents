"""Unit tests for CALL-E telephony bridge in OrderShield AI."""

import pytest
from src.calle_bridge import CalleBridge
from src.models import (
    CustomerDetails,
    InboundOrder,
    OrderItem,
    VerificationAction,
)


@pytest.fixture
def sample_order():
    return InboundOrder(
        order_id="TEST-COD-1",
        store_name="Test Store",
        customer=CustomerDetails(
            name="Aditi Rao",
            phone="+919876543210",
            address="45 Park Avenue",
            city="Mumbai",
            pincode="400001"
        ),
        items=[OrderItem(sku="ITM-1", title="Handbag", quantity=1, price=2499.0)],
        total_amount=2499.0
    )


def test_build_prompt(sample_order):
    bridge = CalleBridge()
    prompt = bridge.build_verification_prompt(sample_order)
    assert "Test Store" in prompt
    assert "Aditi Rao" in prompt
    assert "2499.00" in prompt
    assert "Press '1'" in prompt


def test_result_schema_structure():
    bridge = CalleBridge()
    schema = bridge.get_result_schema()
    assert schema["type"] == "object"
    assert "verified" in schema["properties"]
    assert "dtmf_key_pressed" in schema["properties"]
    assert "spoken_landmark" in schema["properties"]


def test_mock_dispatch_scenarios(sample_order):
    bridge = CalleBridge()
    
    # Scenario 1: Confirm
    res_confirm = bridge._mock_dispatch(sample_order, scenario="confirm")
    assert res_confirm.verified is True
    assert res_confirm.action == VerificationAction.CONFIRM
    assert res_confirm.dtmf_key_pressed == 1
    assert res_confirm.spoken_landmark is not None
    assert res_confirm.cost_credits_settled == 24

    # Scenario 2: Cancel
    res_cancel = bridge._mock_dispatch(sample_order, scenario="cancel")
    assert res_cancel.verified is False
    assert res_cancel.action == VerificationAction.CANCEL
    assert res_cancel.dtmf_key_pressed == 2

    # Scenario 3: Unreachable
    res_unreach = bridge._mock_dispatch(sample_order, scenario="unreachable")
    assert res_unreach.verified is False
    assert res_unreach.action == VerificationAction.UNREACHABLE
