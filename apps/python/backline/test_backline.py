"""No test in this file places a call, reads a credential, or opens a
network connection — that's the point: the gates in front of a real call
have to be testable without placing one."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import backline


def write_fixture(tmpdir: str, suppliers: list[dict], name: str = "fixture.json") -> Path:
    path = Path(tmpdir) / name
    path.write_text(json.dumps({"item": "widgets", "qty": "10", "unit": "unit", "suppliers": suppliers}))
    return path


class TestMasking(unittest.TestCase):
    def test_mask_phone_hides_the_middle(self):
        masked = backline.mask_phone("+15550100")
        self.assertNotIn("5550100"[2:-2], masked)
        self.assertTrue(masked.startswith("+155"))
        self.assertTrue(masked.endswith("00"))

    def test_full_number_never_appears_in_preview_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = write_fixture(tmp, [{"name": "Acme", "phone_e164": "+15550100"}])
            request = backline.load_request(fixture)
            import io
            import contextlib

            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                backline.cmd_preview(request)
            self.assertNotIn("+15550100", buf.getvalue())


class TestE164Validation(unittest.TestCase):
    def test_valid_e164_is_callable(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = write_fixture(tmp, [{"name": "Acme", "phone_e164": "+15550100"}])
            request = backline.load_request(fixture)
            self.assertTrue(backline._E164_RE.match(request.suppliers[0].phone_e164))

    def test_local_number_is_rejected_not_reformatted(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = write_fixture(tmp, [{"name": "Acme", "phone_e164": "555-0100"}])
            request = backline.load_request(fixture)
            self.assertFalse(backline._E164_RE.match(request.suppliers[0].phone_e164))


class TestConfirmToken(unittest.TestCase):
    def test_token_is_stable_for_the_same_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = write_fixture(tmp, [{"name": "Acme", "phone_e164": "+15550100"}])
            request = backline.load_request(fixture)
            self.assertEqual(backline.confirm_token(request), backline.confirm_token(request))

    def test_token_changes_when_the_supplier_list_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture_a = write_fixture(tmp, [{"name": "Acme", "phone_e164": "+15550100"}], name="a.json")
            fixture_b = write_fixture(tmp, [{"name": "Acme", "phone_e164": "+15550101"}], name="b.json")
            token_a = backline.confirm_token(backline.load_request(fixture_a))
            token_b = backline.confirm_token(backline.load_request(fixture_b))
            self.assertNotEqual(token_a, token_b)


class TestGoalNeverCommitsToAnOrder(unittest.TestCase):
    def test_goal_states_collecting_a_quote_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = write_fixture(tmp, [{"name": "Acme", "phone_e164": "+15550100"}])
            request = backline.load_request(fixture)
            goal = backline.build_goal(request)
            self.assertIn("collecting a quote only", goal)
            self.assertIn("automated assistant", goal)


if __name__ == "__main__":
    unittest.main()
