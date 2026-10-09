"""Public CALL-E integration only. Contains no robot control implementation."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
import uuid

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["decision", "human_reached", "confirmation_quote"],
    "properties": {
        "decision": {"type": "string", "enum": ["turn_off_demo_light", "leave_unchanged", "unknown"],
            "description": "Use turn_off_demo_light only when the human confirms switching off the single demo light after the final read-back. Corrections replace earlier choices. Never infer permission from silence or voicemail."},
        "human_reached": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "confirmation_quote": {"type": "string", "description": "Exact words of the human's final confirmation after read-back, or empty if absent."}
    }
}
TASK = """You are the AI phone interface for a Unitree G1 robot. The recipient requested this callback demo.
Start: 'Hello, this is Unitree G1's AI phone interface. Would you like me to turn off the demo light?'
Only offer turning off the single designated demo light or leaving it unchanged. No other lights or robot movements are available in this demo.
If the human requests turning it off, read back: 'Turn off the demo light by pressing its switch. Is that correct?'
Wait for an explicit yes. If the user changes their mind, the latest instruction overrides the old one; confirm the updated choice.
On confirmation say: 'Confirmed. Your instruction has been recorded for review.' End promptly.
On no or uncertainty, say you will leave it unchanged and end. Do not leave voicemail and do not retry unanswered calls.
Do not claim the light is off or that the robot has moved. You do not receive hardware feedback during this conversation.
Use the name Unitree G1 only. Keep the conversation brief and natural in English.
"""

def phone(value):
    value = re.sub(r"[\s()-]", "", value)
    if value.startswith("+610"):
        value = "+61" + value[4:]
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
        raise ValueError("Provide an E.164 phone number including country code.")
    return value

def make_request(number, region, locale):
    return {"task": TASK, "recipients": [{"phones": [phone(number)], "region": region, "locale": locale}],
            "result_schema": SCHEMA, "metadata": {"integration": "unitree-g1-light-demo"}}

def extract_command(call):
    result = call.get("structured_result") or {}
    if call.get("status") != "completed" or result.get("human_reached") != "yes" or result.get("decision") != "turn_off_demo_light":
        return None
    turns = [turn for recipient in call.get("recipients", []) for attempt in recipient.get("attempts", [])
             for turn in attempt.get("transcript_turns", []) if turn.get("speaker") == "user"]
    norm = lambda text: " ".join(re.sub(r"[^\w\s]", " ", str(text).casefold()).split())
    quote = norm(result.get("confirmation_quote", ""))
    # Extraction is advisory. Restrict to an explicit final affirmative turn;
    # an ambiguous, negated or changed answer produces no command.
    affirmatives = {"yes", "yes please", "yes correct", "yes that is correct", "yes that s correct", "correct", "that is correct", "that s correct", "yes do it", "yes turn it off", "please do", "go ahead"}
    if not turns or quote not in affirmatives or norm(turns[-1].get("text", "")) != quote:
        return None
    return {"action": "turn_off_light", "target": "demo_light", "source_call_id": call.get("id"),
            "confirmation_quote": result["confirmation_quote"], "execution_status": "not_dispatched"}

class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the bearer credential away from the fixed provider URL.
        raise urllib.error.HTTPError(req.full_url, code, "Provider redirect refused", {}, None)


def api(path, payload=None, idem=None):
    key = os.environ.get("CALLE_API_KEY", "")
    if not key:
        raise ValueError("Set CALLE_API_KEY in the server environment.")
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if idem:
        headers["Idempotency-Key"] = idem
    request = urllib.request.Request("https://api.heycall-e.com/v1/" + path,
        data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    with urllib.request.build_opener(NoRedirects()).open(request, timeout=45) as response:
        return json.load(response)

def write_state(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(data, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("preview", help="No network, API key, calls or hardware required")
    start = sub.add_parser("call", help="Opt-in: place one real callback")
    start.add_argument("--phone", required=True)
    start.add_argument("--region", required=True)
    start.add_argument("--locale", required=True)
    start.add_argument("--live", action="store_true", help="Explicitly authorize this call")
    start.add_argument("--state", default=".state/call.json")
    poll = sub.add_parser("poll", help="Read existing call; never redials")
    poll.add_argument("--state", default=".state/call.json")
    args = parser.parse_args()
    if args.mode == "preview":
        print(json.dumps({"mode": "dry_run", "places_call": False, "controls_robot": False,
            "request": make_request("+12025550123", "US", "en-US"),
            "example_command_only": {"action": "turn_off_light", "target": "demo_light", "execution_status": "not_dispatched"}}, indent=2))
        return
    path = Path(args.state)
    if args.mode == "call":
        if not args.live:
            raise ValueError("Add --live only for a phone number you own or are authorized to call.")
        payload = make_request(args.phone, args.region, args.locale)
        if path.exists():
            state = json.loads(path.read_text())
            if state["request"] != payload:
                raise ValueError("Saved request differs. Use a new state file only for an intentionally new call.")
            if state.get("call_id"):
                print(json.dumps({"already_created": True, "call_id": state["call_id"], "next": "poll"}))
                return
        else:
            state = {"request": payload, "idempotency_key": "g1-light-" + uuid.uuid4().hex}
            write_state(path, state)
        # On a timeout, rerun with this exact state file. Never generate a new key.
        result = api("calls", state["request"], state["idempotency_key"])
        state["call_id"] = result["id"]
        state["latest"] = result
        write_state(path, state)
        print(json.dumps({"call_id": state["call_id"], "status": result.get("status")}))
    else:
        state = json.loads(path.read_text())
        if not state.get("call_id"):
            raise ValueError("No saved call ID. Recover the original create request using the same state file.")
        result = api("calls/" + state["call_id"])
        state["latest"] = result
        write_state(path, state)
        print(json.dumps({"status": result.get("status"), "command": extract_command(result)}, indent=2))

if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as exc:
        raise SystemExit("CALL-E returned HTTP %s. No automatic redial. Preserve your state file." % exc.code)
    except (ValueError, OSError, KeyError) as exc:
        raise SystemExit(str(exc))
