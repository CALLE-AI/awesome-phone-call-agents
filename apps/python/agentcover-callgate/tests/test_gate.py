"""Tests: prove the gate allows, blocks, budgets, and kills — offline."""
import json
import os
import sys
import unittest

# Make the safety_protocol engine importable (it lives in the sibling repo).
sys.path.insert(0, os.environ.get(
    "SAFETY_PROTOCOL_SRC",
    r"C:/Users/michael/safety-protocol/src",
))

from agentcover_callgate import AgentCoverCallGate, CallPlan
from agentcover_callgate import rules as R


def gate(offline=True, budget=5000.0):
    return AgentCoverCallGate(
        agent_id="sched_agent_01",
        user_id="michael",
        budget_limit=budget,
        offline=offline,
    )


class TestGate(unittest.TestCase):
    def test_allow_in_scope(self):
        g = gate()
        plan = CallPlan(
            task="Confirm Tuesday 2pm appointment.",
            phones=["+15551234567"],
            region="US",
            locale="en-US",
            estimated_cost=1.0,
            idempotency_key="t_allow",
        )
        res = g.gate(plan, execute=True)  # offline mock transport
        self.assertEqual(res.outcome, "allowed")
        # offline: the SDK still returned a simulated terminal result
        self.assertIsNotNone(res.call_result)
        self.assertEqual(res.call_result["status"], "completed")

    def test_block_unknown_verb(self):
        g = gate()
        from safety_protocol.core import ActionRequest
        res = g.protocol.execute(ActionRequest(
            action_type="spawn_subagent", target="x", estimated_cost=0.0))
        self.assertEqual(res.outcome.value, "blocked_scope")

    def test_block_unlisted_recipient(self):
        g = gate()
        plan = CallPlan(
            task="Hi.",
            phones=["+19999999999"],  # not in the allowlist
            region="US",
            locale="en-US",
            estimated_cost=1.0,
            idempotency_key="t_block",
        )
        res = g.gate(plan, execute=True)
        self.assertEqual(res.outcome, "blocked_scope")
        self.assertIn("denied by default", res.reason)

    def test_block_over_budget(self):
        g = gate(budget=2.0)
        # Two $1 calls: second should be blocked by budget.
        p1 = CallPlan(task="a", phones=["+15551234567"], estimated_cost=1.0,
                      idempotency_key="b1")
        p2 = CallPlan(task="b", phones=["+15551234567"], estimated_cost=1.5,
                      idempotency_key="b2")
        g.gate(p1, execute=True)
        res = g.gate(p2, execute=True)
        self.assertEqual(res.outcome, "blocked_budget")

    def test_kill_switch(self):
        g = gate()
        g.kill("operator test")
        plan = CallPlan(task="a", phones=["+15551234567"], estimated_cost=1.0,
                        idempotency_key="k1")
        res = g.gate(plan, execute=True)
        self.assertEqual(res.outcome, "blocked_killswitch")
        g.unfreeze()

    def test_audit_present(self):
        g = gate()
        g.gate(CallPlan(task="a", phones=["+15551234567"], estimated_cost=1.0,
                        idempotency_key="au1"), execute=True)
        self.assertGreater(len(g.protocol.audit._entries), 0)
        events = [e["event_type"] for e in g.protocol.audit._entries]
        self.assertIn("action_allowed", events)


if __name__ == "__main__":
    unittest.main(verbosity=2)
