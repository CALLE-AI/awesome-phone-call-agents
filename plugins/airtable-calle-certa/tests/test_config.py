"""Tests for credential storage.

The panel writes an API key to disk so an operator never has to export one in
a shell. That is only acceptable if the file is owner-only and the value never
leaves the process in readable form.
"""

import os
import stat
import tempfile
import unittest
from pathlib import Path

from certa import config as cfg


class Loading(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.env = Path(self._tmp.name) / ".env"

    def tearDown(self):
        self._tmp.cleanup()
        for key in cfg.ALL_KEYS:
            os.environ.pop(key, None)

    def test_missing_file_is_an_empty_config(self):
        config = cfg.load(self.env)
        self.assertFalse(config.can_read_table)
        self.assertFalse(config.can_place_calls)

    def test_environment_beats_the_file(self):
        cfg.save(cfg.Config(airtable_token="from_file", airtable_base_id="appF"), self.env)
        os.environ["AIRTABLE_TOKEN"] = "from_env"
        self.assertEqual(cfg.load(self.env).airtable_token, "from_env")

    def test_placeholders_count_as_unset(self):
        """.env.example ships placeholders; using one would produce a baffling 401."""
        self.env.write_text(
            "AIRTABLE_TOKEN=pat_example_replace_me\nAIRTABLE_BASE_ID=appExampleReplaceMe\n"
        )
        self.assertFalse(cfg.load(self.env).can_read_table)

    def test_comments_and_quotes_are_handled(self):
        self.env.write_text('# a comment\nAIRTABLE_TOKEN="pat_quoted"\n\nAIRTABLE_BASE_ID=appQ\n')
        config = cfg.load(self.env)
        self.assertEqual(config.airtable_token, "pat_quoted")
        self.assertTrue(config.can_read_table)

    def test_missing_lists_what_is_still_needed(self):
        config = cfg.Config(airtable_token="pat", airtable_base_id="app")
        self.assertIn("CALLE_API_KEY", config.missing())
        self.assertIn("CERTA_REQUESTER_NAME", config.missing())
        self.assertNotIn("AIRTABLE_TOKEN", config.missing())

    def test_calls_need_more_than_reading(self):
        config = cfg.Config(airtable_token="pat", airtable_base_id="app")
        self.assertTrue(config.can_read_table)
        self.assertFalse(config.can_place_calls)


class Redaction(unittest.TestCase):
    def test_secrets_never_leave_in_readable_form(self):
        config = cfg.Config(
            airtable_token="pat_this_is_secret_abcd",
            calle_api_key="iams_live_secret_wxyz",
            airtable_base_id="appVisible",
            requester_name="Example Lending",
        )
        rendered = str(config.redacted())
        self.assertNotIn("pat_this_is_secret_abcd", rendered)
        self.assertNotIn("iams_live_secret_wxyz", rendered)

    def test_last_four_are_shown_so_keys_can_be_told_apart(self):
        payload = cfg.Config(airtable_token="pat_xxxxxxxx1234").redacted()
        self.assertEqual(payload["airtable_token"], "set (…1234)")

    def test_unset_secret_reads_as_empty(self):
        self.assertEqual(cfg.Config().redacted()["calle_api_key"], "")

    def test_non_secret_fields_are_returned_plainly(self):
        payload = cfg.Config(airtable_base_id="appABC", requester_name="Acme").redacted()
        self.assertEqual(payload["airtable_base_id"], "appABC")
        self.assertEqual(payload["requester_name"], "Acme")


class FilePermissions(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.env = Path(self._tmp.name) / ".env"

    def tearDown(self):
        self._tmp.cleanup()

    def test_saved_file_is_owner_only(self):
        cfg.save(cfg.Config(airtable_token="pat_x", airtable_base_id="appX"), self.env)
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)

    def test_an_existing_loose_file_is_tightened_on_save(self):
        self.env.write_text("AIRTABLE_TOKEN=old\n")
        os.chmod(self.env, 0o644)
        cfg.save(cfg.Config(airtable_token="pat_new", airtable_base_id="appX"), self.env)
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)

    def test_loose_permissions_are_reported(self):
        self.env.write_text("AIRTABLE_TOKEN=x\n")
        os.chmod(self.env, 0o644)
        warning = cfg.permission_warning(self.env)
        self.assertIn("readable beyond its owner", warning)
        self.assertIn("chmod 600", warning)

    def test_tight_permissions_report_nothing(self):
        cfg.save(cfg.Config(airtable_token="pat_x", airtable_base_id="appX"), self.env)
        self.assertEqual(cfg.permission_warning(self.env), "")

    def test_unrelated_keys_survive_a_save(self):
        self.env.write_text("SOMETHING_ELSE=keep_me\n")
        cfg.save(cfg.Config(airtable_token="pat_x", airtable_base_id="appX"), self.env)
        self.assertIn("SOMETHING_ELSE=keep_me", self.env.read_text())

    def test_empty_values_are_not_written(self):
        cfg.save(cfg.Config(airtable_token="pat_x", airtable_base_id="appX"), self.env)
        self.assertNotIn("CALLE_API_KEY=", self.env.read_text())


if __name__ == "__main__":
    unittest.main()


class BaseIdValidation(unittest.TestCase):
    """Base, workspace and table ids differ only by a three-letter prefix, and
    the panel asks for two of them, so the wrong one must be caught at entry
    rather than as a 404 from a metadata endpoint much later."""

    def test_workspace_id_is_rejected_by_name(self):
        with self.assertRaises(cfg.ConfigError) as ctx:
            cfg.check_base_id("wspazut5mnbmwPrOT")
        self.assertIn("workspace id", str(ctx.exception))
        self.assertIn("Create the base", str(ctx.exception))

    def test_table_and_token_ids_are_named_too(self):
        self.assertIn("table id", str(self._err("tblAbc123")))
        self.assertIn("token", str(self._err("pat_abc123")))

    def _err(self, value):
        try:
            cfg.check_base_id(value)
        except cfg.ConfigError as exc:
            return exc
        self.fail(f"{value} should have been rejected")

    def test_a_real_base_id_passes(self):
        self.assertEqual(cfg.check_base_id("appAbc123"), "appAbc123")

    def test_empty_is_allowed_because_the_base_may_not_exist_yet(self):
        self.assertEqual(cfg.check_base_id(""), "")

    def test_save_refuses_to_store_a_workspace_id(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            with self.assertRaises(cfg.ConfigError):
                cfg.save(cfg.Config(airtable_token="pat_x", airtable_base_id="wspBad"), env)
            self.assertFalse(env.exists(), "nothing may be written on a rejected save")


class Clearing(unittest.TestCase):
    def test_clear_removes_every_credential(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            cfg.save(cfg.Config(airtable_token="pat_x", airtable_base_id="appX",
                                calle_api_key="iams_x", requester_name="Acme"), env)
            cfg.clear(env)
            loaded = cfg.load(env)
            self.assertFalse(loaded.airtable_token)
            self.assertFalse(loaded.calle_api_key)
            self.assertFalse(loaded.can_read_table)

    def test_clear_keeps_unrelated_keys(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            env.write_text("SOMETHING_ELSE=keep\nAIRTABLE_TOKEN=pat_x\n")
            cfg.clear(env)
            self.assertIn("SOMETHING_ELSE=keep", env.read_text())
            self.assertNotIn("AIRTABLE_TOKEN", env.read_text())
