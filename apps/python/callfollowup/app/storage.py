import json
from pathlib import Path

CALLS_FILE = Path("data/calls.json")


def save_follow_up(follow_up):
    CALLS_FILE.parent.mkdir(exist_ok=True)

    try:
        calls = json.loads(CALLS_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        calls = []

    calls.append({
        "contact_name": follow_up.contact_name,
        "phone_number": follow_up.phone_number,
        "call_goal": follow_up.call_goal,
        "status": follow_up.status,
        "outcome": follow_up.outcome,
        "notes": follow_up.notes,
        "next_action": follow_up.next_action,
        "callback_at": follow_up.callback_at,
        "call_id": follow_up.call_id,
    })

    CALLS_FILE.write_text(json.dumps(calls, indent=2))


def update_follow_up(call_id, result):
    if not CALLS_FILE.exists():
        return False

    try:
        calls = json.loads(CALLS_FILE.read_text())
    except json.JSONDecodeError:
        return False

    for call in calls:
        if call.get("call_id") == call_id:
            call["status"] = "completed"
            call["outcome"] = result.get("outcome")
            call["notes"] = result.get("notes")
            call["next_action"] = result.get("next_action")
            call["callback_at"] = result.get("callback_at")
            CALLS_FILE.write_text(json.dumps(calls, indent=2))
            return True

    return False


def load_follow_ups():
    if not CALLS_FILE.exists():
        return []

    try:
        return json.loads(CALLS_FILE.read_text())
    except json.JSONDecodeError:
        return []