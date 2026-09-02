"""Data model for cases, calls, and commitments. Plain dicts persisted as JSON; no ORM."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

CASE_STATUSES = ("open", "waiting_on_company", "waiting_on_customer", "needs_human", "resolved", "denied", "abandoned")
CALL_OUTCOMES = ("resolved", "in_progress", "needs_customer_action", "denied", "offer_made", "unknown", "unreached")
ESCALATION_LADDER = ("agent", "supervisor", "written_complaint", "regulator")

CASE_TYPES = ("insurance_claim", "refund", "warranty_repair", "delivery", "billing_dispute", "service_request", "other")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def mask_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) <= 4:
        return "***"
    return f"{phone[:2]}***{digits[-2:]}"


def new_case(
    customer_name: str,
    company: str,
    hotline: str,
    region: str,
    case_type: str,
    reference: str,
    summary: str,
    what_is_owed: str,
    opened_on: str,
    locale: str = "en-US",
    timezone_name: str = "UTC",
    ivr_hints: Optional[str] = None,
    identity_facts: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    if case_type not in CASE_TYPES:
        raise ValueError(f"unknown case_type {case_type!r}; expected one of {CASE_TYPES}")
    return {
        "id": new_id("case"),
        "created_at": now_iso(),
        "customer_name": customer_name,
        "company": company,
        "hotline": hotline,
        "region": region,
        "locale": locale,
        "timezone": timezone_name,
        "case_type": case_type,
        "reference": reference,
        "summary": summary,
        "what_is_owed": what_is_owed,
        "opened_on": opened_on,
        "ivr_hints": ivr_hints or "",
        "ivr_path_learned": "",
        "identity_facts": identity_facts or {},
        "status": "open",
        "escalation_level": 0,
        "calls": [],
        "commitments": [],
        "human_decisions": [],
        "next_call_after": None,
        "closed_at": None,
    }


def add_commitment(case: Dict[str, Any], call_id: str, action: str, by_date: Optional[str], quote: str, who: str) -> Dict[str, Any]:
    c = {
        "id": new_id("cmt"),
        "call_id": call_id,
        "action": action,
        "by_date": by_date,
        "quote": quote,
        "who": who,
        "recorded_at": now_iso(),
        "status": "pending",   # pending | kept | broken | superseded
    }
    case["commitments"].append(c)
    return c


class Ledger:
    """JSON-file ledger. One file per data directory; written atomically."""

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.path = os.path.join(data_dir, "cases.json")
        os.makedirs(data_dir, exist_ok=True)
        if not os.path.exists(self.path):
            self._write({"cases": []})

    def _read(self) -> Dict[str, Any]:
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write(self, payload: Dict[str, Any]) -> None:
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
        os.replace(tmp, self.path)

    def list_cases(self) -> List[Dict[str, Any]]:
        return self._read()["cases"]

    def get(self, case_id: str) -> Dict[str, Any]:
        for c in self.list_cases():
            if c["id"] == case_id:
                return c
        raise KeyError(case_id)

    def upsert(self, case: Dict[str, Any]) -> None:
        payload = self._read()
        cases = [c for c in payload["cases"] if c["id"] != case["id"]]
        cases.append(case)
        cases.sort(key=lambda c: c["created_at"])
        payload["cases"] = cases
        self._write(payload)
