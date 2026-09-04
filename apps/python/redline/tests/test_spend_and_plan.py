"""Tests for the dry/wet boundary.

The point of this file is one assertion, repeated in several shapes: nothing on
the free path can place a call. CALL-E has no sandbox, so that boundary is the
only thing between a test suite and somebody's telephone.

The pattern is borrowed from the CALL-E repository's own most instructive test,
which asserts on *which operations were invoked* rather than on what they
returned -- because whether a call was placed is the only thing that separates
"planned" from "dialled".
"""

from __future__ import annotations

import json
import subprocess
from typing import Any, ClassVar

import pytest

from redline.calle.plan import (
    PLAN_TOOL,
    PlanningError,
    _build_command,
    plan_call,
)
from redline.spend import (
    CREDITS_PER_CALL,
    SpendLedger,
    Wetness,
    WetOperationRefusedError,
)


class Completed:
    """Stands in for subprocess.CompletedProcess."""

    def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


def runner_returning(payload: Any) -> Any:
    body = payload if isinstance(payload, str) else json.dumps(payload)
    captured: dict[str, Any] = {}

    def run(command: list[str], timeout: int) -> Completed:
        captured["command"] = command
        return Completed(stdout=body)

    run.captured = captured  # type: ignore[attr-defined]
    return run


# --- The ledger ---------------------------------------------------------------


class TestSpendLedger:
    def test_dry_operations_cost_nothing(self) -> None:
        ledger = SpendLedger()
        ledger.record_dry("plan_call")
        ledger.record_dry("goals.list")
        assert ledger.credits_spent == 0
        assert ledger.calls_placed == 0
        ledger.assert_nothing_was_spent()

    def test_a_wet_operation_needs_budget(self) -> None:
        ledger = SpendLedger(call_budget=0)
        with pytest.raises(WetOperationRefusedError, match="budgeted for 0"):
            ledger.record_wet("calls.create")

    def test_the_budget_is_enforced_in_one_place(self) -> None:
        # Checked inside record_wet rather than at each call site, so a new
        # code path cannot forget to check.
        ledger = SpendLedger(call_budget=2)
        ledger.record_wet("calls.create")
        ledger.record_wet("calls.create")
        with pytest.raises(WetOperationRefusedError):
            ledger.record_wet("calls.create")
        assert ledger.calls_placed == 2

    def test_credits_are_counted_at_five_per_call(self) -> None:
        ledger = SpendLedger(call_budget=3)
        ledger.record_wet("calls.create")
        assert ledger.credits_spent == CREDITS_PER_CALL

    def test_assert_nothing_was_spent_names_what_spent_it(self) -> None:
        ledger = SpendLedger(call_budget=1)
        ledger.record_wet("calls.create", detail="scenario x")
        with pytest.raises(AssertionError, match=r"calls\.create"):
            ledger.assert_nothing_was_spent()

    def test_operations_keep_their_order(self) -> None:
        ledger = SpendLedger(call_budget=1)
        ledger.record_dry("plan_call")
        ledger.record_wet("calls.create")
        ledger.record_dry("goals.list")
        assert ledger.names == ("plan_call", "calls.create", "goals.list")
        assert ledger.wet_names() == ("calls.create",)

    def test_the_summary_says_what_a_run_cost(self) -> None:
        ledger = SpendLedger(call_budget=1)
        ledger.record_dry("plan_call")
        assert "0 calls, 0 credits" in ledger.summary_line()
        ledger.record_wet("calls.create")
        assert "5 credits" in ledger.summary_line()

    def test_wetness_decides_the_price(self) -> None:
        ledger = SpendLedger(call_budget=1)
        assert ledger.record_dry("plan_call").credits == 0
        assert ledger.record_wet("calls.create").credits == CREDITS_PER_CALL
        assert ledger.operations[0].wetness is Wetness.DRY
        assert ledger.operations[1].wetness is Wetness.WET


# --- Planning -----------------------------------------------------------------


class TestPlanningPlacesNoCall:
    ACCEPTED: ClassVar[dict[str, Any]] = {
        "result": {
            "structuredContent": {
                "plan_id": "plan_abc",
                "confirm_token": "tok_abc",
                "ready_to_run": True,
                "display_goal": "Call the customer and confirm Thursday. "
                "If nobody answers, do not leave a message.",
            }
        }
    }

    def test_it_never_invokes_the_tool_that_dials(self) -> None:
        # The assertion that matters. `run_call` is the only MCP tool that
        # places a call, and this module must have no way to reach it.
        command = _build_command({"user_input": "hello"})
        assert PLAN_TOOL in command
        assert "run_call" not in command
        assert "start" not in command

    def test_planning_is_recorded_as_free(self) -> None:
        ledger = SpendLedger(call_budget=0)
        plan_call(
            "Call the customer.", ledger=ledger, runner=runner_returning(self.ACCEPTED)
        )
        assert ledger.credits_spent == 0
        assert ledger.names == (PLAN_TOOL,)
        ledger.assert_nothing_was_spent()

    def test_planning_works_with_a_zero_call_budget(self) -> None:
        # If planning could ever be refused by the budget, the free path would
        # be unusable in exactly the configuration it exists for.
        ledger = SpendLedger(call_budget=0)
        result = plan_call(
            "Call the customer.", ledger=ledger, runner=runner_returning(self.ACCEPTED)
        )
        assert result.accepted

    def test_the_command_is_an_argument_list_not_a_shell_string(self) -> None:
        # Command injection through an interpolated argument is a documented
        # rejection motive, and a goal is attacker-influenced text.
        command = _build_command({"user_input": "hi; rm -rf /"})
        assert isinstance(command, list)
        assert all(isinstance(part, str) for part in command)
        assert not any(";" in part for part in command[:6])


class TestReadingThePlan:
    def test_it_reports_the_goal_call_e_will_actually_run(self) -> None:
        # Planning rewrites the goal, and the rewritten text is authoritative.
        # Reading defences off the draft rather than off this would be
        # checking a document nobody executes.
        ledger = SpendLedger()
        result = plan_call(
            "Call the customer.",
            ledger=ledger,
            runner=runner_returning(TestPlanningPlacesNoCall.ACCEPTED),
        )
        assert result.was_rewritten
        assert "do not leave a message" in result.display_goal

    def test_a_refusal_is_not_read_as_an_acceptance(self) -> None:
        # The content screen refuses in prose, in an undocumented shape. A
        # parser that insisted on one field would report a refused goal as
        # accepted, which is the worst direction to be wrong in.
        refusal = {
            "result": {
                "structuredContent": {
                    "message": "I can't place a call that involves "
                    "confirmation-code readback."
                }
            }
        }
        result = plan_call(
            "Read me the code.", ledger=SpendLedger(), runner=runner_returning(refusal)
        )
        assert not result.accepted
        assert "confirmation-code readback" in result.refusal

    def test_clarifying_questions_are_carried(self) -> None:
        payload = {
            "result": {
                "structuredContent": {
                    "plan_id": "plan_1",
                    "clarifying_questions": ["Which number should I call?"],
                }
            }
        }
        result = plan_call(
            "Call someone.", ledger=SpendLedger(), runner=runner_returning(payload)
        )
        assert result.clarifying_questions == ("Which number should I call?",)

    def test_unreadable_output_is_an_error_not_a_pass(self) -> None:
        with pytest.raises(PlanningError, match="JSON"):
            plan_call(
                "Call.",
                ledger=SpendLedger(),
                runner=runner_returning("not json at all"),
            )

    def test_a_missing_cli_says_what_to_install(self) -> None:
        def explode(command: list[str], timeout: int) -> Completed:
            raise FileNotFoundError("npx")

        with pytest.raises(PlanningError, match="not installed"):
            plan_call("Call.", ledger=SpendLedger(), runner=explode)

    def test_a_timeout_says_retrying_is_safe(self) -> None:
        # Because it is: planning places no call, so a retry cannot double-dial.
        def slow(command: list[str], timeout: int) -> Completed:
            raise subprocess.TimeoutExpired(cmd=command, timeout=timeout)

        with pytest.raises(PlanningError, match="retrying is safe"):
            plan_call("Call.", ledger=SpendLedger(), runner=slow)

    def test_a_failure_message_is_redacted(self) -> None:
        number = "+33" + "612345678"

        def failing(command: list[str], timeout: int) -> Completed:
            return Completed(stderr=f"could not reach {number}", returncode=1)

        with pytest.raises(PlanningError) as caught:
            plan_call("Call.", ledger=SpendLedger(), runner=failing)
        assert number not in str(caught.value)
