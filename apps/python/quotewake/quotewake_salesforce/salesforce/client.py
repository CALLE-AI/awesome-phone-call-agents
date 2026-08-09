"""Small read-only Salesforce CLI client.

Authentication remains in the user's Salesforce CLI session. This module only
invokes org display, object describe, and SOQL query commands; it has no write
operation by design.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any


class SalesforceError(RuntimeError):
    """Base error for Salesforce connectivity and response failures."""


class SalesforceSchemaError(SalesforceError):
    """Raised when the target org cannot support this selection milestone."""


class SalesforceQueryError(SalesforceError):
    """Raised when Salesforce rejects a SOQL query."""


class SalesforceResponseError(SalesforceError):
    """Raised when the CLI returns an unexpected JSON response."""


@dataclass(frozen=True)
class OrgInfo:
    alias: str | None
    username: str
    org_id: str


class SalesforceClient:
    """Execute safe Salesforce CLI read commands for one target org."""

    def __init__(self, target_org: str | None = None, executable: str = "sf") -> None:
        self.target_org = target_org
        self.executable = executable

    def _base_command(self, *args: str) -> list[str]:
        command = [self.executable, *args]
        if self.target_org:
            command.extend(["--target-org", self.target_org])
        command.append("--json")
        return command

    def _run_json(self, *args: str) -> dict[str, Any]:
        command = self._base_command(*args)
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except FileNotFoundError as exc:
            raise SalesforceError(
                "Salesforce CLI 'sf' is not installed or is not on PATH."
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise SalesforceError("Salesforce CLI command timed out after 120 seconds.") from exc

        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            detail = completed.stderr.strip() or "no JSON response"
            raise SalesforceResponseError(
                f"Salesforce CLI returned malformed JSON: {detail[:400]}"
            ) from exc

        if completed.returncode != 0 or payload.get("status") not in (0, None):
            result = payload.get("result")
            result_message = result.get("message") if isinstance(result, dict) else None
            message = payload.get("message") or result_message
            if not isinstance(message, str) or not message.strip():
                message = completed.stderr.strip() or "Salesforce CLI command failed"
            command_text = " ".join(command[:-1])
            raise SalesforceQueryError(
                f"Salesforce CLI command failed ({command_text}): {message.strip()[:600]}"
            )
        return payload

    def org_info(self) -> OrgInfo:
        """Verify authentication and return non-secret org identity fields."""

        payload = self._run_json("org", "display")
        result = payload.get("result")
        if not isinstance(result, dict):
            raise SalesforceResponseError("sf org display returned no org details.")
        if result.get("connectedStatus") not in {None, "Connected"}:
            raise SalesforceError(
                f"Salesforce target org is not connected: {result.get('connectedStatus')}"
            )
        username = result.get("username")
        org_id = result.get("id")
        if not isinstance(username, str) or not isinstance(org_id, str):
            raise SalesforceResponseError(
                "sf org display did not return a username and org ID."
            )
        alias = result.get("alias")
        return OrgInfo(alias if isinstance(alias, str) else None, username, org_id)

    def describe(self, object_name: str) -> dict[str, Any]:
        """Describe a Salesforce object through the CLI."""

        payload = self._run_json("sobject", "describe", "--sobject", object_name)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise SalesforceResponseError(
                f"sf sobject describe {object_name} returned no schema."
            )
        return result

    def query(self, soql: str) -> list[dict[str, Any]]:
        """Run SOQL and return records, never silently converting errors to []."""

        payload = self._run_json("data", "query", "--query", soql)
        result = payload.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("records"), list):
            raise SalesforceResponseError("SOQL response did not contain records.")
        records = result["records"]
        if not all(isinstance(record, dict) for record in records):
            raise SalesforceResponseError("SOQL response contained a malformed record.")
        return records
