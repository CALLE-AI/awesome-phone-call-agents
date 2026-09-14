#!/usr/bin/env python3
"""No-network tests for RelayMe client helpers. Run: python3 test_client.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from client import validate_task, mask_phone, build_goal, _locale_for  # noqa: E402

failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        failures.append(name)


good = {
    "task_id": "t1", "to_phone_e164": "+15550000123",
    "business_display_name": "Shop", "question": "Open?",
    "caller_context": "asking hours", "consent": True,
}

# --- validate_task preflight ---
check("valid task passes", validate_task(good) == [])
check("consent false is rejected", any("consent" in p for p in validate_task({**good, "consent": False})))
check("bad phone is rejected", any("E.164" in p for p in validate_task({**good, "to_phone_e164": "5550123"})))
check("spaced phone is rejected (strict E.164)", any("E.164" in p for p in validate_task({**good, "to_phone_e164": "+1 555 000 0123"})))
check("missing question is rejected", any("question" in p for p in validate_task({**good, "question": ""})))
check("too many followups rejected", any("followups" in p for p in validate_task({**good, "allowed_followups": ["a", "b", "c", "d"]})))

# --- mask_phone ---
check("phone is masked", mask_phone("+15550000123") == "+1********23")
check("short phone masks safely", mask_phone("12") == "***")

# --- build_goal includes disclosure + the question + the caps ---
goal = build_goal(good)
check("goal discloses AI", "AI assistant" in goal)
check("goal contains the question", "Open?" in goal)
check("goal forbids commitments", "cancel anything" in goal)

# --- region/locale derivation for the REST path ---
check("English/US derives en-US", _locale_for(good) == ("US", "en-US"))
check("explicit locale is trusted", _locale_for({**good, "locale": "es-419", "region": "MX"}) == ("MX", "es-419"))
check("Spanish/US derives es-US", _locale_for({**good, "language": "Spanish"}) == ("US", "es-US"))
check("unknown language falls back to en", _locale_for({**good, "language": "Klingon"}) == ("US", "en-US"))

print()
if failures:
    print(f"{len(failures)} test(s) failed")
    sys.exit(1)
print("all tests passed")
