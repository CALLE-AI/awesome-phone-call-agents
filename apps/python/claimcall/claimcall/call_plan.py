"""Turn a disruption case into one bounded CALL-E task: instruction text plus a closed result schema."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .policy import CALL_CONSTRAINTS, HARD_BOUNDARIES

PLAN_OBJECTIVES = [
    "Confirm the official cancellation reason",
    "Request the earliest replacement itinerary",
    "Ask whether hotel accommodation is authorised",
    "Ask whether meal assistance is available",
    "Request written disruption confirmation",
]

# Closed result schema. Every field is required and every value is validated
# locally before any case state changes; unknown or malformed results fail closed.
# Three-state answers use string enums with "unknown": the live CALL-E API
# rejects union types such as ["string", "null"], so nulls are not used.
TRISTATE = ["yes", "no", "unknown"]

RESULT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "cancellation_reason",
        "replacement_itinerary",
        "hotel",
        "meals",
        "written_confirmation",
        "representative_commitments",
        "unresolved_items",
        "recommended_follow_up",
    ],
    "properties": {
        "cancellation_reason": {"type": "string", "description": "Official cancellation reason. Empty string if unknown."},
        "replacement_itinerary": {
            "type": "object",
            "additionalProperties": False,
            "required": ["available", "details"],
            "properties": {
                "available": {"type": "string", "enum": TRISTATE},
                "details": {"type": "string", "description": "Replacement details. Empty string if unknown."},
            },
        },
        "hotel": {
            "type": "object",
            "additionalProperties": False,
            "required": ["authorised", "details"],
            "properties": {
                "authorised": {"type": "string", "enum": TRISTATE},
                "details": {"type": "string", "description": "Hotel details. Empty string if unknown."},
            },
        },
        "meals": {
            "type": "object",
            "additionalProperties": False,
            "required": ["available", "details"],
            "properties": {
                "available": {"type": "string", "enum": TRISTATE},
                "details": {"type": "string", "description": "Meal details. Empty string if unknown."},
            },
        },
        "written_confirmation": {
            "type": "object",
            "additionalProperties": False,
            "required": ["promised", "details"],
            "properties": {
                "promised": {"type": "string", "enum": TRISTATE},
                "details": {"type": "string", "description": "Confirmation details. Empty string if unknown."},
            },
        },
        "representative_commitments": {"type": "array", "items": {"type": "string"}},
        "unresolved_items": {"type": "array", "items": {"type": "string"}},
        "recommended_follow_up": {"type": "string", "description": "Follow-up suggestion. Empty string if none."},
    },
}


def build_plan(case: Dict[str, Any], missing: List[str]) -> Dict[str, Any]:
    """The visible bounded plan the traveller approves before any call."""
    return {
        "purpose": f"Resolve missing facts for a {case.get('flight_status', 'disrupted').lower()} flight",
        "objectives": list(PLAN_OBJECTIVES),
        "missing_information": list(missing),
        "constraints": list(CALL_CONSTRAINTS),
        "requires_human_approval": True,
    }


def build_task(case: Dict[str, Any], plan: Dict[str, Any]) -> str:
    """Generate the CALL-E task dynamically from the disruption case.

    Nothing about the demo passenger is hard-coded here; every fact comes
    from the case record passed in.
    """
    objectives = "\n".join(f"{i + 1}. {o}." for i, o in enumerate(plan["objectives"]))
    restrictions = "\n".join(f"- {c}." for c in plan["constraints"])
    parts = [
        f"You are calling {case['airline']} on behalf of passenger {case['passenger_name']} "
        f"regarding {case['flight_status'].lower()} flight {case['flight_no']}, "
        f"booking {case['booking_ref']}, {case['origin']} to {case['destination']}.",
        f"Your objectives are:\n\n{objectives}",
        f"Restrictions:\n\n{restrictions}\n\n"
        "- Do not accept or reject compensation offers.\n"
        "- Do not make commitments outside these objectives.",
        "Rules you must follow:\n" + "\n".join(f"- {b}" for b in HARD_BOUNDARIES),
        "Return the requested facts through the structured result schema. "
        "If the representative cannot answer something, answer \"unknown\", leave that "
        "detail empty, and name it in unresolved_items rather than guessing.",
    ]
    return "\n\n".join(parts)


def build_request(case: Dict[str, Any], task: str, idempotency_key: str,
                  destination: Optional[str] = None, region: Optional[str] = None) -> Dict[str, Any]:
    hotline = destination or case["airline_hotline"]
    dest_region = region or case["region"]
    req: Dict[str, Any] = {
        "task": task,
        "recipients": [
            {
                "phones": [hotline],
                "region": dest_region,
                "locale": case.get("locale", "en-US"),
            }
        ],
        "result_schema": RESULT_SCHEMA,
        "metadata": {
            "app": "claimcall",
            "case_id": case["id"],
            "booking_ref": case["booking_ref"],
            "idempotency_key": idempotency_key,
        },
    }
    return req
