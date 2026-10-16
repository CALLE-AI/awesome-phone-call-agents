"""Offline checks: python3 scripts/test_calls_v2.py (no SDK or credentials)."""

import contextlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import extract_answer
import place_verify_call
import poll_result


class CallsV2Tests(unittest.TestCase):
    def test_create_persists_and_replays_the_original_request(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "call.json"
            sent = []

            def create(**kwargs):
                saved = json.loads(state_path.read_text())
                self.assertEqual(saved["request"]["phone"], "+15550101234")
                self.assertEqual(saved["idempotency_key"], kwargs["idempotency_key"])
                sent.append(kwargs)
                if len(sent) == 1:
                    raise TimeoutError("lost response")
                return {"id": "call_example", "status": "queued"}

            client = MagicMock()
            client.__enter__.return_value.calls.create.side_effect = create
            sdk = SimpleNamespace(CalleClient=MagicMock(return_value=client))
            args = ["place_verify_call.py", "--org", "Example Family Medicine", "--phone",
                    "+15550101234", "--claim-accepting-new-patients", "yes", "--live",
                    "--state", str(state_path)]
            with patch.dict(sys.modules, {"calle": sdk}), patch.dict(
                os.environ, {"CALLE_API_KEY": "offline-test"}
            ), patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()):
                with patch.object(place_verify_call, "utc_day", return_value="2026-10-08"):
                    with self.assertRaisesRegex(SystemExit, "MAY ALREADY"):
                        place_verify_call.main()
                with patch.object(place_verify_call, "utc_day", return_value="2026-10-09"):
                    place_verify_call.main()
                with patch.object(sys, "argv", [*args, "--claim-plan", "Changed plan"]):
                    with self.assertRaisesRegex(SystemExit, "different input"):
                        place_verify_call.main()
            self.assertEqual(sent[0], sent[1])
            self.assertNotIn("recipient", sent[0])
            self.assertFalse(sent[0]["result_schema"]["additionalProperties"])
            self.assertEqual(json.loads(state_path.read_text())["id"], "call_example")
            self.assertEqual(stat.S_IMODE(state_path.stat().st_mode), 0o600)

    def test_completed_execution_keeps_polling_pending_results(self):
        for terminal in ("available", "unavailable", "not_applicable"):
            with self.subTest(result_status=terminal), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "result.json"
                output.write_text("old payload")
                output.chmod(0o644)
                client = MagicMock()
                calls = client.__enter__.return_value.calls
                calls.get.side_effect = [
                    {"status": "completed", "result_status": "pending"},
                    {"status": "completed", "result_status": terminal,
                     "call_outcome": "no_answer", "result": None, "transcript": []},
                ]
                sdk = SimpleNamespace(CalleClient=MagicMock(return_value=client))
                args = ["poll_result.py", "--call-id", "call_example", "--out", str(output)]
                with patch.dict(sys.modules, {"calle": sdk}), patch.dict(
                    os.environ, {"CALLE_API_KEY": "offline-test"}
                ), patch.object(sys, "argv", args), patch.object(poll_result.time, "sleep"), \
                        contextlib.redirect_stdout(io.StringIO()):
                    poll_result.main()
                self.assertEqual(calls.get.call_count, 2)
                self.assertEqual(json.loads(output.read_text())["result_status"], terminal)
                self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)

    def test_transcript_is_the_evidence_even_when_result_is_missing(self):
        fixture = Path(__file__).parents[1] / "references" / "sample-call.json"
        payload = json.loads(fixture.read_text())
        payload["result"] = None
        payload["result_status"] = "unavailable"
        turns = extract_answer.turns_from_payload(payload)
        self.assertTrue(extract_answer.organization_confirmed(turns, "Example Family Medicine"))
        answer = extract_answer.extract(
            turns, "accepting_new_patients", extract_answer.CLAIM_PATTERNS["accepting_new_patients"],
            (extract_answer.CLAIM_PATTERNS["accepts_plan"],),
        )
        self.assertEqual(answer["answer"], "yes")
        span = answer["span"]
        self.assertEqual(turns[span["turn"]]["text"], span["text"])
        self.assertEqual(span["text"][span["char_start"]:span["char_end"]], "we are")
        legacy = {"recipients": [{"attempts": [{"transcript_turns": turns}]}]}
        self.assertEqual(extract_answer.turns_from_payload(legacy), turns)
        self.assertEqual(extract_answer.turns_from_payload({"transcript": [], **legacy}), [])

    def test_failed_save_keeps_the_original_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            poll_result.write_payload({"id": "call_original"}, str(path))
            with self.assertRaises(TypeError):
                poll_result.write_payload({"invalid": {1, 2}}, str(path))
            self.assertEqual(json.loads(path.read_text()), {"id": "call_original"})
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_unknown_v2_speakers_cannot_confirm_identity_or_answer(self):
        payload = {"transcript": [
            {"speaker": "bot", "text": "Is this Example Family Medicine?"},
            {"speaker": "unknown", "text": "Yes, this is Example Family Medicine."},
            {"speaker": "bot", "text": "Are you accepting new patients?"},
            {"speaker": "unknown", "text": "Yes, we are accepting new patients."},
        ]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            path.write_text(json.dumps(payload))
            output = io.StringIO()
            with patch.object(sys, "argv", ["extract_answer.py", "--payload", str(path),
                "--qhat", "0.750", "--org", "Example Family Medicine"
            ]), contextlib.redirect_stdout(output):
                extract_answer.main()
            records = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(len(records), 2)
            for record in records:
                self.assertEqual(record["answer"], "unknown")
                self.assertTrue(record["abstain"])
                self.assertEqual(record["gate"], "unknown-speaker")
                self.assertFalse(record["organization_confirmed"])
                self.assertIsNone(record["span"])
            self.assertEqual(json.loads(path.read_text()), payload)

    def test_poll_interval_rejects_nonfinite_and_nonpositive_values(self):
        for value in ("0", "-1", "nan", "inf"):
            with self.subTest(value=value), patch.object(sys, "argv", [
                "poll_result.py", "--call-id", "call_example", "--interval-seconds", value
            ]), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    poll_result.main()

    def test_poll_failure_preserves_the_known_call_id(self):
        client = MagicMock()
        client.__enter__.return_value.calls.get.side_effect = TimeoutError("lost GET response")
        sdk = SimpleNamespace(CalleClient=MagicMock(return_value=client))
        with patch.dict(sys.modules, {"calle": sdk}), patch.dict(
            os.environ, {"CALLE_API_KEY": "offline-test"}
        ), patch.object(sys, "argv", ["poll_result.py", "--call-id", "call_known"]):
            with self.assertRaisesRegex(SystemExit, "Call ID call_known"):
                poll_result.main()
        client.__enter__.return_value.calls.create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
