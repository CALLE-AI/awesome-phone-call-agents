def generate_goal(incident: str, severity: str):

    severity = severity.upper()

    return f"""
Critical Incident Notification.

Severity: {severity}

Incident:
{incident}

Please acknowledge immediately.

Join the incident bridge and begin mitigation.

Thank you.
"""
