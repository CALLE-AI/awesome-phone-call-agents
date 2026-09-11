from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class Authorization:
    source: str
    authorized_at: datetime
    expires_at: datetime
    purpose: str
    allowed_disclosures: tuple[str, ...]
    voicemail_allowed: bool
    revoked: bool
    recipient_phone: str = ""
    approved_task: str = ""
    demo_only: bool = True

    @classmethod
    def from_json(cls, path: Path) -> "Authorization":
        raw = json.loads(path.read_text(encoding="utf-8"))
        for field in ("voicemail_allowed", "revoked", "demo_only"):
            if field in raw and type(raw[field]) is not bool:
                raise ValueError(field + " must be a JSON boolean")
        return cls(raw["source"], parse_time(raw["authorized_at"]), parse_time(raw["expires_at"]), raw["purpose"], tuple(raw.get("allowed_disclosures", [])), raw.get("voicemail_allowed", False), raw.get("revoked", False), raw.get("recipient_phone", ""), raw.get("approved_task", ""), raw.get("demo_only", True))

    def validate_dispatch(self, task: str, phone: str, execute: bool) -> list[str]:
        errors: list[str] = []
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone):
            errors.append("recipient must use E.164 format")
        if not self.recipient_phone or phone != self.recipient_phone:
            errors.append("recipient differs from the authorized recipient")
        if not self.approved_task or task != self.approved_task:
            errors.append("task differs from the exact approved task")
        if execute and self.demo_only:
            errors.append("demo authorization cannot execute live")
        return errors

    def validate(self, task: str, disclosures: tuple[str, ...], now: datetime) -> list[str]:
        errors: list[str] = []
        if self.revoked:
            errors.append("authorization is revoked")
        if now < self.authorized_at:
            errors.append("authorization is not active yet")
        if now >= self.expires_at:
            errors.append("authorization is expired")
        if self.purpose.casefold() not in task.casefold():
            errors.append("planned task does not state the authorized purpose")
        outside = sorted(set(disclosures) - set(self.allowed_disclosures))
        if outside:
            errors.append("disclosures exceed scope: " + ", ".join(outside))
        return errors


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def build_request(task: str, phone: str, authorization: Authorization) -> dict:
    return {"task": task, "recipients": [{"phones": [phone], "region": "US", "locale": "en-US"}], "metadata": {"authorization_source": authorization.source, "authorization_timestamp": authorization.authorized_at.isoformat(), "authorization_expires": authorization.expires_at.isoformat(), "voicemail_allowed": authorization.voicemail_allowed}}


def redact(request: dict) -> dict:
    safe = json.loads(json.dumps(request))
    safe["recipients"][0]["phones"] = ["<REDACTED_PHONE>"]
    return safe


def safe_call_result(result: object) -> dict:
    """Return only non-sensitive provider metadata for operator output."""
    return {
        "call_id": str(getattr(result, "id", "")),
        "status": str(getattr(result, "status", "")),
        "task_completed": getattr(result, "task_completed", None),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Authorization preflight for a CALL-E task")
    parser.add_argument("authorization", type=Path)
    parser.add_argument("--task", required=True)
    parser.add_argument("--phone", required=True)
    parser.add_argument("--disclose", action="append", default=[])
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-call", action="store_true")
    args = parser.parse_args()
    authorization = Authorization.from_json(args.authorization)
    errors = authorization.validate(args.task, tuple(args.disclose), datetime.now(timezone.utc))
    errors.extend(authorization.validate_dispatch(args.task, args.phone, args.execute))
    request = build_request(args.task, args.phone, authorization)
    print(json.dumps({"valid": not errors, "errors": errors, "request": redact(request)}, indent=2))
    if errors:
        return 2
    if not args.execute:
        print("DRY RUN: no CALL-E request was sent.")
        return 0
    if not args.confirm_call:
        raise SystemExit("Refusing live execution without --confirm-call")
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise SystemExit("CALLE_API_KEY is required for live execution")
    from calle import CalleClient
    result = CalleClient(api_key=api_key).calls.create_and_wait(**request)
    print(json.dumps(safe_call_result(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
