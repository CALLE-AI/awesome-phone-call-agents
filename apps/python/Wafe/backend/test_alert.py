from app.alerts.service import send_trusted_contact_alert


result = send_trusted_contact_alert(
    session_id="walk_demo_001",
    incident_id=999,
    reason="User reported that someone was following them.",
    location={
        "latitude": 19.0760,
        "longitude": 72.8777,
    },
)

print(result)