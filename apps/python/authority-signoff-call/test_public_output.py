"""Offline regressions: fake provider only; no live credentials or calls."""
import asyncio
from contextlib import redirect_stderr, redirect_stdout
import io
import logging
import os
import sys
import types
import unittest
from unittest.mock import patch

import cli
import signoff_call as signoff


PHONE = "+12025550123"
GROUPED_PHONE = "+1 (202) 555-0124"
LOCAL_PHONE = "202-555-0125"
KEY = "synthetic-credential-not-valid"
ENV = {"CALLE_API_KEY": KEY, "CALLE_SIGNOFF_PHONE": PHONE, "CALLE_SIGNOFF_ENABLED": "true"}
ARGS = dict(
    authority_name="Synthetic operator " + PHONE,
    context="Contact " + GROUPED_PHONE + " or " + LOCAL_PHONE,
    decision_summary="Review synthetic record " + KEY,
    authorizing_tier="Demo only",
    idempotency_key="synthetic-intent-" + PHONE,
)


class PublicOutputTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.logs = io.StringIO()
        self.handler = logging.StreamHandler(self.logs)
        self.original_level = signoff.logger.level
        signoff.logger.addHandler(self.handler)
        signoff.logger.setLevel(logging.INFO)

    def tearDown(self):
        signoff.logger.removeHandler(self.handler)
        signoff.logger.setLevel(self.original_level)
        self.environment.stop()

    def assert_masked(self, text):
        for value in (PHONE, GROUPED_PHONE, LOCAL_PHONE, KEY):
            self.assertNotIn(value, text)

    def run_cli(self, mode):
        argv = ["cli.py", mode, "--authority", ARGS["authority_name"],
                "--context", ARGS["context"], "--decision", ARGS["decision_summary"],
                "--tier", "Demo only", "--idempotency-key", ARGS["idempotency_key"]]
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", argv), redirect_stdout(output), redirect_stderr(errors):
            code = cli.main()
        return code, output.getvalue() + errors.getvalue()

    def test_preview_masks_embedded_contacts_and_key(self):
        with patch.dict(os.environ, ENV):
            code, output = self.run_cli("preview")
        self.assertEqual(code, 0)
        self.assertIn("masked preview", output)
        self.assert_masked(output)

    def test_disabled_request_masks_cli_and_logs(self):
        with patch.dict(os.environ, {**ENV, "CALLE_SIGNOFF_ENABLED": "false"}):
            code, output = self.run_cli("request")
            result = asyncio.run(signoff.request_signoff_call(**ARGS))
        self.assertEqual(code, 20)
        self.assertTrue(result["dry_run"])
        self.assertIsNone(result["raw"])
        self.assert_masked(output + self.logs.getvalue() + result["task"])

    def test_private_live_payload_is_unchanged(self):
        received = []
        raw = {"structured_result": {"decision": "confirm"}, "private_phone": PHONE}
        class FakeCalls:
            def create_and_wait(self, **kwargs):
                received.append(kwargs)
                return raw
        fake = types.ModuleType("calle")
        fake.CalleClient = lambda **kwargs: types.SimpleNamespace(calls=FakeCalls())
        with patch.dict(os.environ, ENV), patch.dict(sys.modules, {"calle": fake}):
            result = asyncio.run(signoff.request_signoff_call(**ARGS))
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["recipient"], {"phone": PHONE})
        self.assertEqual(received[0]["idempotency_key"], ARGS["idempotency_key"])
        self.assertIn(GROUPED_PHONE, received[0]["task"])
        self.assertIn(KEY, received[0]["task"])
        self.assertIs(result["raw"], raw)  # private integration field, never displayed
        self.assertEqual(result["decision"], "confirm")
        self.assert_masked(self.logs.getvalue() + result["task"])

    def test_provider_exception_is_coarse_and_not_retried(self):
        attempts = []
        class FakeCalls:
            def create_and_wait(self, **kwargs):
                attempts.append(kwargs)
                raise RuntimeError("sensitive provider payload " + PHONE + " " + KEY)
        fake = types.ModuleType("calle")
        fake.CalleClient = lambda **kwargs: types.SimpleNamespace(calls=FakeCalls())
        with patch.dict(os.environ, ENV), patch.dict(sys.modules, {"calle": fake}):
            code, output = self.run_cli("request")
        self.assertEqual(code, 20)
        self.assertEqual(len(attempts), 1)
        combined = output + self.logs.getvalue()
        self.assertIn("outcome unclear", combined)
        self.assertNotIn("Traceback", combined)
        self.assertNotIn("sensitive provider payload", combined)
        self.assert_masked(combined)

    def test_number_guard_still_rejects_non_ascii_and_malformed(self):
        for invalid in ("2025550123", "+١٢٠٢٥٥٥٠١٢٣"):
            with self.assertRaises(ValueError) as error:
                signoff.validate_e164(invalid)
            self.assertNotIn(invalid, str(error.exception))
        self.assertEqual(signoff.validate_e164(PHONE), PHONE)


if __name__ == "__main__":
    unittest.main()
