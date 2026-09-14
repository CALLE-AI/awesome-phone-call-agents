#!/usr/bin/env python3
"""No-network tests for the CALL-E REST client. Run: python3 test_calle_rest.py

Covers the review Must Fix items for this path: approved-origin pinning,
redirect refusal (so the Bearer key cannot leak off-origin), the full-E.164
guard and required region/locale on create, safe (non-raw) provider error
messages, and the recipient/attempt result mapping in parse_terminal.

Nothing here touches the network: create_call and _request are only reached
through argument validation that fails before any socket is opened.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import calle_rest  # noqa: E402
from calle_rest import RestError  # noqa: E402

failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        failures.append(name)


def expect_raises(name, fn, exc=RestError):
    try:
        fn()
        check(name, False)
    except exc:
        check(name, True)


# --- approved-origin pinning (credentials never leave an approved HTTPS host) ---
calle_rest._require_approved_origin("https://api.heycall-e.com")  # must not raise
check("approved https origin accepted", True)
expect_raises("plaintext http origin refused",
              lambda: calle_rest._require_approved_origin("http://api.heycall-e.com"))
expect_raises("unapproved https origin refused",
              lambda: calle_rest._require_approved_origin("https://evil.example.com"))

# --- create_call fails closed before any network on a bad destination / origin ---
SCHEMA = {"answer": "string", "outcome": "string"}
expect_raises("create refuses a non-E.164 destination", lambda: calle_rest.create_call(
    api_key="k", to_phone_e164="5550123", task="t", result_schema=SCHEMA,
    idempotency_key="i", region="US", locale="en-US"))
expect_raises("create refuses a missing region/locale", lambda: calle_rest.create_call(
    api_key="k", to_phone_e164="+15550000123", task="t", result_schema=SCHEMA,
    idempotency_key="i", region="", locale=""))
expect_raises("create refuses an unapproved origin", lambda: calle_rest.create_call(
    api_key="k", to_phone_e164="+15550000123", task="t", result_schema=SCHEMA,
    idempotency_key="i", region="US", locale="en-US",
    api_base="https://evil.example.com"))

# --- redirect handler refuses to forward credentials off-origin ---
expect_raises("redirect off-origin is refused", lambda: calle_rest._NoRedirect().redirect_request(
    None, None, 302, "Found", {}, "https://evil.example.com/steal"))

# --- provider errors are summarised, never surfaced raw ---
check("401 maps to a safe auth message",
      "authentication" in calle_rest._safe_status_message(401))
check("422 maps to a safe invalid message",
      "invalid" in calle_rest._safe_status_message(422))
check("5xx maps to a safe server message",
      "server error" in calle_rest._safe_status_message(503))

# --- parse_terminal maps recipients[].attempts[].transcript_turns + speakers ---
CALL = {
    "status": "completed",
    "task_completed": True,
    "recipients": [{
        "structured_result": {
            "answer": "Yes, ready.", "outcome": "answered",
            "transcript_summary": "Confirmed ready.",
            "follow_up_needed": False, "disclosed_ai": True,
        },
        "attempts": [{
            "transcript_turns": [
                {"speaker": "bot", "text": "Is it ready?"},
                {"speaker": "user", "text": "Yes, ready."},
            ],
        }],
    }],
}
raw, transcript = calle_rest.parse_terminal(CALL)
check("parse_terminal reads the per-recipient structured_result",
      raw["outcome"] == "answered" and raw["answer"] == "Yes, ready.")
check("parse_terminal normalises bot -> agent",
      transcript[0]["speaker"] == "agent")
check("parse_terminal normalises user -> callee",
      transcript[1]["speaker"] == "callee")

# outcome is derived from status when the schema didn't set one
DERIVED = {"status": "voicemail", "recipients": [{"attempts": [{"transcript_turns": []}]}]}
raw2, _ = calle_rest.parse_terminal(DERIVED)
check("parse_terminal derives voicemail from status", raw2["outcome"] == "voicemail")

print()
if failures:
    print(f"{len(failures)} test(s) failed")
    sys.exit(1)
print("all tests passed")
