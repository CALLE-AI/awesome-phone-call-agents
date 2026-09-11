from __future__ import annotations

import copy
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from rolloffscope.cli import main
from rolloffscope.mcp_result import normalize_mcp_result

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class McpImportTest(unittest.TestCase):
    def setUp(self):
        self.request = json.loads((FIXTURES / "request.json").read_text(encoding="utf-8"))
        self.run = {"ok": True, "tool_name": "get_call_run", "result": {
            "isError": False, "structuredContent": {
                "run_id": "synthetic_run_1", "status": "COMPLETED", "result": {
                    "call_ids": ["synthetic_call_1"], "call_id": "synthetic_call_1",
                    "summary": "PRIVATE_SUMMARY_SENTINEL",
                    "transcript": "PRIVATE_TRANSCRIPT_SENTINEL +14155550101",
                    "extracted": {"api_key": "PRIVATE_CREDENTIAL_SENTINEL", "price": 1},
                    "outcome": {"task_completed": True}}}}}

    def test_completed_call_does_not_become_quote_and_private_text_is_discarded(self):
        with patch("socket.socket", side_effect=AssertionError("network attempted")):
            result = normalize_mcp_result(self.request, self.run, "synthetic_run_1")
        self.assertEqual([], result["ranked_for_human_review"])
        self.assertIsNone(result["call_id"])
        self.assertTrue(all(q["normalized_total"] is None for q in result["quotes"]))
        rendered = json.dumps(result)
        for secret in ["PRIVATE_SUMMARY_SENTINEL", "PRIVATE_TRANSCRIPT_SENTINEL", "PRIVATE_CREDENTIAL_SENTINEL", "+14155550101"]:
            self.assertNotIn(secret, rendered)
        self.assertFalse(result["source"]["rest_call_id_verified"])

    def test_wrong_run_pending_and_unsuccessful_tool_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            normalize_mcp_result(self.request, self.run, "another_run")
        pending = copy.deepcopy(self.run)
        pending["result"]["structuredContent"]["status"] = "IN_PROGRESS"
        with self.assertRaisesRegex(ValueError, "not terminal"):
            normalize_mcp_result(self.request, pending, "synthetic_run_1")
        self.run["ok"] = False
        with self.assertRaisesRegex(ValueError, "successful"):
            normalize_mcp_result(self.request, self.run, "synthetic_run_1")

    def test_malformed_metadata_never_echoes_private_input(self):
        self.run["result"]["structuredContent"]["run_id"] = "PRIVATE_BAD_VALUE!"
        with self.assertRaises(ValueError) as raised:
            normalize_mcp_result(self.request, self.run, "synthetic_run_1")
        self.assertNotIn("PRIVATE_BAD_VALUE", str(raised.exception))

    def test_duplicate_or_disagreeing_call_ids_are_rejected(self):
        details = self.run["result"]["structuredContent"]["result"]
        details["call_ids"] *= 2
        with self.assertRaisesRegex(ValueError, "duplicate"):
            normalize_mcp_result(self.request, self.run, "synthetic_run_1")
        details["call_ids"] = ["another_call"]
        with self.assertRaisesRegex(ValueError, "disagree"):
            normalize_mcp_result(self.request, self.run, "synthetic_run_1")

    def test_cli_modes_cannot_turn_import_into_a_call(self):
        with patch("rolloffscope.cli._load", side_effect=[self.request, self.run]), patch("socket.socket", side_effect=AssertionError("network attempted")), redirect_stdout(io.StringIO()) as out:
            code = main(["request.json", "--mcp-result", "saved.json", "--expected-run-id", "synthetic_run_1"])
        self.assertEqual(0, code)
        self.assertEqual([], json.loads(out.getvalue())["ranked_for_human_review"])
        with patch("rolloffscope.cli._load", return_value=self.request), redirect_stderr(io.StringIO()):
            self.assertEqual(2, main(["request.json", "--mcp-result", "saved.json", "--live"]))
            self.assertEqual(2, main(["request.json", "--mcp-result", "saved.json"]))


if __name__ == "__main__":
    unittest.main()
