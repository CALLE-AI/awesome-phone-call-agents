"""
CALL-E Structured Extraction Schemas
"""
from typing import Dict, Any

CONFIRMATION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["will_attend", "preferred_reschedule_time", "cancellation_reason"],
    "properties": {
        "will_attend": {
            "type": "string",
            "enum": ["yes", "no", "reschedule", "unknown"],
            "description": "Patient attendance decision for scheduled appointment.",
        },
        "preferred_reschedule_time": {
            "type": "string",
            "description": "Preferred reschedule time if requested, or null.",
        },
        "cancellation_reason": {
            "type": "string",
            "description": "Reason provided if cancelling, or null.",
        },
        "special_instructions_acknowledged": {
            "type": "boolean",
            "description": "Whether patient acknowledged preparation instructions.",
        },
    },
}

NO_SHOW_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["wants_rebook", "preferred_time", "reason_for_no_show"],
    "properties": {
        "wants_rebook": {
            "type": "string",
            "enum": ["yes", "no", "callback_requested", "unknown"],
            "description": "Whether missed visit patient desires to reschedule.",
        },
        "preferred_time": {
            "type": "string",
            "description": "Preferred replacement day and time.",
        },
        "reason_for_no_show": {
            "type": "string",
            "description": "Explanation given for missing the original visit.",
        },
    },
}

RECALL_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["interested", "preferred_time", "preferred_day"],
    "properties": {
        "interested": {
            "type": "string",
            "enum": ["yes", "no", "already_scheduled", "opt_out"],
            "description": "Patient interest in routine care follow-up booking.",
        },
        "preferred_day": {"type": "string", "description": "Preferred day of week."},
        "preferred_time": {"type": "string", "description": "Preferred time window."},
        "notes": {"type": "string", "description": "Clinical symptoms or patient notes."},
    },
}

SURVEY_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["nps_score", "would_recommend", "main_feedback"],
    "properties": {
        "nps_score": {"type": "integer", "minimum": 1, "maximum": 10},
        "would_recommend": {"type": "string", "enum": ["yes", "no", "maybe"]},
        "main_feedback": {"type": "string"},
    },
}

PRIOR_AUTH_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["auth_status", "authorization_number", "representative_name", "reference_number"],
    "properties": {
        "auth_status": {
            "type": "string",
            "enum": ["approved", "denied", "pended", "in_review", "additional_info_required"],
        },
        "authorization_number": {"type": "string"},
        "representative_name": {"type": "string"},
        "reference_number": {"type": "string"},
        "denial_reason": {"type": "string"},
    },
}
