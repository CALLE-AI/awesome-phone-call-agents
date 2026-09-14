"""Core Order & Anti-RTO State Machine Engine for OrderShield AI."""

import time
from typing import Any, Dict, List, Optional
from src.calle_bridge import CalleBridge
from src.models import (
    CalleVerificationResult,
    InboundOrder,
    OrderAuditRecord,
    OrderStatus,
    VerificationAction,
)


class OrderShieldEngine:
    def __init__(self, bridge: Optional[CalleBridge] = None):
        self.bridge = bridge or CalleBridge()
        self.orders: Dict[str, InboundOrder] = {}
        self.order_states: Dict[str, OrderStatus] = {}
        self.order_results: Dict[str, CalleVerificationResult] = {}
        self.audit_log: List[OrderAuditRecord] = []
        self.latest_audit_hash: str = "0" * 64

        # Financial Metrics
        self.rto_shipping_cost_saved: float = 0.0  # In INR (Rs. 200 per avoided fake COD delivery)
        self.total_cod_value_protected: float = 0.0

    def register_order(self, order: InboundOrder) -> OrderStatus:
        self.orders[order.order_id] = order
        self.order_states[order.order_id] = OrderStatus.PENDING_VERIFICATION
        
        # Record initial audit entry
        record = OrderAuditRecord(
            order_id=order.order_id,
            previous_status=OrderStatus.PENDING_VERIFICATION,
            new_status=OrderStatus.PENDING_VERIFICATION,
            action=VerificationAction.NEEDS_REVIEW,
            metadata={"amount": order.total_amount, "customer": order.customer.name}
        )
        self.latest_audit_hash = record.calculate_hash(self.latest_audit_hash)
        self.audit_log.append(record)
        return OrderStatus.PENDING_VERIFICATION

    async def verify_order(
        self,
        order_id: str,
        scenario: str = "confirm"
    ) -> CalleVerificationResult:
        if order_id not in self.orders:
            raise ValueError(f"Order #{order_id} not registered in OrderShield.")

        order = self.orders[order_id]
        
        # 1. Transition to CALL_IN_PROGRESS
        prev_status = self.order_states[order_id]
        self.order_states[order_id] = OrderStatus.CALL_IN_PROGRESS
        
        # 2. Dispatch Call via CALL-E Bridge
        if scenario in ["cancel", "unreachable"]:
            result = self.bridge._mock_dispatch(order, scenario=scenario)
        else:
            result = await self.bridge.dispatch_verification_call(order)

        self.order_results[order_id] = result

        # 3. Evaluate Outcome and Transition State
        if result.verified and result.action == VerificationAction.CONFIRM:
            new_status = OrderStatus.VERIFIED_DISPATCHED
            self.total_cod_value_protected += order.total_amount
        elif result.action == VerificationAction.CANCEL:
            new_status = OrderStatus.CANCELLED_RESTOCKED
            # Save 2-way return shipping penalty (Rs. 200)
            self.rto_shipping_cost_saved += 200.0
        elif result.action == VerificationAction.UNREACHABLE:
            new_status = OrderStatus.RETRY_SCHEDULED
        else:
            new_status = OrderStatus.HELD_FOR_MANUAL_REVIEW

        self.order_states[order_id] = new_status

        # 4. Append Tamper-Evident SHA-256 Audit Record
        audit_record = OrderAuditRecord(
            order_id=order_id,
            previous_status=prev_status,
            new_status=new_status,
            action=result.action,
            metadata={
                "task_id": result.task_id,
                "dtmf_key": result.dtmf_key_pressed,
                "landmark": result.spoken_landmark,
                "confidence": result.call_confidence
            }
        )
        self.latest_audit_hash = audit_record.calculate_hash(self.latest_audit_hash)
        self.audit_log.append(audit_record)

        return result

    def get_metrics(self) -> Dict[str, Any]:
        total = len(self.orders)
        verified = sum(1 for s in self.order_states.values() if s == OrderStatus.VERIFIED_DISPATCHED)
        cancelled = sum(1 for s in self.order_states.values() if s == OrderStatus.CANCELLED_RESTOCKED)
        retries = sum(1 for s in self.order_states.values() if s == OrderStatus.RETRY_SCHEDULED)
        
        return {
            "total_orders": total,
            "verified_orders": verified,
            "cancelled_fake_orders": cancelled,
            "retries_scheduled": retries,
            "rto_prevention_rate_pct": round((cancelled / total * 100) if total > 0 else 0, 1),
            "shipping_fees_saved_inr": self.rto_shipping_cost_saved,
            "cod_value_protected_inr": self.total_cod_value_protected,
            "audit_trail_depth": len(self.audit_log),
            "latest_sha256_audit_seal": self.latest_audit_hash
        }
