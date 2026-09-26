"""Voice Scout: safe preview and explicit CALL-E Goal Run execution."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["interest", "decision_maker", "company_size", "current_workflow", "pain_points", "follow_up"],
    "properties": {
        "interest": {"type": "string", "enum": ["yes", "no", "maybe", "not_reachable", "unknown"]},
        "decision_maker": {"type": "string", "enum": ["yes", "no", "unsure"]},
        "company_size": {"type": "string"},
        "current_workflow": {"type": "string"},
        "pain_points": {"type": "string"},
        "follow_up": {"type": "string", "enum": ["yes", "no", "unknown"]},
    },
}

E164_RE = re.compile(r"\+[1-9][0-9]{7,14}")
# Display-only heuristic; the live destination still uses strict E164_RE.
PHONE_TEXT_RE = re.compile(
    r"(?<!\w)(?:\+[1-9](?:[ ().-]*[0-9]){7,14}"
    r"|\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4})(?!\w)"
)
SENSITIVE_KEY_RE = re.compile(r"(?:api[_-]?key|access[_-]?token|authorization|secret|password)", re.IGNORECASE)
PHONE_KEY_RE = re.compile(r"(?:phone|recipient|destination|caller|callee)", re.IGNORECASE)


def sanitize_result(value: Any, key: str = "") -> Any:
    """Recursively remove secrets and mask phone numbers in provider output."""
    if SENSITIVE_KEY_RE.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): sanitize_result(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_result(item, key) for item in value]
    if isinstance(value, tuple):
        return [sanitize_result(item, key) for item in value]
    if isinstance(value, str):
        text = value
        if PHONE_KEY_RE.search(key):
            return mask_phone(text)
        return PHONE_TEXT_RE.sub(lambda match: mask_phone(match.group(0)), text)
    return value


def load_lead(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("Lead file must contain a JSON object")
    required = ("id", "business_name", "industry", "phone")
    missing = [key for key in required if not data.get(key)]
    if missing:
        raise ValueError(f"Lead missing required fields: {', '.join(missing)}")
    if not isinstance(data["phone"], str) or not E164_RE.fullmatch(data["phone"]):
        raise ValueError("Lead phone must be ASCII E.164 format, e.g. +15551234567")
    return data


def idempotency_key(lead_id: str) -> str:
    digest = hashlib.sha256(lead_id.encode("utf-8")).hexdigest()[:20]
    return f"voice-scout:{digest}"


def mask_phone(phone: str) -> str:
    """Keep only the final four digits in user-visible output."""
    digits = "".join(ch for ch in str(phone) if "0" <= ch <= "9")
    return f"***-***-{digits[-4:]}" if len(digits) >= 4 else "[masked]"


def safe_lead(lead: dict[str, Any]) -> dict[str, Any]:
    """Return lead data safe for console/result output."""
    result = sanitize_result(dict(lead))
    result["phone"] = mask_phone(str(lead["phone"]))
    return result


def preview(lead: dict[str, Any]) -> dict[str, Any]:
    return {
        "mode": "preview",
        "would_call": mask_phone(str(lead["phone"])),
        "business_name": lead["business_name"],
        "industry": lead["industry"],
        "idempotency_key": idempotency_key(str(lead["id"])),
        "message": "Preview only; no call was placed.",
    }


def run_live(lead: dict[str, Any]) -> dict[str, Any]:
    if lead.get("authorized_live_call") is not True:
        raise RuntimeError("Live mode requires a lead explicitly marked authorized_live_call=true")
    if not isinstance(lead.get("phone"), str) or not E164_RE.fullmatch(lead["phone"]):
        raise ValueError("Live lead phone must be ASCII E.164 format, e.g. +15551234567")
    api_key = os.environ.get("CALLE_API_KEY")
    goal_id = os.environ.get("CALLE_GOAL_ID")
    if not api_key or not goal_id:
        raise RuntimeError("--live requires CALLE_API_KEY and CALLE_GOAL_ID")

    from calle import CalleClient

    client = CalleClient(api_key=api_key)
    variables = {
        "lead_source": str(lead.get("lead_source", "")),
        "known_company_size": str(lead.get("known_company_size", "")),
        "known_workflow": str(lead.get("known_workflow", "")),
        "known_pain_points": str(lead.get("known_pain_points", "")),
        "business_name": str(lead["business_name"]),
        "industry": str(lead["industry"]),
    }
    run = client.goals.run(
        goal_id=goal_id,
        phone=str(lead["phone"]),
        variables=variables,
        idempotency_key=idempotency_key(str(lead["id"])),
    )
    run_id = run.get("id")
    if run.get("result") is not None or run.get("error") is not None or not run_id:
        return {"mode": "live", "lead": safe_lead(lead), "run": sanitize_result(run)}
    result = client.goals.wait_for_result(goal_id, str(run_id), timeout_seconds=600)
    return {"mode": "live", "lead": safe_lead(lead), "run": sanitize_result(result)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Preview or run one generic CALL-E business qualification call")
    parser.add_argument("--demo", action="store_true", help="run the built-in synthetic preview")
    parser.add_argument("--lead", type=Path, help="JSON lead file")
    parser.add_argument("--live", action="store_true", help="place one real call through CALL-E")
    parser.add_argument("--output", type=Path, help="also write JSON output to this path")
    args = parser.parse_args()

    if not args.demo and not args.lead and not args.live:
        parser.error("choose --demo, --lead, or --live")
    if args.live and not args.lead:
        parser.error("--live requires an explicit --lead file marked authorized_live_call=true")
    lead_path = args.lead or Path(__file__).parent / "examples" / "synthetic_lead.json"
    lead = load_lead(lead_path)
    try:
        result = run_live(lead) if args.live else preview(lead)
    except Exception:
        # Provider exceptions may include request data; do not print their text.
        print("Live CALL-E run failed; check the explicit authorized lead, credentials, Goal ID, phone number, and account status.", file=sys.stderr)
        return 1
    encoded = json.dumps(result, indent=2, sort_keys=True)
    print(encoded)
    if args.output:
        args.output.write_text(encoded + "\\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
