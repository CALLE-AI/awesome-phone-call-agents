"""AgentCover CallGate — bounded autonomy around CALL-E phone calls.

Every CALL-E call intent is turned into an ActionRequest and run through the
real safety_protocol.SafetyProtocol before any dispatch. Only ALLOWED intents
reach CalleClient.calls.create_and_wait (the real SDK).
"""
from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass, field
from typing import Any

from calle import CalleClient

from safety_protocol.core import ActionRequest, AuditTrail, Monitor, ScopeRule
from safety_protocol.protocol import SafetyProtocol

from . import mock_calle
from .rules import DEFAULT_RULES, ALLOWED_VERBS


def _fp(phone: str) -> str:
    """Fingerprint a phone number — never store it in the clear."""
    return "fp:" + hashlib.sha256(phone.strip().encode()).hexdigest()[:16]


@dataclass
class CallPlan:
    """A proposed CALL-E call, normalized from a plan dict / JSON."""
    task: str
    phones: list[str]
    region: str = "US"
    locale: str = "en-US"
    estimated_cost: float = 1.0          # one outbound call, in $ units
    urgency: str = "normal"
    result_schema: dict | None = None
    idempotency_key: str | None = None
    metadata: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "CallPlan":
        phones = d.get("phones") or ([d["phone"]] if d.get("phone") else [])
        return cls(
            task=d["task"],
            phones=phones,
            region=d.get("region", "US"),
            locale=d.get("locale", "en-US"),
            estimated_cost=float(d.get("estimated_cost", 1.0)),
            urgency=d.get("urgency", "normal"),
            result_schema=d.get("result_schema"),
            idempotency_key=d.get("idempotency_key"),
            metadata=d.get("metadata") or {},
        )


@dataclass
class GateResult:
    outcome: str                       # allowed | blocked_* | pending_approval
    request_id: str
    reason: str | None = None
    call_result: dict | None = None    # populated when dispatched
    approval_token: str | None = None


class AgentCoverCallGate:
    """Wraps CALL-E in the safety_protocol enforcement layer."""

    def __init__(
        self,
        *,
        agent_id: str,
        user_id: str,
        api_key: str | None = None,
        base_url: str = "https://api.heycall-e.com",
        budget_limit: float = 5000.0,
        rules: list[ScopeRule] | None = None,
        calle_client: CalleClient | None = None,
        offline: bool = False,
    ):
        self.agent_id = agent_id
        self.user_id = user_id
        self.offline = offline

        audit = AuditTrail()
        monitor = Monitor(audit, agent_id)
        self.protocol = SafetyProtocol(
            agent_id=agent_id,
            user_id=user_id,
            scope_rules=rules if rules is not None else DEFAULT_RULES,
            budget_limit=budget_limit,
            approval_threshold_cost=10.0,
            audit=audit,
            monitor=monitor,
            allowed_action_types=ALLOWED_VERBS,
        )

        self._api_key = api_key or os.environ.get("CALLE_API_KEY")
        if calle_client is not None:
            self.calle = calle_client
        elif offline or self._api_key is None:
            # Real SDK client, but with a mock transport so nothing hits the
            # network and no call is placed. The SDK still builds the request,
            # attaches the idempotency header, and polls to a terminal state.
            self.calle = CalleClient(
                api_key=self._api_key or "agentcover_offline",
                base_url=base_url,
                http_client=mock_calle.offline_client(),
            )
        else:
            self.calle = CalleClient(api_key=self._api_key, base_url=base_url)

    # -- human controls ----------------------------------------------------
    def kill(self, reason: str = "operator") -> None:
        self.protocol.engage_killswitch(reason)

    def unfreeze(self) -> None:
        self.protocol.disengage_killswitch()

    def status(self) -> dict:
        return {
            "binding": self.protocol.binding,
            "spent": self.protocol._spent,
            "budget": self.protocol.budget_limit,
            "pending": self.protocol.get_pending_approvals(),
            "audit_tail": self.protocol.audit._entries[-3:],
        }

    # -- the gate ----------------------------------------------------------
    def gate(self, plan: CallPlan, *, execute: bool = False) -> GateResult:
        """Run a proposed CALL-E call through the protocol.

        If ALLOWED and ``execute`` is True, dispatch through the real SDK.
        If ALLOWED and ``execute`` is False, return allowed but do NOT call.
        """
        # One ActionRequest per recipient (each is its own real call).
        results = []
        for phone in plan.phones:
            req = ActionRequest(
                action_type="run_call",
                target=f"calle:call:{_fp(phone)}",
                params={
                    "region": plan.region,
                    "locale": plan.locale,
                    "task_len": len(plan.task),
                },
                method="POST",
                estimated_cost=plan.estimated_cost,
                urgency=plan.urgency,
                request_id=plan.idempotency_key or None,
            )
            res = self.protocol.execute(req)
            outcome = res.outcome.value
            reason = res.block_reason

            call_result = None
            if outcome == "allowed" and execute:
                call_result = self._dispatch(plan, phone)
            elif outcome == "pending_approval":
                return GateResult(
                    outcome=outcome,
                    request_id=req.request_id,
                    reason=reason,
                    approval_token=res.requires_approval_for,
                )

            results.append(GateResult(
                outcome=outcome,
                request_id=req.request_id,
                reason=reason,
                call_result=call_result,
            ))

        # Collapse single-recipient plans to one result; multi → first wins.
        r = results[0]
        if len(results) > 1:
            # If any blocked, report blocked with first reason.
            for x in results:
                if x.outcome != "allowed":
                    return x
        return r

    def _dispatch(self, plan: CallPlan, phone: str) -> dict:
        """Call the real CALL-E SDK. Returns the structured call result."""
        call = self.calle.calls.create_and_wait(
            task=plan.task,
            recipients=[{
                "phones": [phone],
                "region": plan.region,
                "locale": plan.locale,
            }],
            result_schema=plan.result_schema,
            metadata={**plan.metadata, "agentcover_agent": self.agent_id},
            idempotency_key=plan.idempotency_key
            or f"{self.agent_id}:{_fp(phone)}:{int(time.time())}",
        )
        self.protocol.audit.append("call_dispatched", self.agent_id, {
            "recipient_fp": _fp(phone),
            "call_id": call.get("id"),
            "status": call.get("status"),
        })
        return call
