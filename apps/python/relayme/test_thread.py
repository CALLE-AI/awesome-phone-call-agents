#!/usr/bin/env python3
"""No-network tests for the RelayMe conversation thread. Run: python3 test_thread.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from thread import (  # noqa: E402
    build_thread, redact, render_plaintext,
    ROLE_YOU, ROLE_RELAYME, ROLE_AGENT, ROLE_THEM,
)

failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        failures.append(name)


TASK = {"question": "Is my prescription ready?", "business_display_name": "Maple Pharmacy"}
TRANSCRIPT = [
    {"speaker": "agent", "text": "Hi, I'm an AI assistant calling for someone. Is the prescription ready?"},
    {"speaker": "callee", "text": "Yes, ready for pickup."},
]

# --- redaction ---
check("redacts email", "[email hidden]" in redact("mail me at jo@example.com please"))
check("redacts phone", "[number hidden]" in redact("call 555-123-4567 back"))
check("leaves clean text alone", redact("Is it ready?") == "Is it ready?")

# --- thread shape on a clean answered call ---
t = build_thread(TASK, {"outcome": "answered", "answer": "Yes, ready for pickup."}, TRANSCRIPT)
roles = [m.role for m in t]
check("thread opens with the user's request", roles[0] == ROLE_YOU)
check("plan is shown back before the call", roles[1] == ROLE_RELAYME)
check("agent turns are present", ROLE_AGENT in roles)
check("callee turns render as 'them'", ROLE_THEM in roles)
check("thread ends with the answer", t[-1].role == ROLE_RELAYME and "ready" in t[-1].text.lower())

# --- non-answer outcomes never carry an answer ---
t = build_thread(TASK, {"outcome": "voicemail", "answer": "should not appear"}, None)
joined = " ".join(m.text for m in t)
check("voicemail carries no leaked answer", "should not appear" not in joined)
check("voicemail explains what happened", "voicemail" in joined.lower())

t = build_thread(TASK, {"outcome": "needs_human", "answer": "x"}, None)
check("needs_human flags for a person", any("person" in m.text.lower() for m in t))

# --- user-embedded sensitive data is redacted in the thread ---
t = build_thread({"question": "Tell them my number is 555-987-6543", "business_display_name": "Shop"},
                 {"outcome": "answered", "answer": "ok"}, [])
check("user's own number is redacted in thread", "[number hidden]" in t[0].text)

# --- plaintext render smoke ---
check("plaintext render is non-empty", len(render_plaintext(t)) > 0)

print()
if failures:
    print(f"{len(failures)} test(s) failed")
    sys.exit(1)
print("all tests passed")
