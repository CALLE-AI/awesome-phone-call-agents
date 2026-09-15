"""Presentation copies are masked; private evidence and workflow IDs survive."""

from __future__ import annotations

import argparse
import io
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from reachable import cli
from reachable.phone import mask_display
from reachable.sanitize import clean_for_csv, clean_quote, clean_transcript_turns


class DisplayMaskingTests(unittest.TestCase):
    def test_common_phone_formats(self):
        for number in (
            "+447700900101", "+44 7700 900101", "07700 900101", "(01632) 960101"
        ):
            with self.subTest(number=number):
                self.assertEqual(mask_display(f"Call {number}."), "Call …101.")

    def test_nested_presentation_copy_preserves_original(self):
        source = {"quotes": ["Try +447700900101"], "count": 2, "ok": True}
        shown = mask_display(source)
        self.assertEqual(shown["quotes"], ["Try …101"])
        self.assertEqual(source["quotes"], ["Try +447700900101"])
        self.assertEqual((shown["count"], shown["ok"]), (2, True))

    def test_workflow_ids_and_dates_unchanged(self):
        for value in (
            "PF-P-1041-2026-09-11", "CC-2026-autumn-C-2088",
            "2026-09-14 18:02:30", "2026-09-14T18:02:30"
        ):
            self.assertEqual(mask_display(value), value)

    def test_private_ingestion_is_not_masked(self):
        quote = "The number is +447700900101"
        turns = [{"speaker": "user", "text": quote}]
        self.assertEqual(clean_quote(quote), quote)
        self.assertEqual(clean_transcript_turns(turns)[0]["text"], quote)
        self.assertNotIn("+447700900101", clean_for_csv(quote))
        self.assertTrue(clean_for_csv("=SUM(1,2)").startswith("'="))

    def test_cli_output_and_errors_are_masked(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            cli.print({"quote": ["Call +447700900101"]})
            self.assertEqual(cli._fail("Call +447700900101"), 2)
        self.assertNotIn("+447700900101", stdout.getvalue() + stderr.getvalue())
        self.assertIn("…101", stdout.getvalue())
        self.assertIn("…101", stderr.getvalue())

    def test_remote_host_refused_before_server_import(self):
        for host in ("0.0.0.0", "::", "192.0.2.1", "example.com"):
            with redirect_stderr(io.StringIO()), patch.dict(
                "sys.modules", {"uvicorn": None}
            ):
                self.assertEqual(cli.cmd_serve(argparse.Namespace(host=host, port=8000)), 2)


if __name__ == "__main__":
    unittest.main()
