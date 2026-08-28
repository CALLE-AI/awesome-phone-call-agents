"""AgentCover CallGate — experimental bounded-autonomy demo around CALL-E calls.

This is an IN-MEMORY DEMO. Every CALL-E call intent is turned into an
ActionRequest and run through a small, vendored enforcement layer
(`_engine.py`) before any dispatch. Only ALLOWED intents reach
`CalleClient.calls.create_and_wait` (the real SDK).

The audit trail and gating state are in-memory and experimental — NOT a
production system of record, NOT immutable, NOT claims-ready. See README.
"""
from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from calle import CalleClient

from . import mock_calle
from ._engine import (
    ActionOutcome,
    ActionRequest,
    AuditTrail,
    SafetyProtocol,
    ScopeRule,
)
from .rules import DEFAULT_RULES, ALLOWED_VERBS

# Official CALL-E API origin. Live (credential-bearing) requests are restricted
# to this exact HTTPS origin; never a custom or http base_url with credentials.
OFFICIAL_CALLE_BASE_URL = "https://api.heycall-e.com"

# Strict E.164: leading +, 1-15 digits, no spaces/letters/punctuation.
_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")


def is_e164(phone: str) -> bool:
    """Return True only for a strict E.164 number."""
    return bool(_E164_RE.match(phone or ""))


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
    """Wraps CALL-E in a small, experimental enforcement layer (in-memory)."""

    def __init__(
        self,
        *,
        agent_id: str,
        user_id: str,
        api_key: str | None = None,
        base_url: str = OFFICIAL_CALLE_BASE_URL,
        budget_limit: float = 5000.0,
        rules: list[ScopeRule] | None = None,
        calle_client: CalleClient | None = None,
        offline: bool = False,
    ):
        if base_url != OFFICIAL_CALLE_BASE_URL:
            raise ValueError(
                f"Live CALL-E requests are restricted to the official origin "
                f"{OFFICIAL_CALLE_BASE_URL}; got {base_url!r}"
            )
        self.agent_id = agent_id
        self.user_id = user_id
        self.offline = offline

        audit = AuditTrail()
        self.protocol = SafetyProtocol(
            agent_id=agent_id,
            user_id=user_id,
            scope_rules=rules if rules is not None else DEFAULT_RULES,
            budget_limit=budget_limit,
            approval_threshold_cost=10.0,
            allowed_action_types=ALLOWED_VERBS,
        )
        # reuse the same audit instance
        self.protocol.audit = audit

        self._api_key = api_key or os.environ.get("CALLE_API_KEY")
        if calle_client is not None:
            self.calle = calle_client
        elif offline or self._api_key is None:
            # Real SDK client, but with a mock transport so nothing hits the
            # network and no call is placed. The SDK still builds the request,
            # attaches the idempotency header, and polls to a terminal state.
            self.calle = CalleClient(
                api_key=self._api_key or "agentcover_offline",
                base_url=OFFICIAL_CALLE_BASE_URL,
                http_client=mock_calle.offline_client(),
            )
        else:
            self.calle = CalleClient(api_key=self._api_key,
                                    base_url=OFFICIAL_CALLE_BASE_URL)

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
            "note": "in-memory experimental demo; not a system of record",
        }

    # -- the gate ----------------------------------------------------------
    def gate(self, plan: CallPlan, *, execute: bool = False) -> GateResult:
        """Run a proposed CALL-E call through the protocol.

        If ALLOWED and ``execute`` is True, dispatch through the real SDK.
        If ALLOWED and ``execute`` is False, return allowed but do NOT call.
        Live dispatch (--execute with CALLE_API_KEY) validates each recipient
        as strict E.164 before dialing.
        """
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

        r = results[0]
        if len(results) > 1:
            for x in results:
                if x.outcome != "allowed":
                    return x
        return r

    def _dispatch(self, plan: CallPlan, phone: str) -> dict:
        """Call the real CALL-E SDK. Returns the structured call result.

        Live recipients must be strict E.164. Use only the official origin.
        """
        # In offline/demo mode the "phone" may be a masked placeholder; the
        # mock transport never dials. For a REAL call we require strict E.164.
        if not self.offline and not is_e164(phone):
            self.protocol.audit.append("call_rejected_bad_number", self.agent_id,
                                        {"target": _fp(phone)})
            raise ValueError(
                f"Refusing live dispatch: recipient {phone!r} is not strict E.164"
            )
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
