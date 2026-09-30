#!/usr/bin/env python3
"""Stdlib tests for ledger-collections-call preview.py. No network. No credentials."""

from __future__ import annotations

import ast
import json
import tempfile
import unittest
from pathlib import Path

from preview import calling_is_ye, main, preview_file

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "assets" / "sample-overdue.json"
PREVIEW_SRC = Path(__file__).with_name("preview.py")
FORBIDDEN_IMPORT_ROOTS = frozenset(
    {"urllib", "httpx", "calle", "requests", "http", "aiohttp"}
)


def _sample() -> dict:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


class PreviewImportTest(unittest.TestCase):
    def test_preview_module_does_not_import_http_clients(self) -> None:
        tree = ast.parse(PREVIEW_SRC.read_text(encoding="utf-8"))
        names: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.extend(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module.split(".", 1)[0])
        forbidden = FORBIDDEN_IMPORT_ROOTS.intersection(names)
        self.assertEqual(forbidden, set())


class PreviewDryRunTest(unittest.TestCase):
    def test_sample_overdue_is_not_called_and_masks_phone(self) -> None:
        code, text = preview_file(SAMPLE, live=False, utc_day="2026-09-08")
        self.assertEqual(code, 0)
        self.assertIn("status: not_called", text)
        self.assertIn("blocker: dryRunDefault", text)
        self.assertIn("+*******0100", text)
        self.assertNotIn("+12025550100", text)
        self.assertIn("USD 15.00", text)
        self.assertIn("idempotencyKey:", text)
        self.assertIn("promised / refused", text)
        self.assertIn("does not write a ledger", text)

    def test_ye_region_refused(self) -> None:
        payload = _sample()
        payload["region"] = "YE"
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(payload, handle)
            path = Path(handle.name)
        try:
            code, text = preview_file(path, live=False, utc_day="2026-09-08")
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(code, 0)
        self.assertIn("status: not_called", text)
        self.assertIn("blocker: unsupportedRegion", text)
        self.assertNotIn("Call Alex", text)

    def test_ye_calling_code_prefix_only(self) -> None:
        self.assertTrue(calling_is_ye("+967"))
        self.assertFalse(calling_is_ye("+12025550100"))

    def test_unicode_digits_are_not_e164(self) -> None:
        payload = _sample()
        payload["phoneE164"] = "+1202555014\u0667"
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(payload, handle)
            path = Path(handle.name)
        try:
            code, text = preview_file(path, live=False, utc_day="2026-09-08")
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(code, 0)
        self.assertIn("status: not_called", text)
        self.assertIn("blocker: invalidPhone", text)
        self.assertNotIn("Call Alex", text)

    def test_dnc_refused(self) -> None:
        payload = _sample()
        payload["doNotCall"] = True
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(payload, handle)
            path = Path(handle.name)
        try:
            code, text = preview_file(path, live=False, utc_day="2026-09-08")
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(code, 0)
        self.assertIn("status: not_called", text)
        self.assertIn("blocker: dnc", text)
        self.assertNotIn("Call Alex", text)

    def test_float_amount_refused(self) -> None:
        payload = _sample()
        payload["amountMinor"] = 1500.5
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(payload, handle)
            path = Path(handle.name)
        try:
            code, text = preview_file(path, live=False, utc_day="2026-09-08")
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(code, 0)
        self.assertIn("blocker: invalidAmount", text)
        self.assertNotIn("USD 15.00", text)

    def test_live_flag_rejected(self) -> None:
        from io import StringIO
        from unittest.mock import patch

        with patch("sys.stdout", new=StringIO()):
            exit_code = main(
                ["--request", str(SAMPLE), "--live", "--utc-day", "2026-09-08"]
            )
        self.assertEqual(exit_code, 2)


if __name__ == "__main__":
    unittest.main()
