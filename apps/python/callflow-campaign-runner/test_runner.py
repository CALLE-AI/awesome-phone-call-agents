"""Verification for the campaign runner. Places no calls.

Run:  python test_runner.py

Uses no test framework so it runs anywhere the app runs. Exits non-zero on
failure.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from runner import (
    CAMPAIGNS,
    build_schema,
    check_dial,
    is_e164,
    mask,
    normalise,
    read_contacts,
    render_goal,
    triage,
)

FAILURES: list[str] = []


def check(label: str, condition: bool) -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        FAILURES.append(label)


# ------------------------------------------------------------- E.164 --
print("\nE.164 validation")
check("accepts +15555550100", is_e164("+15555550100"))
check("accepts +441632960100", is_e164("+441632960100"))
check("rejects missing country code", not is_e164("5555550100"))
check("rejects leading zero after +", not is_e164("+0123456789"))
check("rejects spaces", not is_e164("+1 555 555 0100"))
check("rejects empty", not is_e164(""))
check("rejects too short", not is_e164("+123"))

# ----------------------------------------------------------- masking --
print("\nMasking")
for number in ("+15555550100", "+441632960100", "5555550100"):
    masked = mask(number)
    check(
        f"{number} hides at least half ({masked})",
        masked.count("*") >= len(number) / 2,
    )
check("short input fully masked", mask("+123") == "***")

# ----------------------------------------------------- normalisation --
print("\nNormalisation")
check("strips punctuation", normalise("+1 555-555-0100") == "+15555550100")
check("converts 00 prefix", normalise("0015555550100") == "+15555550100")
check("adds country code to 10 digits", normalise("5555550100") == "+15555550100")
check("leaves E.164 untouched", normalise("+15555550100") == "+15555550100")
check("leaves garbage unchanged for rejection", not is_e164(normalise("not-a-number")))

# ---------------------------------------------------------- dial gate --
print("\nDial gate (fails closed)")
check(
    "allows a valid number",
    check_dial("+15555550100", 0, allowlist=[], ceiling=5).allowed,
)
check(
    "rejects an invalid number",
    not check_dial("5555550100", 0, allowlist=[], ceiling=5).allowed,
)
check(
    "enforces the per-run ceiling",
    not check_dial("+15555550100", 5, allowlist=[], ceiling=5).allowed,
)
check(
    "blocks a number outside the allowlist",
    not check_dial("+15555550100", 0, allowlist=["+15555550199"], ceiling=5).allowed,
)
check(
    "permits a number inside the allowlist",
    check_dial("+15555550199", 0, allowlist=["+15555550199"], ceiling=5).allowed,
)
check(
    "gate reason masks the number",
    "5555550" not in check_dial("5555550100", 0, allowlist=[], ceiling=5).reason,
)

# -------------------------------------------------------------- triage --
print("\nTriage precedence")
check(
    "do_not_call escalates even when positive",
    triage("completed", {"do_not_call": True, "sentiment": "positive"})[0] == "needs_human",
)
check(
    "explicit human request escalates",
    triage("completed", {"wants_human_callback": True})[0] == "needs_human",
)
check(
    "frustration escalates",
    triage("completed", {"frustration_signals": True})[0] == "needs_human",
)
check(
    "negative without frustration retries",
    triage("completed", {"sentiment": "negative", "frustration_signals": False})[0] == "retry",
)
check("no answer retries", triage("no_answer", {})[0] == "retry")
check("busy retries", triage("busy", {})[0] == "retry")
check("failed is unreachable", triage("failed", {})[0] == "unreachable")
check(
    "clean call auto-closes",
    triage("completed", {"sentiment": "positive"})[0] == "auto_closed",
)

# -------------------------------------------------------------- schema --
print("\nResult schema")
schema = CAMPAIGNS["travel"].schema
props = schema["properties"]
check("includes shared triage fields", all(
    k in props for k in ("sentiment", "frustration_signals", "do_not_call", "summary")
))
check("includes campaign-specific fields", "destination" in props and "party_size" in props)
check("marks triage fields required", "frustration_signals" in schema["required"])
check("custom schema merges cleanly", "x" in build_schema({"x": {"type": "string"}})["properties"])

# --------------------------------------------------------------- CSV --
print("\nCSV parsing")
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "c.csv"

    path.write_text(
        "name,phone,note\nAditi,+15555550100,Bali\nBad,not-a-number,x\n",
        encoding="utf-8",
    )
    rows = read_contacts(path, "1")
    check("reads a header row", len(rows) == 2 and rows[0]["name"] == "Aditi")
    check("normalises phones", rows[0]["phone"] == "+15555550100")
    check("keeps invalid rows for the gate to reject", not is_e164(rows[1]["phone"]))

    path.write_text("Aditi,+15555550100,Bali\n", encoding="utf-8")
    rows = read_contacts(path, "1")
    check("reads a headerless file", len(rows) == 1 and rows[0]["name"] == "Aditi")

    path.write_text("name,phone,note\nNoNote,+15555550100,\n", encoding="utf-8")
    rows = read_contacts(path, "1")
    check("defaults a missing note", rows[0]["note"] == "no note on file")

# ------------------------------------------------------ goal rendering --
print("\nGoal rendering")
goal = render_goal(CAMPAIGNS["travel"], {"name": "Aditi", "note": "Bali in December"})
check("injects the name", "Aditi" in goal)
check("injects the note", "Bali in December" in goal)
check("leaves no raw placeholders", "{" not in goal)
check("meets CALL-E's minimum task length", len(goal) > 40)

missing = render_goal(CAMPAIGNS["travel"], {"name": "Rahul"})
check("tolerates a missing note", "Rahul" in missing and "{note}" not in missing)

# -------------------------------------------------------------- report --
print()
if FAILURES:
    print(f"{len(FAILURES)} check(s) failed:")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)

print("All checks passed. No calls were placed.")
