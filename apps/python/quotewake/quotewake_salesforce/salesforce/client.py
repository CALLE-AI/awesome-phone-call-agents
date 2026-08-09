"""Small Salesforce CLI client for read and explicitly-scoped demo writes.

Authentication remains in the user's Salesforce CLI session. Normal selection
operations are read-only. The simulator uses the separate ``composite_write``
method for one atomic Quote + Task write and never exposes general CRUD.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone, tzinfo
from decimal import Decimal
from typing import Any

from quotewake_salesforce.domain.models import CallResult, ContactTarget, QuoteCandidate


class SalesforceError(RuntimeError):
    """Base error for Salesforce connectivity and response failures."""


class SalesforceSchemaError(SalesforceError):
    """Raised when the target org cannot support this selection milestone."""


class SalesforceQueryError(SalesforceError):
    """Raised when Salesforce rejects a SOQL query."""


class SalesforceResponseError(SalesforceError):
    """Raised when the CLI returns an unexpected JSON response."""


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON number {value}")


@dataclass(frozen=True)
class OrgInfo:
    alias: str | None
    username: str
    org_id: str
    api_version: str | None = None
    instance_url: str | None = None


@dataclass(frozen=True)
class CompositeWriteResult:
    """Identifiers returned by a successful QuoteWake composite write."""

    quote_id: str
    task_id: str


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
            payload = json.loads(
                completed.stdout,
                parse_int=Decimal,
                parse_float=Decimal,
                parse_constant=_reject_json_constant,
            )
        except (json.JSONDecodeError, ValueError) as exc:
            detail = completed.stderr.strip() or "no JSON response"
            raise SalesforceResponseError(
                f"Salesforce CLI returned malformed JSON: {detail[:400]}"
            ) from exc

        if not isinstance(payload, dict):
            raise SalesforceResponseError("Salesforce CLI returned a JSON value instead of an object.")
        if completed.returncode != 0 or payload.get("status") not in (0, None, Decimal(0)):
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
        api_version = result.get("apiVersion")
        if api_version is None:
            api_version = result.get("api_version")
        return OrgInfo(
            alias if isinstance(alias, str) else None,
            username,
            org_id,
            str(api_version) if api_version is not None else None,
            result.get("instanceUrl") if isinstance(result.get("instanceUrl"), str) else None,
        )

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

    def _run_api_json(self, command: list[str]) -> dict[str, Any]:
        """Run ``sf api request rest`` and parse its raw JSON response."""

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
            raise SalesforceError("Salesforce REST request timed out after 120 seconds.") from exc
        try:
            payload = json.loads(
                completed.stdout,
                parse_int=Decimal,
                parse_float=Decimal,
                parse_constant=_reject_json_constant,
            )
        except (json.JSONDecodeError, ValueError) as exc:
            detail = completed.stderr.strip() or "no JSON response"
            raise SalesforceResponseError(
                f"Salesforce CLI returned malformed REST JSON: {detail[:400]}"
            ) from exc
        if not isinstance(payload, dict):
            raise SalesforceResponseError("Salesforce REST response was not a JSON object.")
        # ``sf api request rest`` returns the REST body directly unless the CLI
        # itself wraps an error/result envelope. Support both forms without
        # adding ``--json`` (which this command does not accept).
        if completed.returncode != 0 or payload.get("status") not in (0, None, Decimal(0)):
            message = payload.get("message") or completed.stderr.strip() or "Salesforce REST request failed"
            raise SalesforceQueryError(str(message)[:600])
        result = payload.get("result", payload)
        if isinstance(result, str):
            try:
                result = json.loads(
                    result,
                    parse_int=Decimal,
                    parse_float=Decimal,
                    parse_constant=_reject_json_constant,
                )
            except (json.JSONDecodeError, ValueError) as exc:
                raise SalesforceResponseError("Salesforce REST response body was malformed JSON.") from exc
        if not isinstance(result, dict):
            raise SalesforceResponseError("Salesforce REST response had no JSON body.")
        if "compositeResponse" not in result and isinstance(result.get("response"), str):
            try:
                nested = json.loads(
                    result["response"],
                    parse_int=Decimal,
                    parse_float=Decimal,
                    parse_constant=_reject_json_constant,
                )
            except (json.JSONDecodeError, ValueError) as exc:
                raise SalesforceResponseError("Salesforce REST response body was malformed JSON.") from exc
            if isinstance(nested, dict):
                result = nested
        if "compositeResponse" not in result and isinstance(result.get("body"), dict):
            result = result["body"]
        return result

    def composite_write(
        self,
        quote: QuoteCandidate,
        contact: ContactTarget,
        result: CallResult,
        *,
        task_description: str,
        business_timezone: tzinfo | None = None,
        regional_settings: Any | None = None,
    ) -> CompositeWriteResult:
        """Atomically update one Quote and create its completed demo Task.

        This is intentionally the only write operation exposed by the MVP. The
        Composite API ``allOrNone`` flag ensures the Quote is not updated if the
        Task cannot be created.
        """

        if regional_settings is not None:
            configured_timezone = getattr(regional_settings, "business_timezone", None)
            if not isinstance(configured_timezone, tzinfo):
                raise SalesforceError("regional_settings has no valid business timezone.")
            business_timezone = configured_timezone
        if business_timezone is None:
            business_timezone = timezone.utc
        if not result.simulated:
            raise SalesforceError("composite_write only accepts simulated results.")
        if result.quote_id != quote.quote_id:
            raise SalesforceError("Simulation result does not match the selected Quote.")
        org = self.org_info()
        if not org.api_version:
            raise SalesforceError("Salesforce org display did not provide an API version.")
        version = org.api_version.removeprefix("v")
        quote_body = {
            "Attempt_Count__c": quote.attempt_count + 1,
            "Last_Follow_Up_At__c": _utc_timestamp(result),
            "Last_Follow_Up_Result__c": result.outcome,
            "Follow_Up_Status__c": _follow_up_status(result.outcome),
            "Next_Follow_Up_At__c": (
                result.next_follow_up_at.isoformat().replace("+00:00", "Z")
                if result.next_follow_up_at
                else None
            ),
        }
        task_body = {
            "WhatId": quote.quote_id,
            "WhoId": contact.contact_id,
            "Status": "Completed",
            "Priority": "Normal",
            "Subject": f"[SIMULATED] QuoteWake follow-up: {result.outcome}",
            "Description": task_description,
            "ActivityDate": _task_activity_date(result, business_timezone),
        }
        body = {
            "allOrNone": True,
            "compositeRequest": [
                {
                    "method": "PATCH",
                    "url": f"/services/data/v{version}/sobjects/Quote/{quote.quote_id}",
                    "referenceId": "quoteUpdate",
                    "body": quote_body,
                },
                {
                    "method": "POST",
                    "url": f"/services/data/v{version}/sobjects/Task",
                    "referenceId": "taskCreate",
                    "body": task_body,
                },
            ],
        }
        command = [
            self.executable,
            "api",
            "request",
            "rest",
            f"/services/data/v{version}/composite",
            "--method",
            "POST",
            "--body",
            json.dumps(body, ensure_ascii=False, separators=(",", ":")),
        ]
        if self.target_org:
            command.extend(["--target-org", self.target_org])
        response = self._run_api_json(command)
        responses = response.get("compositeResponse")
        if not isinstance(responses, list):
            raise SalesforceResponseError("Salesforce Composite response had no subresponses.")
        failures: list[dict[str, Any]] = []
        for item in responses:
            if not isinstance(item, dict):
                continue
            status = item.get("httpStatusCode", 200)
            if isinstance(status, (int, Decimal)) and status >= 400:
                failures.append(item)
        if failures:
            raise SalesforceQueryError(
                "Salesforce Composite write failed: "
                + json.dumps(failures, ensure_ascii=False, default=str)[:800]
            )
        task_id: str | None = None
        for item in responses:
            if not isinstance(item, dict) or item.get("referenceId") != "taskCreate":
                continue
            item_body = item.get("body")
            if isinstance(item_body, dict) and isinstance(item_body.get("id"), str):
                task_id = item_body["id"]
        if task_id is None:
            raise SalesforceResponseError("Salesforce Composite response did not return the Task ID.")
        return CompositeWriteResult(quote.quote_id, task_id)


def _utc_timestamp(result: CallResult) -> str:
    """Return the simulation timestamp embedded in the result contract."""

    timestamp = result.simulation_timestamp
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)
    elif timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise SalesforceResponseError("Call result simulation timestamp is timezone-naive.")
    return timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _task_activity_date(result: CallResult, business_timezone: tzinfo) -> str:
    timestamp = result.simulation_timestamp
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise SalesforceResponseError("Call result simulation timestamp is timezone-naive.")
    return timestamp.astimezone(business_timezone).date().isoformat()


def _follow_up_status(outcome: str) -> str:
    return {
        "Interested": "Completed",
        "Not Interested": "Stopped",
        "Invalid Number": "Stopped",
        "Call Back Later": "Retry",
        "No Answer": "Retry",
        "Busy": "Retry",
        "Error": "Retry",
    }[outcome]
