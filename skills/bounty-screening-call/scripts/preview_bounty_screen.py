#!/usr/bin/env python3
"""Build a masked, no-call preview for bounty-screening-call."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")
RESULT_SCHEMA = {
    "type": "object",
    "required": [
        "reward_status",
        "reward_amount",
        "reward_currency",
        "ai_use",
        "eligibility",
        "deadline",
        "payout_method",
        "submission_url",
        "confidence",
        "notes",
        "evidence",
    ],
    "additionalProperties": False,
}


def compact(value: object, limit: int = 240) -> str:
    return re.sub(r"[\r\n]+", " ", str(value or "")).strip()[:limit]


def mask_phone(phone: str) -> str:
    if len(phone) <= 7:
        return "•••"
    return f"{phone[:4]}•••{phone[-4:]}"


def build_task(data: dict) -> str:
    reward = data["reported_reward"]
    evidence = "\n".join(f"- {compact(item, 180)}" for item in data["public_evidence"])
    return "\n".join(
        [
            "You are a verification-only automated assistant calling on behalf of the operator.",
            "Disclose that immediately and speak only with the official organizer or an authorized representative.",
            "Verify the public reward amount and currency, AI-use policy, jurisdiction eligibility, deadline, payout method, and official submission URL.",
            "Do not claim the bounty, negotiate, submit anything, create an account, or request passwords, codes, identity documents, bank/card details, payment credentials, PayPal links, or private data.",
            "If the wrong person, voicemail, refusal, or uncertainty is encountered, record unknown and end politely.",
            f"Organizer: {compact(data['organizer_name'], 120)}",
            f"Opportunity: {compact(data['title'], 180)}",
            f"Public listing URL: {compact(data['listing_url'], 240)}",
            f"Currently reported reward: {compact(reward['amount'])} {compact(reward['currency'], 30)}",
            f"Known public evidence:\n{evidence or '- none supplied'}",
            "Return only the exact structured result fields and short public-fact notes.",
        ]
    )


def validate(data: dict) -> None:
    required = {
        "request_id",
        "opportunity_id",
        "title",
        "listing_url",
        "organizer_name",
        "organizer_phone_e164",
        "contact_basis",
        "reported_reward",
        "reported_ai_policy",
        "reported_eligibility",
        "reported_deadline",
        "reported_payout_method",
        "public_evidence",
        "operator_intent",
    }
    missing = sorted(required - data.keys())
    if missing:
        raise ValueError(f"missing required fields: {', '.join(missing)}")
    phone = data["organizer_phone_e164"]
    if not isinstance(phone, str) or not E164_RE.fullmatch(phone):
        raise ValueError("organizer_phone_e164 must be an E.164 number")
    if not str(data["listing_url"]).startswith("https://"):
        raise ValueError("listing_url must use HTTPS")
    if not compact(data["contact_basis"]):
        raise ValueError("contact_basis is required")
    if not compact(data["operator_intent"]):
        raise ValueError("operator_intent is required")
    if not isinstance(data["public_evidence"], list) or not data["public_evidence"]:
        raise ValueError("public_evidence must contain at least one public fact")
    reward = data["reported_reward"]
    if not isinstance(reward, dict) or "amount" not in reward or "currency" not in reward:
        raise ValueError("reported_reward must contain amount and currency")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        validate(data)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    key_material = "|".join(
        [str(data["request_id"]), str(data["opportunity_id"]), str(data["listing_url"])]
    )
    digest = hashlib.sha256(key_material.encode("utf-8")).hexdigest()
    output = {
        "call_placed": False,
        "masked_phone": mask_phone(data["organizer_phone_e164"]),
        "request_id": data["request_id"],
        "opportunity_id": data["opportunity_id"],
        "idempotency_key": f"bounty-screen:{digest[:24]}",
        "task": build_task(data),
        "result_schema": RESULT_SCHEMA,
        "next_step": "Review this exact preview and authorize one provider plan separately; do not execute from this command.",
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
