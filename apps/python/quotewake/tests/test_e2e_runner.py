"""Local fake-CLI tests for the opt-in Salesforce E2E runner."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from quotewake_salesforce.config import load_follow_up_policies, load_regional_settings

RUNNER_PATH = Path(__file__).parents[1] / "test_e2e_salesforce.py"
_SPEC = importlib.util.spec_from_file_location("quotewake_e2e_runner", RUNNER_PATH)
assert _SPEC is not None and _SPEC.loader is not None
runner = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(runner)


class FakeSalesforce:
    def __init__(self) -> None:
        self.quotes = {
            key: {
                "Id": f"0Q00000000000{index}",
                "Name": name,
                "OpportunityId": f"00600000000000{index}",
                "Status": "Presented",
                "ExpirationDate": "2026-09-09",
                "GrandTotal": str(index * 1000),
                "QuoteWake_Enabled__c": True,
                "Follow_Up_Status__c": None,
                "Next_Follow_Up_At__c": None,
                "Attempt_Count__c": 0,
                "Last_Follow_Up_At__c": None,
                "Last_Follow_Up_Result__c": None,
            }
            for index, (key, name) in enumerate(runner.DEMO_NAMES.items(), start=1)
        }
        self.contacts = {
            quote["OpportunityId"]: {
                "ContactId": f"00300000000000{index}",
                "Contact": {
                    "Name": f"Demo Contact {index}",
                    "Phone": f"+1415555010{index}",
                    "MobilePhone": None,
                },
                "IsPrimary": True,
            }
            for index, quote in enumerate(self.quotes.values(), start=1)
        }
        self.tasks: dict[str, dict[str, object]] = {}
        self.task_number = 0
        self.fail_outcome: str | None = None
        self.bad_timestamp = False
        self.crosses_midnight_utc = False

    def _json(self, value: object) -> object:
        return type("Completed", (), {
            "returncode": 0,
            "stdout": json.dumps({"status": 0, "result": value}),
            "stderr": "",
        })()

    def run(self, command, **kwargs):
        del kwargs
        command = list(command)
        if "-m" in command and "quotewake_salesforce" in command:
            quote_id = command[command.index("--quote-id") + 1]
            outcome = command[command.index("--simulation-outcome") + 1]
            quote = next(item for item in self.quotes.values() if item["Id"] == quote_id)
            if outcome == self.fail_outcome:
                return type("Completed", (), {
                    "returncode": 1,
                    "stdout": "",
                    "stderr": "phone +14155550102 access_token=top-secret",
                })()
            labels = {
                "interested": ("Interested", "Completed"),
                "call_back_later": ("Call Back Later", "Retry"),
                "invalid_number": ("Invalid Number", "Stopped"),
            }
            result, status = labels[outcome]
            simulation_at = (
                "2026-08-10T23:30:00+00:00"
                if self.crosses_midnight_utc
                else "2026-08-10T12:00:00+00:00"
            )
            next_at = (
                command[command.index("--next-follow-up-at") + 1]
                if "--next-follow-up-at" in command
                else None
            )
            quote.update(
                {
                    "Attempt_Count__c": 1,
                    "Follow_Up_Status__c": status,
                    "Next_Follow_Up_At__c": next_at,
                    "Last_Follow_Up_At__c": simulation_at.replace("+00:00", "Z"),
                    "Last_Follow_Up_Result__c": result,
                }
            )
            contact = self.contacts[quote["OpportunityId"]]
            self.task_number += 1
            task_id = f"00T0000000000{self.task_number}"
            simulation_id = f"sim-{self.task_number:016d}"
            self.tasks[task_id] = {
                "Id": task_id,
                "WhatId": quote_id,
                "WhoId": contact["ContactId"],
                "Status": "Completed",
                "Priority": "Normal",
                "Subject": f"[SIMULATED] QuoteWake follow-up: {result}",
                "ActivityDate": "2026-08-11" if self.crosses_midnight_utc else "2026-08-10",
                "Description": f"Simulation ID: {simulation_id}\nOutcome: {result}",
            }
            return type("Completed", (), {
                "returncode": 0,
                "stdout": (
                    f"[OK] Simulated outcome: {result}\n"
                    f"[OK] Salesforce Quote updated and Task created: {task_id}\n"
                ),
                "stderr": "",
            })()

        if command[1:4] == ["data", "update", "record"]:
            quote_id = command[command.index("--record-id") + 1]
            quote = next(item for item in self.quotes.values() if item["Id"] == quote_id)
            quote.update(
                {
                    "QuoteWake_Enabled__c": True,
                    "Follow_Up_Status__c": None,
                    "Next_Follow_Up_At__c": None,
                    "Attempt_Count__c": 0,
                    "Last_Follow_Up_At__c": None,
                    "Last_Follow_Up_Result__c": None,
                }
            )
            return self._json({})

        query = command[command.index("--query") + 1]
        if "FROM Organization" in query:
            return self._json({"records": [{"IsSandbox": False, "OrganizationType": "Developer Edition"}]})
        if "FROM OpportunityContactRole" in query:
            opportunity_id = query.split("OpportunityId = '", 1)[1].split("'", 1)[0]
            return self._json({"records": [self.contacts[opportunity_id]]})
        if "FROM Task" in query:
            task_id = query.split("Id = '", 1)[1].split("'", 1)[0]
            return self._json({"records": [self.tasks[task_id]]})
        if "FROM Quote" in query and "WHERE Id = '" in query:
            quote_id = query.split("WHERE Id = '", 1)[1].split("'", 1)[0]
            quote = next(item for item in self.quotes.values() if item["Id"] == quote_id)
            return self._json({"records": [quote]})
        if "FROM Quote" in query and "WHERE Name = '" in query:
            quote_name = query.split("WHERE Name = '", 1)[1].split("'", 1)[0]
            quote = next(item for item in self.quotes.values() if item["Name"] == quote_name)
            return self._json({"records": [quote]})
        raise AssertionError(f"Unhandled fake Salesforce command: {command}")


class TestE2ERunner(unittest.TestCase):
    def test_temporary_config_contains_all_required_follow_up_policies(self) -> None:
        with runner._temporary_config() as config:
            config_path = Path(config.name)
            document = tomllib.loads(config_path.read_text(encoding="utf-8"))
            self.assertIn("retry", document["follow_up"])
            self.assertIn("cooldown", document["follow_up"])
            self.assertIn("calling_hours", document["follow_up"])
            policies = load_follow_up_policies(
                config_path,
                load_regional_settings(config_path),
            )

        self.assertEqual(policies.retry.max_attempts, 3)
        self.assertFalse(policies.cooldown.enabled)
        self.assertFalse(policies.calling_hours.enabled)

    def test_timestamp_parser_accepts_salesforce_and_iso_spellings(self) -> None:
        expected = runner._parse_timestamp(
            "2026-08-10T12:34:56.123Z", field="expected"
        )
        for value in (
            "2026-08-10T12:34:56.123+00:00",
            "2026-08-10T12:34:56.123+0000",
            "2026-08-10T12:34:56.123000+0000",
        ):
            with self.subTest(value=value):
                self.assertEqual(runner._parse_timestamp(value, field="actual"), expected)

    def test_missing_simulation_task_id_is_rejected_and_recorded(self) -> None:
        fake = FakeSalesforce()
        original_run = fake.run

        def missing_task_output(command, **kwargs):
            result = original_run(command, **kwargs)
            if "quotewake_salesforce" in command and "-m" in command:
                result.stdout = "[OK] Simulated outcome: Interested\n"
            return result

        output = Path(tempfile.mkdtemp()) / "failed.json"
        with patch.object(runner.subprocess, "run", side_effect=missing_task_output):
            with self.assertRaises(runner.E2EError):
                runner.run_e2e("demo", confirm_demo_write=True, output=output)
        summary = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["failed_scenario"], "kitchen")
        self.assertEqual(summary["scenarios"], [])

    def test_task_activity_date_uses_business_timezone_across_utc_midnight(self) -> None:
        fake = FakeSalesforce()
        fake.crosses_midnight_utc = True
        output = Path(tempfile.mkdtemp()) / "midnight.json"
        with patch.object(runner.subprocess, "run", side_effect=fake.run):
            self.assertEqual(runner.run_e2e("demo", confirm_demo_write=True, output=output), 0)

        summary = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(summary["status"], "completed")
        self.assertEqual(len(summary["scenarios"]), 3)

    def test_second_scenario_failure_persists_partial_redacted_summary(self) -> None:
        fake = FakeSalesforce()
        fake.fail_outcome = "call_back_later"
        output = Path(tempfile.mkdtemp()) / "partial.json"
        with patch.object(runner.subprocess, "run", side_effect=fake.run):
            with self.assertRaises(runner.E2EError):
                runner.run_e2e("demo", confirm_demo_write=True, output=output)
        summary = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["failed_scenario"], "ev")
        self.assertEqual([item["scenario"] for item in summary["scenarios"]], ["kitchen"])
        self.assertNotIn("+14155550102", json.dumps(summary))
        self.assertNotIn("top-secret", json.dumps(summary))

    def test_permission_set_allows_task_read_create_edit_without_delete(self) -> None:
        metadata = Path(__file__).parents[1] / "salesforce/force-app/main/default/permissionsets/QuoteWake_User.permissionset-meta.xml"
        root = ET.parse(metadata).getroot()
        namespace = "{http://soap.sforce.com/2006/04/metadata}"
        task_permissions = [
            item for item in root.findall(f"{namespace}objectPermissions")
            if item.findtext(f"{namespace}object") == "Task"
        ]
        self.assertEqual(len(task_permissions), 1)
        permissions = task_permissions[0]
        self.assertEqual(permissions.findtext(f"{namespace}allowRead"), "true")
        self.assertEqual(permissions.findtext(f"{namespace}allowCreate"), "true")
        self.assertEqual(permissions.findtext(f"{namespace}allowEdit"), "true")
        self.assertEqual(permissions.findtext(f"{namespace}allowDelete"), "false")

    def test_runner_requires_explicit_confirmation(self) -> None:
        with self.assertRaises(runner.E2EError):
            runner.run_e2e("demo", confirm_demo_write=False)

    def test_runner_executes_matrix_and_writes_redacted_summary(self) -> None:
        fake = FakeSalesforce()
        output = Path(tempfile.mkdtemp()) / "quotewake_salesforce_e2e.json"
        with patch.object(runner.subprocess, "run", side_effect=fake.run):
            self.assertEqual(runner.run_e2e("demo", confirm_demo_write=True, output=output), 0)

        summary = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual([item["scenario"] for item in summary["scenarios"]], ["kitchen", "ev", "office"])
        self.assertEqual([item["follow_up_status"] for item in summary["scenarios"]], ["Completed", "Retry", "Stopped"])
        self.assertTrue(all(item["simulated"] for item in summary["scenarios"]))
        self.assertTrue(all(item["simulation_at"] for item in summary["scenarios"]))
        self.assertEqual(len(fake.tasks), 3)
        self.assertTrue(all(quote["Attempt_Count__c"] == 1 for quote in fake.quotes.values()))
        self.assertNotIn("+1415555010", output.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
