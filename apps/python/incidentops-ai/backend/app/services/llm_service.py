def create_call_goal(summary: str, priority: str, recommendation: str) -> str:
    """
    Generate a phone-call goal for CALL-E.
    Free version (no OpenAI API required).
    """

    if priority == "P1":
        urgency = "This is a CRITICAL production incident."
    elif priority == "P2":
        urgency = "This is a HIGH priority incident."
    else:
        urgency = "This is a MEDIUM priority incident."

    return f"""
You are calling the on-call engineer.

{urgency}

Incident Summary:
{summary}

Priority:
{priority}

Recommended Action:
{recommendation}

Please ask the engineer to acknowledge the incident immediately.

If nobody answers,
leave a short voicemail including the incident summary and priority.
"""
