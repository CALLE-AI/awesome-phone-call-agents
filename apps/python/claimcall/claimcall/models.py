"""Data model for a flight-disruption case. Plain dicts persisted as JSON; no ORM."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

CASE_STATUSES = ("open", "partially_resolved", "resolved", "needs_human")

# The five facts a cancelled-flight case needs before the traveller knows what to do next.
MISSING_LABELS = (
    "Official cancellation reason",
    "Replacement itinerary",
    "Hotel accommodation eligibility",
    "Meal assistance",
    "Written disruption confirmation",
)


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
    passenger_name: str,
    airline: str,
    booking_ref: str,
    flight_no: str,
    origin: str,
    destination: str,
    flight_status: str,
    scheduled_date: str,
    airline_hotline: str,
    region: str,
    locale: str = "en-US",
) -> Dict[str, Any]:
    """A fresh disruption case. All five resolution facts start unknown (None)."""
    return {
        "id": new_id("case"),
        "created_at": now_iso(),
        "passenger_name": passenger_name,
        "airline": airline,
        "booking_ref": booking_ref,
        "flight_no": flight_no,
        "origin": origin,
        "destination": destination,
        "flight_status": flight_status,
        "scheduled_date": scheduled_date,
        "airline_hotline": airline_hotline,
        "region": region,
        "locale": locale,
        "cancellation_reason": None,
        "replacement_itinerary": {"available": None, "details": None},
        "hotel": {"authorised": None, "details": None},
        "meals": {"available": None, "details": None},
        "written_confirmation": {"promised": None, "details": None},
        "representative_commitments": [],
        "unresolved_items": [],
        "recommended_follow_up": None,
        "status": "open",
        "calls": [],
        "pending_question": "",
    }


def blank_resolution() -> Dict[str, Any]:
    """The resolution fact block of a fresh case, for before/after snapshots."""
    return {
        "cancellation_reason": None,
        "replacement_itinerary": {"available": None, "details": None},
        "hotel": {"authorised": None, "details": None},
        "meals": {"available": None, "details": None},
        "written_confirmation": {"promised": None, "details": None},
    }


def resolution_snapshot(case: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "cancellation_reason": case.get("cancellation_reason"),
        "replacement_itinerary": dict(case.get("replacement_itinerary") or {}),
        "hotel": dict(case.get("hotel") or {}),
        "meals": dict(case.get("meals") or {}),
        "written_confirmation": dict(case.get("written_confirmation") or {}),
    }


class Store:
    """JSON-file store. One file per data directory; written atomically."""

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.path = os.path.join(data_dir, "case.json")
        os.makedirs(data_dir, exist_ok=True)

    def exists(self) -> bool:
        return os.path.exists(self.path)

    def load(self) -> Dict[str, Any]:
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save(self, case: Dict[str, Any]) -> None:
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(case, f, indent=2, sort_keys=True)
        os.replace(tmp, self.path)
