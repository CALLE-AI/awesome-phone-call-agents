#!/usr/bin/env python3
"""Preview and place one consent-first Cloud Steward incident callback."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


CONFIRMATION = "CALL_ON_CALL_ONCE"
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
ALLOWED_SEVERITIES = {"high", "critical"}
ALLOWED_DECISIONS = {"acknowledged", "review_now", "unknown"}


class InputError(ValueError):
    pass


@dataclass(frozen=True)
class IncidentRequest:
    request_id: str
    severity: str
    service: str
    summary: str
    context_url: str
    plan_id: str
    phone: str
    relationship: str
    consent_recorded_at: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "IncidentRequest":
        recipient = data.get("recipient") or {}
        request = cls(
            request_id=str(data.get("requestId", "")).strip(),
            severity=str(data.get("severity", "")).strip().lower(),
            service=str(data.get("service", "")).strip(),
            summary=str(data.get("summary", "")).strip(),
            context_url=str(data.get("contextUrl", "")).strip(),
            plan_id=str(data.get("planId", "")).strip(),
            phone=str(recipient.get("phone", "")).strip(),
            relationship=str(recipient.get("relationship", "")).strip(),
            consent_recorded_at=str(recipient.get("consentRecordedAt", "")).strip(),
        )
        request.validate()
        return request

    def validate(self) -> None:
        if not self.request_id:
            raise InputError("requestId is required")
        if self.severity not in ALLOWED_SEVERITIES:
            raise InputError("severity must be high or critical")
        if not self.service or len(self.service) > 80:
            raise InputError("service is required and must be at most 80 characters")
        if not self.summary or len(self.summary) > 300:
            raise InputError("summary is required and must be at most 300 characters")
        if not self.context_url.startswith("https://"):
            raise InputError("contextUrl must use https")
        if not self.plan_id:
            raise InputError("planId is required")
        if not E164_RE.fullmatch(self.phone):
            raise InputError("recipient phone must be E.164")
        if self.relationship != "consenting on-call owner":
            raise InputError("recipient relationship must be consenting on-call owner")
        try:
            datetime.fromisoformat(self.consent_recorded_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise InputError("consentRecordedAt must be ISO 8601") from error
        combined = f"{self.service} {self.summary} {self.context_url} {self.plan_id}".lower()
        if any(marker in combined for marker in ("password=", "token=", "secret=", "api_key=")):
            raise InputError("request contains a credential-like value")

    @property
    def masked_phone(self) -> str:
        return f"{self.phone[:2]}{'*' * max(3, len(self.phone) - 5)}{self.phone[-3:]}"

    @property
    def call_goal(self) -> str:
        return (
            "This is a one-time operational incident notification. Identify the recipient as the "
            "enrolled on-call owner before disclosing details. Report that Cloud Steward detected a "
            f"{self.severity} incident for {self.service}: {self.summary} "
            f"Reference plan {self.plan_id}. Ask for one constrained response: acknowledged, "
            "review now, or unknown. State clearly that this call cannot approve or execute any "
            "infrastructure action."
        )


def run_cli(command: str, arguments: list[str]) -> dict[str, Any]:
    completed = subprocess.run(
        [command, *arguments, "--no-telemetry"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"CALL-E CLI failed with exit code {completed.returncode}")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("CALL-E CLI returned non-JSON output") from error


def used_request_ids(audit_path: Path) -> set[str]:
    if not audit_path.exists():
        return set()
    ids = set()
    for line in audit_path.read_text(encoding="utf-8").splitlines():
        try:
            ids.add(str(json.loads(line)["requestId"]))
        except (json.JSONDecodeError, KeyError):
            continue
    return ids


def preview(request: IncidentRequest) -> dict[str, Any]:
    return {
        "status": "previewed",
        "requestId": request.request_id,
        "maskedPhone": request.masked_phone,
        "callGoal": request.call_goal,
        "networkRequestMade": False,
        "actionRemainsPending": True,
    }


def place_call(
    request: IncidentRequest,
    audit_path: Path,
    command: str,
) -> dict[str, Any]:
    if os.environ.get("CALLE_LIVE_CONFIRMATION") != CONFIRMATION:
        raise InputError(f"set CALLE_LIVE_CONFIRMATION={CONFIRMATION} for this exact request")
    if request.request_id in used_request_ids(audit_path):
        raise InputError("requestId already has a live-call audit record")

    run_cli(command, ["auth", "status"])
    planned = run_cli(
        command,
        ["call", "plan", "--to-phone", request.phone, "--goal", request.call_goal],
    )
    if not planned.get("ready_to_run"):
        raise RuntimeError("CALL-E plan is not ready to run")
    if planned.get("to_phone") not in {None, request.phone}:
        raise RuntimeError("CALL-E plan target differs from the validated phone number")

    plan_id = planned.get("plan_id")
    confirm_token = planned.get("confirm_token")
    if not plan_id or not confirm_token:
        raise RuntimeError("CALL-E plan omitted its execution identifiers")
    run = run_cli(
        command,
        ["call", "run", "--plan-id", str(plan_id), "--confirm-token", str(confirm_token)],
    )
    call_id = run.get("run_id") or run.get("call_id")
    status = run_cli(command, ["call", "status", "--run-id", str(call_id)]) if call_id else {}
    decision = str(status.get("decision", "unknown")).lower()
    if decision not in ALLOWED_DECISIONS:
        decision = "unknown"

    result = {
        "requestId": request.request_id,
        "maskedPhone": request.masked_phone,
        "callId": call_id,
        "decision": decision,
        "providerStatus": status.get("status", "unknown"),
        "actionRemainsPending": True,
    }
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_path.open("a", encoding="utf-8") as audit:
        audit.write(json.dumps(result, sort_keys=True) + "\n")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("preview", "call"))
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--calle-command", default="calle")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = IncidentRequest.from_dict(json.loads(args.request.read_text(encoding="utf-8")))
        result = (
            preview(request)
            if args.mode == "preview"
            else place_call(request, args.audit, args.calle_command)
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (InputError, RuntimeError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "not_created", "error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
