#!/usr/bin/env python3
"""Opt-in Salesforce E2E verification for the QuoteWake simulator.

This file intentionally lives outside ``tests/`` so normal unit-test discovery
never mutates Salesforce. Run it manually only after seeding a disposable
Developer Edition or Sandbox org and explicitly confirming the writes.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any, Sequence

from quotewake_salesforce.phone import mask_phone


APP_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = APP_DIR / "results/quotewake_salesforce_e2e.json"
DEMO_NAMES = {
    "kitchen": "QuoteWake Demo - Kitchen Electrical Renovation",
    "ev": "QuoteWake Demo - EV Charger Installation",
    "office": "QuoteWake Demo - Office Electrical Upgrade",
}
SCENARIOS = (
    ("kitchen", "interested", "Completed"),
    ("ev", "call_back_later", "Retry"),
    ("office", "invalid_number", "Stopped"),
)
QUOTE_WAKE_FIELDS = (
    "QuoteWake_Enabled__c",
    "Follow_Up_Status__c",
    "Next_Follow_Up_At__c",
    "Attempt_Count__c",
    "Last_Follow_Up_At__c",
    "Last_Follow_Up_Result__c",
)
COMMERCIAL_FIELDS = (
    "Name",
    "Status",
    "OpportunityId",
    "ExpirationDate",
    "GrandTotal",
)


class E2EError(RuntimeError):
    """Raised when an E2E precondition or assertion fails."""


def _parse_timestamp(value: object, *, field: str) -> datetime:
    """Parse ISO and Salesforce DateTime spellings into UTC-aware values."""

    if not isinstance(value, str) or not value.strip():
        raise E2EError(f"{field} is missing or is not a DateTime.")
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    elif re.search(r"[+-]\d{4}$", normalized):
        normalized = normalized[:-5] + normalized[-5:-2] + ":" + normalized[-2:]
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise E2EError(f"{field} has an invalid DateTime format.") from exc
    if parsed.tzinfo is None:
        raise E2EError(f"{field} is timezone-naive.")
    return parsed.astimezone(timezone.utc)


def _target_args(target_org: str) -> list[str]:
    return ["--target-org", target_org]


def _run_process(command: Sequence[str], *, cwd: Path = APP_DIR) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            list(command),
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except FileNotFoundError as exc:
        raise E2EError(f"Required command is not available: {command[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise E2EError(f"Command timed out: {' '.join(command[:4])}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().replace("\n", " ")
        raise E2EError(f"Command failed ({' '.join(command[:5])}): {detail[:600]}")
    return completed


def _sf_json(target_org: str, args: Sequence[str]) -> dict[str, Any]:
    command = ["sf", *args, *_target_args(target_org), "--json"]
    completed = _run_process(command)
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise E2EError("Salesforce CLI returned malformed JSON.") from exc
    if not isinstance(payload, dict):
        raise E2EError("Salesforce CLI returned a non-object JSON response.")
    if payload.get("status") not in (None, 0):
        raise E2EError(str(payload.get("message") or "Salesforce CLI request failed"))
    result = payload.get("result", payload)
    if not isinstance(result, dict):
        raise E2EError("Salesforce CLI JSON response had no result object.")
    return result


def _query(target_org: str, soql: str) -> list[dict[str, Any]]:
    result = _sf_json(target_org, ["data", "query", "--query", soql])
    records = result.get("records")
    if not isinstance(records, list) or not all(isinstance(record, dict) for record in records):
        raise E2EError("Salesforce query response did not contain records.")
    return records


def _quote_name_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _resolve_fixture(target_org: str, quote_name: str) -> dict[str, Any]:
    literal = _quote_name_literal(quote_name)
    records = _query(
        target_org,
        "SELECT Id, Name, OpportunityId, Status, ExpirationDate, GrandTotal, "
        "QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, "
        "Attempt_Count__c, Last_Follow_Up_At__c, Last_Follow_Up_Result__c "
        f"FROM Quote WHERE Name = '{literal}' LIMIT 1",
    )
    if len(records) != 1:
        raise E2EError(f"Expected exactly one Quote named {quote_name!r}; found {len(records)}.")
    quote = records[0]
    quote_id = quote.get("Id")
    opportunity_id = quote.get("OpportunityId")
    if not isinstance(quote_id, str) or not isinstance(opportunity_id, str):
        raise E2EError(f"Quote {quote_name!r} did not include valid relationship IDs.")
    contacts = _query(
        target_org,
        "SELECT ContactId, IsPrimary, Contact.Name, Contact.Phone, Contact.MobilePhone "
        f"FROM OpportunityContactRole WHERE OpportunityId = '{opportunity_id}' "
        "AND IsPrimary = true",
    )
    if len(contacts) != 1:
        raise E2EError(
            f"Expected exactly one primary Contact for Quote {quote_name!r}; found {len(contacts)}."
        )
    role = contacts[0]
    contact_id = role.get("ContactId")
    contact = role.get("Contact")
    if not isinstance(contact_id, str) or not isinstance(contact, dict):
        raise E2EError(f"Primary Contact relationship for {quote_name!r} is malformed.")
    phone = contact.get("MobilePhone") or contact.get("Phone")
    if not isinstance(phone, str) or not phone.strip():
        raise E2EError(f"Primary Contact for {quote_name!r} has no phone.")
    return {
        "quote": quote,
        "quote_id": quote_id,
        "contact_id": contact_id,
        "contact_name": contact.get("Name"),
        "phone": phone,
    }


def _reset_quote(target_org: str, quote_id: str) -> None:
    values = (
        "QuoteWake_Enabled__c=true "
        "Follow_Up_Status__c= "
        "Next_Follow_Up_At__c= "
        "Attempt_Count__c=0 "
        "Last_Follow_Up_At__c= "
        "Last_Follow_Up_Result__c="
    )
    _run_process(
        [
            "sf",
            "data",
            "update",
            "record",
            *_target_args(target_org),
            "--sobject",
            "Quote",
            "--record-id",
            quote_id,
            "--values",
            values,
            "--json",
        ]
    )


def _temporary_config() -> tempfile.NamedTemporaryFile[str]:
    config = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".toml",
        prefix="quotewake-e2e-",
        delete=False,
    )
    config.write(
        "[regional]\n"
        "business_timezone = \"Europe/Madrid\"\n"
        "locale = \"es_ES\"\n\n"
        "[selection.initial_follow_up]\n"
        "minimum_delay_hours = 0\n"
        "standard_delay_hours = 0\n"
        "due_soon_window_days = 0\n"
    )
    config.flush()
    return config


def _invoke_simulation(
    target_org: str,
    fixture: dict[str, Any],
    outcome: str,
    next_follow_up_at: datetime | None,
    config_path: str,
    report_path: Path,
) -> None:
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        str(APP_DIR)
        if not existing_pythonpath
        else str(APP_DIR) + os.pathsep + existing_pythonpath
    )
    command = [
        sys.executable,
        "-m",
        "quotewake_salesforce",
        "--simulate-call",
        "--target-org",
        target_org,
        "--quote-id",
        fixture["quote_id"],
        "--simulation-outcome",
        outcome,
        "--call-language",
        "Spanish",
        "--call-region",
        "ES",
        "--confirm-demo-write",
        "--config",
        config_path,
        "--simulation-output",
        str(report_path),
    ]
    if next_follow_up_at is not None:
        command.extend(["--next-follow-up-at", next_follow_up_at.isoformat().replace("+00:00", "Z")])
    try:
        completed = subprocess.run(
            command,
            cwd=str(APP_DIR),
            env=environment,
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except FileNotFoundError as exc:
        raise E2EError("Python could not start the QuoteWake simulator subprocess.") from exc
    except subprocess.TimeoutExpired as exc:
        raise E2EError("QuoteWake simulator subprocess timed out.") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().replace("\n", " ")
        raise E2EError(f"Simulation failed for {fixture['quote']['Name']}: {detail[:600]}")


def _latest_quote(target_org: str, quote_id: str) -> dict[str, Any]:
    records = _query(
        target_org,
        "SELECT Id, Name, OpportunityId, Status, ExpirationDate, GrandTotal, "
        "QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, "
        "Attempt_Count__c, Last_Follow_Up_At__c, Last_Follow_Up_Result__c "
        f"FROM Quote WHERE Id = '{quote_id}' LIMIT 1",
    )
    if len(records) != 1:
        raise E2EError(f"Quote {quote_id} was not found after simulation.")
    return records[0]


def _task(target_org: str, task_id: str) -> dict[str, Any]:
    records = _query(
        target_org,
        "SELECT Id, WhatId, WhoId, Status, Priority, Subject, ActivityDate, Description "
        f"FROM Task WHERE Id = '{task_id}' LIMIT 1",
    )
    if len(records) != 1:
        raise E2EError(f"Task {task_id} was not found after simulation.")
    return records[0]


def _assert_scenario(
    fixture: dict[str, Any],
    final_quote: dict[str, Any],
    task: dict[str, Any],
    report: dict[str, Any],
    expected_outcome: str,
    expected_status: str,
    expected_next: datetime | None,
) -> None:
    for field in COMMERCIAL_FIELDS:
        if final_quote.get(field) != fixture["commercial"][field]:
            raise E2EError(
                f"Commercial Quote field {field} changed for {fixture['quote']['Name']}."
            )
    if final_quote.get("Attempt_Count__c") != 1:
        raise E2EError("QuoteWake Attempt_Count__c was not incremented to 1.")
    if final_quote.get("QuoteWake_Enabled__c") is not True:
        raise E2EError("QuoteWake_Enabled__c was not preserved as true.")
    if final_quote.get("Follow_Up_Status__c") != expected_status:
        raise E2EError(f"Unexpected Quote follow-up status: {final_quote.get('Follow_Up_Status__c')}")
    if final_quote.get("Last_Follow_Up_Result__c") != expected_outcome:
        raise E2EError(f"Unexpected Quote follow-up result: {final_quote.get('Last_Follow_Up_Result__c')}")
    if not final_quote.get("Last_Follow_Up_At__c"):
        raise E2EError("QuoteWake Last_Follow_Up_At__c was not written.")
    last_follow_up_at = _parse_timestamp(
        final_quote.get("Last_Follow_Up_At__c"),
        field="Last_Follow_Up_At__c",
    )
    report_simulation_at = _parse_timestamp(
        report.get("simulation_at"),
        field="simulation_at",
    )
    if last_follow_up_at != report_simulation_at:
        raise E2EError("Quote Last_Follow_Up_At__c does not match report simulation_at.")
    actual_next = final_quote.get("Next_Follow_Up_At__c")
    if expected_next is None:
        if actual_next not in (None, ""):
            raise E2EError(f"Terminal outcome retained Next_Follow_Up_At__c: {actual_next}")
    else:
        actual_next_at = _parse_timestamp(actual_next, field="Next_Follow_Up_At__c")
        expected_next_at = expected_next.astimezone(timezone.utc)
        if actual_next_at != expected_next_at:
            raise E2EError("Retry outcome wrote an unexpected Next_Follow_Up_At__c instant.")
    if task.get("Id") != report.get("task_id"):
        raise E2EError("Task ID in the report does not match the queried Task.")
    if task.get("WhatId") != fixture["quote_id"] or task.get("WhoId") != fixture["contact_id"]:
        raise E2EError("Task relationships do not point to the fixture Quote and Contact.")
    if task.get("Status") != "Completed" or task.get("Priority") != "Normal":
        raise E2EError("Task status or priority is incorrect.")
    if not str(task.get("Subject", "")).startswith("[SIMULATED] QuoteWake"):
        raise E2EError("Task is not marked as simulated.")
    if task.get("ActivityDate") != str(report.get("simulation_at", ""))[:10]:
        raise E2EError("Task ActivityDate does not match the simulation date.")
    description = str(task.get("Description", ""))
    if report.get("simulation_id") not in description or report.get("outcome") not in description:
        raise E2EError("Task Description does not contain the structured simulation result.")
    if fixture["phone"] in description:
        raise E2EError("Full Contact phone leaked into Task Description.")
    if report.get("phone") != mask_phone(fixture["phone"]):
        raise E2EError("E2E report phone is not correctly redacted.")
    if report.get("simulated") is not True:
        raise E2EError("Simulation report is missing simulation_at or simulated marker.")


def _safe_error(error: object) -> str:
    """Keep failure evidence useful while excluding common secret formats."""

    message = " ".join(str(error).split())
    message = re.sub(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)", "[redacted-phone]", message)
    message = re.sub(
        r"(?i)(access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        message,
    )
    return message[:400] or "E2E scenario failed."


def _write_summary(
    output: Path,
    target_org: str,
    scenarios: list[dict[str, Any]],
    *,
    status: str,
    failed_scenario: str | None = None,
    error: str | None = None,
) -> None:
    """Persist redacted progress so partial Salesforce writes remain auditable."""

    output.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "target_org": target_org,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "scenarios": scenarios,
    }
    if failed_scenario is not None:
        payload["failed_scenario"] = failed_scenario
    if error is not None:
        payload["error"] = _safe_error(error)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _validate_org(target_org: str) -> dict[str, Any]:
    records = _query(target_org, "SELECT IsSandbox, OrganizationType FROM Organization LIMIT 1")
    if len(records) != 1:
        raise E2EError("Could not resolve Salesforce Organization type.")
    organization = records[0]
    organization_type = str(organization.get("OrganizationType", ""))
    is_sandbox = organization.get("IsSandbox") is True or str(
        organization.get("IsSandbox", "")
    ).lower() == "true"
    if not is_sandbox and organization_type not in {
        "Developer Edition",
        "Developer",
    }:
        raise E2EError(
            "E2E writes require a Salesforce Developer Edition or Sandbox org; "
            f"received {organization_type or 'unknown'} (IsSandbox={organization.get('IsSandbox')})."
        )
    return organization


def run_e2e(target_org: str, *, confirm_demo_write: bool, output: Path = DEFAULT_OUTPUT) -> int:
    """Run and verify all three seeded simulator scenarios."""

    summary: list[dict[str, Any]] = []
    config_path: str | None = None
    failure_written = False
    try:
        if not target_org.strip():
            raise E2EError("--target-org is required.")
        if not confirm_demo_write:
            raise E2EError("--confirm-demo-write is required for E2E Salesforce writes.")
        _validate_org(target_org)
        _write_summary(output, target_org, summary, status="running")
        with _temporary_config() as config:
            config_path = config.name
        for key, outcome, expected_status in SCENARIOS:
            try:
                fixture = _resolve_fixture(target_org, DEMO_NAMES[key])
                fixture["commercial"] = {
                    field: fixture["quote"].get(field) for field in COMMERCIAL_FIELDS
                }
                _reset_quote(target_org, fixture["quote_id"])
                next_follow_up_at = (
                    (datetime.now(timezone.utc) + timedelta(minutes=5)).replace(microsecond=0)
                    if expected_status == "Retry"
                    else None
                )
                with tempfile.TemporaryDirectory(prefix=f"quotewake-e2e-{key}-") as temp_dir:
                    report_path = Path(temp_dir) / "simulation.jsonl"
                    _invoke_simulation(
                        target_org,
                        fixture,
                        outcome,
                        next_follow_up_at,
                        config_path or "",
                        report_path,
                    )
                    try:
                        records = [
                            json.loads(line)
                            for line in report_path.read_text(encoding="utf-8").splitlines()
                            if line.strip()
                        ]
                    except (FileNotFoundError, json.JSONDecodeError) as exc:
                        raise E2EError(f"Simulation report is missing or malformed for {key}.") from exc
                    if len(records) != 1 or not isinstance(records[0], dict):
                        raise E2EError(f"Expected exactly one simulation report record for {key}.")
                    report = records[0]
                    final_quote = _latest_quote(target_org, fixture["quote_id"])
                    task_id = report.get("task_id")
                    if not isinstance(task_id, str) or not task_id:
                        raise E2EError(f"Simulation report has no Task ID for {key}.")
                    task = _task(target_org, task_id)
                    _assert_scenario(
                        fixture,
                        final_quote,
                        task,
                        report,
                        {
                            "interested": "Interested",
                            "call_back_later": "Call Back Later",
                            "invalid_number": "Invalid Number",
                        }[outcome],
                        expected_status,
                        next_follow_up_at,
                    )
                    summary.append(
                        {
                            "scenario": key,
                            "quote_id": fixture["quote_id"],
                            "quote_name": fixture["quote"]["Name"],
                            "contact_id": fixture["contact_id"],
                            "phone": report["phone"],
                            "simulation_id": report["simulation_id"],
                            "simulation_at": report["simulation_at"],
                            "outcome": report["outcome"],
                            "follow_up_status": final_quote["Follow_Up_Status__c"],
                            "task_id": task_id,
                            "simulated": True,
                        }
                    )
                    _write_summary(output, target_org, summary, status="running")
            except E2EError as exc:
                _write_summary(
                    output,
                    target_org,
                    summary,
                    status="failed",
                    failed_scenario=key,
                    error=_safe_error(exc),
                )
                failure_written = True
                raise
        _write_summary(output, target_org, summary, status="completed")
    except E2EError as exc:
        if not failure_written:
            _write_summary(output, target_org, summary, status="failed", error=_safe_error(exc))
        raise
    finally:
        if config_path:
            try:
                Path(config_path).unlink()
            except FileNotFoundError:
                pass
    print(f"[OK] E2E scenarios verified: {len(summary)}")
    print(f"[OK] Redacted E2E summary: {output}")
    print("[OK] Quotes and Tasks were preserved; no deletes were performed")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-org", required=True)
    parser.add_argument("--confirm-demo-write", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        return run_e2e(
            args.target_org,
            confirm_demo_write=args.confirm_demo_write,
            output=args.output,
        )
    except E2EError as exc:
        print(f"[ERROR] {_safe_error(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
