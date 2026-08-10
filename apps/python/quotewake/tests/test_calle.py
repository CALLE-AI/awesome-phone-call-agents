"""Tests for the planning-only official CALL-E CLI adapter."""

from __future__ import annotations

import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest

from quotewake_salesforce.calle.client import CallEPlanningClient, CallEPlanningError
from quotewake_salesforce.domain.models import CallPlanDecision, CallPlanRequest


def request() -> CallPlanRequest:
    return CallPlanRequest(
        quote_id="0Q0000000000001",
        opportunity_id="006000000000001",
        contact_id="003000000000001",
        phone="+14155550101",
        goal="Plan a quote follow-up without starting a call.",
        user_input="Plan, but do not start, this quote follow-up.",
        language="Spanish",
        region="ES",
    )


class TestCallEPlanningClient(unittest.TestCase):
    def _fake_cli(
        self, *, usable: bool = True, ready_to_run: bool = True
    ) -> tuple[Path, Path]:
        temp_dir = Path(tempfile.mkdtemp(prefix="quotewake-calle-test-"))
        script = temp_dir / "fake_calle.py"
        log = temp_dir / "commands.log"
        script.write_text(
            f"""#!{sys.executable}
import json
from pathlib import Path
import sys

log = Path({str(log)!r})
with log.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(sys.argv[1:]) + "\\n")

if sys.argv[1:] == ["--help"]:
    print("fake CALL-E help")
elif sys.argv[1:3] == ["auth", "status"]:
    print(json.dumps({{"usable": {usable!r}}}))
elif sys.argv[1:3] == ["mcp", "tools"]:
    print(json.dumps({{"ok": True, "result": {{"tools": [{{"name": "plan_call"}}]}}}}))
elif sys.argv[1:4] == ["mcp", "call", "plan_call"]:
    args = json.loads(sys.argv[sys.argv.index("--args-json") + 1])
    assert args["language"] == "Spanish"
    assert args["region"] == "ES"
    print(json.dumps({{
        "ok": True,
        "result": {{
            "structuredContent": {{
                "plan_id": "fake-plan-1",
                "ready_to_run": {ready_to_run!r},
                "confirm_summary": "Review this plan for +14155550101.",
                "confirm_token": "must-not-escape",
                "clarifying_questions": []
            }}
        }}
    }}))
else:
    raise SystemExit(9)
""",
            encoding="utf-8",
        )
        script.chmod(script.stat().st_mode | stat.S_IXUSR)
        return script, log

    def test_plans_without_exposing_confirmation_token_or_running_call(self) -> None:
        script, log = self._fake_cli()
        client = CallEPlanningClient(command=(str(script),))

        client.verify_ready()
        result = client.plan(request())

        self.assertEqual(result.decision, CallPlanDecision.PLAN_READY)
        self.assertEqual(result.plan_id, "fake-plan-1")
        self.assertEqual(result.confirm_summary, "Review this plan for [phone-redacted].")
        self.assertNotIn("must-not-escape", repr(result))
        commands = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(commands[0], ["--help"])
        self.assertEqual(commands[1][:2], ["auth", "status"])
        self.assertEqual(commands[2][:2], ["mcp", "tools"])
        self.assertEqual(commands[3][:3], ["mcp", "call", "plan_call"])
        self.assertNotIn("run_call", log.read_text())

    def test_unusable_auth_fails_before_planning(self) -> None:
        script, log = self._fake_cli(usable=False)
        client = CallEPlanningClient(command=(str(script),))

        with self.assertRaisesRegex(CallEPlanningError, "authentication is not usable"):
            client.verify_ready()

        self.assertNotIn("plan_call", log.read_text())

    def test_not_ready_plan_is_reported_without_execution(self) -> None:
        script, log = self._fake_cli(ready_to_run=False)
        client = CallEPlanningClient(command=(str(script),))

        client.verify_ready()
        result = client.plan(request())

        self.assertEqual(result.decision, CallPlanDecision.PLAN_INCOMPLETE)
        self.assertFalse(result.ready_to_run)
        self.assertNotIn("run_call", log.read_text())


if __name__ == "__main__":
    unittest.main()
