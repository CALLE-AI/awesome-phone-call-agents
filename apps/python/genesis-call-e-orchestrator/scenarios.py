"""Scenario definitions for the Genesis CALL-E Orchestrator demo app."""
from __future__ import annotations

import json
from typing import Any


SCENARIOS: dict[str, dict[str, Any]] = {
    "appointment_booking": {
        "title": "Appointment booking",
        "result_schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["confirmed"],
            "properties": {
                "confirmed": {"type": "boolean"},
                "appointment_time": {"type": "string"},
                "provider": {"type": "string"},
                "location": {"type": "string"},
                "confirmation_number": {"type": "string"},
                "notes": {"type": "string"},
            },
        },
    },
    "lead_qualification": {
        "title": "Lead qualification",
        "result_schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["qualified", "score", "opt_out"],
            "properties": {
                "qualified": {"type": "boolean"},
                "score": {"type": "integer"},
                "pain_points": {"type": "array", "items": {"type": "string"}},
                "budget": {"type": "string"},
                "timeline": {"type": "string"},
                "decision_maker": {"type": "boolean"},
                "next_steps": {"type": "string"},
                "opt_out": {"type": "boolean"},
            },
        },
    },
    "vendor_coordination": {
        "title": "Service and vendor coordination",
        "result_schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["vendor", "pricing", "availability"],
            "properties": {
                "vendor": {"type": "string"},
                "pricing": {"type": "string"},
                "availability": {"type": "string"},
                "recommendation": {"type": "string"},
                "contact_info": {"type": "string"},
                "notes": {"type": "string"},
            },
        },
    },
}


def build_task(request: dict[str, Any]) -> str:
    scenario = request["scenario"]
    context = request.get("context") or {}
    disclosure = (
        "Immediately identify the represented organization, disclose that you are an AI assistant, "
        "ask permission to continue, and end politely if the recipient refuses or opts out. "
    )
    if scenario == "appointment_booking":
        return (
            f"Call {context.get('business_name', 'the business')} on behalf of "
            f"{context.get('customer_name', context.get('client_name', 'the client'))} to book "
            f"{context.get('service', 'an appointment')}. Preferred times: "
            f"{json.dumps(context.get('preferred_times', []), ensure_ascii=False)}. "
            + disclosure
            + "Confirm availability, relevant price or preparation requirements, the exact date and time, "
              "and a confirmation number. Do not authorize charges. Return the requested structured result."
        )
    if scenario == "lead_qualification":
        return (
            f"Call a business contact for {context.get('company_name', 'the represented company')} "
            f"about {context.get('product_name', 'the product')}. Qualification criteria: "
            f"{json.dumps(context.get('qualification_criteria', ['need', 'authority', 'budget', 'timeline']))}. "
            + disclosure
            + "Ask concise, non-deceptive questions. Never pressure or collect sensitive personal data. "
              "Record any opt-out and return the requested structured result."
        )
    return (
        f"Call a service provider on behalf of {context.get('company_name', 'the client')} about "
        f"{context.get('service_type', 'the requested service')}. Requirements: "
        f"{json.dumps(context.get('requirements', []), ensure_ascii=False)}. Budget: "
        f"{context.get('budget_range', 'not specified')}. Timeline: "
        f"{context.get('required_timeline', 'not specified')}. "
        + disclosure
        + "Confirm capability, availability, itemized pricing, minimum commitments, cancellation terms, "
          "turnaround, and a contact. Do not accept a quote, sign a contract, or authorize payment."
    )


def simulated_result(scenario: str) -> dict[str, Any]:
    if scenario == "appointment_booking":
        return {
            "confirmed": True,
            "appointment_time": "2026-08-11T10:00:00-07:00",
            "provider": "Example Dental",
            "location": "100 Example Street",
            "confirmation_number": "DEMO-1001",
            "notes": "Preparation instructions confirmed.",
        }
    if scenario == "lead_qualification":
        return {
            "qualified": True,
            "score": 86,
            "pain_points": ["manual follow-up", "missed appointments"],
            "budget": "$25k-$50k",
            "timeline": "this quarter",
            "decision_maker": True,
            "next_steps": "Send a product brief and propose a 30-minute demo.",
            "opt_out": False,
        }
    return {
        "vendor": "Example Facilities",
        "pricing": "$780/month; three-month minimum",
        "availability": "Can start next Monday",
        "recommendation": "Meets requirements; human review required before acceptance.",
        "contact_info": "Jordan, operations desk",
        "notes": "Insurance certificate available on request.",
    }


def follow_up(scenario: str, result: dict[str, Any]) -> dict[str, Any]:
    if scenario == "appointment_booking":
        return {
            "type": "calendar_draft" if result.get("confirmed") else "manual_review",
            "starts_at": result.get("appointment_time"),
            "confirmation_number": result.get("confirmation_number"),
        }
    if scenario == "lead_qualification":
        if result.get("opt_out"):
            return {"type": "do_not_contact", "required": True}
        return {
            "type": "crm_follow_up_draft" if result.get("qualified") else "crm_note",
            "priority": "high" if int(result.get("score") or 0) >= 80 else "normal",
            "next_steps": result.get("next_steps"),
        }
    return {
        "type": "vendor_comparison_update",
        "recommendation": result.get("recommendation"),
        "requires_human_commitment": True,
    }
