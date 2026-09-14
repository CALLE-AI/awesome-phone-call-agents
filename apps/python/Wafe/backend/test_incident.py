from app.incidents.service import create_incident


decision = {
    "status": "danger",
    "reason": "User said someone was following them.",
    "distress_detected": True,
    "user_confirmed_danger": True,
}


incident_id = create_incident(
    session_id="walk_test_001",
    call_id="call_test_001",
    decision=decision,
)


print("Incident created!")
print("Incident ID:", incident_id)