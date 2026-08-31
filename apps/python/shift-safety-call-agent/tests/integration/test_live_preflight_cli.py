"""CLI regressions for the no-call live readiness report."""

import unittest
from io import StringIO
from unittest.mock import Mock

from shift_safety_call_agent.adapters.calle_live import LiveCallPreflight
from shift_safety_call_agent.cli import build_parser, main
from tests.fixtures.calle_sdk_contract import network_blocked


class LivePreflightCliTests(unittest.TestCase):
    def test_preflight_displays_only_non_sensitive_states_and_no_call_notice(self) -> None:
        sensitive_recipient = "+" + ("9" * 11)
        sensitive_key = "-".join(("synthetic", "runtime", "credential"))
        builder = Mock(
            return_value=LiveCallPreflight(
                provider="live",
                api_key_set=True,
                recipient_set=True,
                recipient_format_valid=True,
                live_call_enabled=True,
                human_confirmation_matches=True,
                client_factory_ready=True,
            )
        )
        output = StringIO()
        with network_blocked():
            exit_code = main(
                ["live-preflight"],
                output=output,
                environment={"hidden-key": sensitive_key, "hidden-recipient": sensitive_recipient},
                live_preflight_builder=builder,
            )
        self.assertEqual(exit_code, 0)
        rendered = output.getvalue()
        self.assertIn("Provider selected: live", rendered)
        self.assertIn("CALLE_API_KEY: set", rendered)
        self.assertIn("Recipient: set", rendered)
        self.assertIn("Recipient format valid: true", rendered)
        self.assertIn("Live-call enabled: true", rendered)
        self.assertIn("Human confirmation matches: true", rendered)
        self.assertIn("CALL-E client factory ready: true", rendered)
        self.assertIn("Real call WILL NOT be placed", rendered)
        self.assertNotIn(sensitive_key, rendered)
        self.assertNotIn(sensitive_recipient, rendered)

    def test_preflight_is_not_a_real_call_command(self) -> None:
        parser = build_parser()
        action = next(item for item in parser._actions if item.dest == "command")
        commands = set(action.choices)
        self.assertIn("live-preflight", commands)
        self.assertTrue(
            commands.isdisjoint(
                {"run-calle", "call", "dial", "start-call", "send-call", "place-call"}
            )
        )


if __name__ == "__main__":
    unittest.main()
