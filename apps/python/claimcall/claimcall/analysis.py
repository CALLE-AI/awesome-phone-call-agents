"""Deterministic disruption analysis. No LLM: a cancelled flight with unknown
resolution facts always resolves to the same missing-information list."""
from __future__ import annotations

from typing import Any, Dict, List


def missing_information(case: Dict[str, Any]) -> List[str]:
    """Name every resolution fact that is still unknown on the case."""
    missing: List[str] = []
    if not case.get("cancellation_reason"):
        missing.append("Official cancellation reason")
    rep = case.get("replacement_itinerary") or {}
    if rep.get("available") is None and not rep.get("details"):
        missing.append("Replacement itinerary")
    hotel = case.get("hotel") or {}
    if hotel.get("authorised") is None and not hotel.get("details"):
        missing.append("Hotel accommodation eligibility")
    meals = case.get("meals") or {}
    if meals.get("available") is None and not meals.get("details"):
        missing.append("Meal assistance")
    wc = case.get("written_confirmation") or {}
    if wc.get("promised") is None and not wc.get("details"):
        missing.append("Written disruption confirmation")
    return missing


def analyze_case(case: Dict[str, Any]) -> Dict[str, Any]:
    """Decide whether the case needs resolution work and whether a phone call helps."""
    missing = missing_information(case)
    if not missing:
        return {
            "resolution_required": False,
            "phone_call_recommended": False,
            "reason": "All resolution facts are already known; no phone call is needed.",
            "missing_information": [],
        }
    return {
        "resolution_required": True,
        "phone_call_recommended": True,
        "reason": "Critical disruption information is unavailable in the current case record.",
        "missing_information": missing,
    }
