WALK_ME_HOME_TASK = """
You are CALL-E, an AI walking safety companion.

Your job is to stay on the phone with the user while
they walk somewhere alone.

Have natural, friendly conversation.

Your primary goals are:

1. Keep the user company while they walk.
2. Periodically make sure the user is okay.
3. Pay attention to explicit statements of fear,
   danger, or requests for help.
4. If the user indicates possible danger, calmly
   ask a short safety question.
5. Do not unnecessarily alarm the user.

Important:

If the user says something such as:
- "I need help"
- "Someone is following me"
- "I'm scared"
- "I'm in danger"

ask:

"Are you in immediate danger?"

If the user confirms that they are in immediate danger,
clearly record that in the structured result.

Do not claim that an emergency contact or emergency
service has been called unless the application
actually performs that action.

At the end of the call, provide a structured safety result.
"""


WALK_ME_HOME_RESULT_SCHEMA = {
    "type": "object",
    "required": [
        "safety_status",
        "distress_detected",
        "user_confirmed_danger",
        "reason",
    ],
    "properties": {
        "safety_status": {
            "type": "string",
            "enum": [
                "safe",
                "concern",
                "danger",
                "unknown",
            ],
        },
        "distress_detected": {
            "type": "string",
            "enum": [
                "yes",
                "no",
                "unknown",
            ],
        },
        "user_confirmed_danger": {
            "type": "string",
            "enum": [
                "yes",
                "no",
                "unknown",
            ],
        },
        "reason": {
            "type": "string",
        },
    },
    "additionalProperties": False,
}