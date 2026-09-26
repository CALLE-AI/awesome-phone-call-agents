JOB_DISCOVERY_SCHEMA = {
    "type": "object",
    "required": [
        "permission_to_continue",
        "hiring_status",
        "verification_status",
        "follow_up_required"
    ],
    "properties": {
        "permission_to_continue": {
            "type": "boolean"
        },
        "hiring_status": {
            "type": "string",
            "enum": [
                "hiring_now",
                "hiring_soon",
                "not_hiring",
                "unclear"
            ]
        },
        "job_title": {
            "type": ["string", "null"]
        },
        "number_of_openings": {
            "type": ["integer", "null"]
        },
        "salary_min": {
            "type": ["number", "null"]
        },
        "salary_max": {
            "type": ["number", "null"]
        },
        "shift": {
            "type": ["string", "null"]
        },
        "experience_required": {
            "type": ["string", "null"]
        },
        "skills_required": {
            "type": "array",
            "items": {
                "type": "string"
            }
        },
        "joining_timeline": {
            "type": ["string", "null"]
        },
        "candidate_referrals_allowed": {
            "type": "string",
            "enum": [
                "yes",
                "no",
                "unclear"
            ]
        },
        "future_follow_up_allowed": {
            "type": "boolean"
        },
        "missing_information": {
            "type": "array",
            "items": {
                "type": "string"
            }
        },
        "verification_status": {
            "type": "string",
            "enum": [
                "verified",
                "partially_verified",
                "future_demand",
                "unverified"
            ]
        },
        "follow_up_required": {
            "type": "boolean"
        },
        "call_summary": {
            "type": "string"
        }
    }
}