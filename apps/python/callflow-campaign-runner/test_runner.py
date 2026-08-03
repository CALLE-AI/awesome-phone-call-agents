"""Verification for the campaign runner. Places no calls.

Run:  python test_runner.py

Uses no test framework so it runs anywhere the app runs. Exits non-zero on
failure.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from runner import (
    CAMPAIGNS,
    build_schema,
    check_dial,
    idempotency_key,
    is_e164,
    load_dispatches,
    load_suppressions,
    mask,
    normalise,
    read_contacts,
    record_dispatch,
    record_suppression,
    redact,
    redact_result,
    render_goal,
    triage,
    validate_result,
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
check("leaves E.164 untouched", normalise("+15555550100") == "+15555550100")
check("leaves garbage unchanged for rejection", not is_e164(normalise("not-a-number")))

# A number with no country code must NOT be guessed — the same digits are a
# valid subscriber number in several countries.
check(
    "no country code is rejected, not guessed",
    not is_e164(normalise("5555550100")),
)
check(
    "--country-code opts into prefixing",
    normalise("5555550100", "1") == "+15555550100",
)
check(
    "--country-code respects the value given",
    normalise("1632960100", "44") == "+441632960100",
)

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


def complete(**overrides):
    """A fully trusted extraction result.

    Every consent field is present and correctly typed — anything less is
    refused by design, so tests must be explicit about what CALL-E returned.
    """
    return {
        "outcome": "interested",
        "sentiment": "neutral",
        "summary": "Sample summary.",
        "frustration_signals": False,
        "wants_human_callback": False,
        "do_not_call": False,
        "callback_agreed": False,
        **overrides,
    }


def trusted(**kw):
    """Args for a call CALL-E confirmed it completed with high confidence."""
    return {"task_completed": True, "confidence": 0.9, **kw}


print("\nTriage precedence")
check(
    "do_not_call escalates even when positive",
    triage("completed", complete(do_not_call=True, sentiment="positive"))[0]
    == "needs_human",
)
check(
    "explicit human request escalates",
    triage("completed", complete(wants_human_callback=True))[0] == "needs_human",
)
check(
    "frustration escalates",
    triage("completed", complete(frustration_signals=True))[0] == "needs_human",
)
check(
    "negative WITHOUT callback consent escalates",
    triage(
        "completed",
        complete(sentiment="negative", callback_agreed=False),
        **trusted(),
    )[0]
    == "needs_human",
)
check(
    "negative WITH callback consent retries",
    triage(
        "completed",
        complete(sentiment="negative", callback_agreed=True),
        **trusted(),
    )[0]
    == "retry",
)
check("no answer retries", triage("no_answer", {})[0] == "retry")
check("busy retries", triage("busy", {})[0] == "retry")
check("failed is unreachable", triage("failed", {})[0] == "unreachable")
check(
    "clean call auto-closes",
    triage("completed", complete(sentiment="positive"), **trusted())[0]
    == "auto_closed",
)

# --- result trust: everything must fail closed -------------------------
print("\nResult trust (fails closed)")
check(
    "incomplete result is not auto-closed",
    triage("completed", {"sentiment": "positive"}, **trusted())[0] == "needs_human",
)
check(
    "unmet goal escalates",
    triage("completed", complete(), task_completed=False, confidence=0.9)[0]
    == "needs_human",
)
check(
    "ABSENT task_completed escalates (absence is not success)",
    triage("completed", complete(), task_completed=None, confidence=0.9)[0]
    == "needs_human",
)
check(
    "low confidence escalates",
    triage("completed", complete(), task_completed=True, confidence=0.3)[0]
    == "needs_human",
)
check(
    "ABSENT confidence escalates",
    triage("completed", complete(), task_completed=True, confidence=None)[0]
    == "needs_human",
)
check(
    "malformed confidence escalates",
    triage("completed", complete(), task_completed=True, confidence="high")[0]  # type: ignore[arg-type]
    == "needs_human",
)

# A missing consent field is unknown, never permission.
for field in ("do_not_call", "wants_human_callback", "frustration_signals"):
    payload = complete()
    del payload[field]
    check(
        f"missing {field} escalates",
        triage("completed", payload, **trusted())[0] == "needs_human",
    )

# A string where a bool belongs is truthy in Python, so "no" would read as yes.
check(
    "string in place of a boolean escalates",
    triage("completed", complete(do_not_call="no"), **trusted())[0] == "needs_human",
)
check(
    "unrecognised sentiment escalates",
    triage("completed", complete(sentiment="furious"), **trusted())[0] == "needs_human",
)
check(
    "fully trusted result auto-closes",
    triage("completed", complete(sentiment="positive"), **trusted())[0]
    == "auto_closed",
)

# Truthy look-alikes must never read as a boolean answer. `"false"` is a
# non-empty string and therefore truthy in Python — the type check is what
# stops it being treated as an opt-out.
for bad in (1, 0, "true", "false", "", None, [], {}):
    check(
        f"do_not_call={bad!r} never auto-closes",
        triage("completed", complete(do_not_call=bad), **trusted())[0] != "auto_closed",
    )

check(
    "confidence exactly at the threshold passes",
    triage("completed", complete(), task_completed=True, confidence=0.6)[0]
    == "auto_closed",
)
check(
    "confidence just below the threshold escalates",
    triage("completed", complete(), task_completed=True, confidence=0.59)[0]
    == "needs_human",
)
check(
    "boolean confidence escalates (True is not a score)",
    triage("completed", complete(), task_completed=True, confidence=True)[0]
    == "needs_human",
)
check(
    "an uppercase status is still validated",
    triage("COMPLETED", {"sentiment": "positive"}, **trusted())[0] == "needs_human",
)
check(
    "an in-flight status never auto-closes on an empty result",
    all(
        triage(s, {})[0] != "auto_closed"
        for s in ("queued", "ringing", "in_progress", "")
    ),
)
check(
    "every problem is reported, not just the first",
    len(validate_result({"sentiment": 5})) >= 3,
)

# --- redaction ---------------------------------------------------------
print("\nRedaction of stored text")
for spoken, secret in [
    ("+1 555-555-0100", "5555550100"),
    ("555.555.0100", "5550100"),
    ("(555) 555-0100", "5550100"),
    ("+44 1632 960100", "1632960100"),
]:
    check(
        f"phone written as {spoken} is redacted",
        secret not in redact(f"Contact said {spoken}").replace(" ", ""),
    )
check(
    "email in a summary is redacted",
    "@example.com" not in redact("Email me at someone@example.com"),
)
check(
    "long digit runs are redacted",
    "4111111111111111" not in redact("My card is 4111111111111111"),
)
check("ordinary prose survives", "wants a quote" in redact("The contact wants a quote"))
check(
    "result summaries are redacted before storage",
    "5555550100"
    not in json.dumps(redact_result(complete(summary="reach me on 5555550100"))),
)
check("non-string values pass through", redact_result(complete())["do_not_call"] is False)

# --- idempotency & suppression ----------------------------------------
print("\nIdempotency and suppression")
check(
    "same batch produces the same key",
    idempotency_key("travel", "+15555550100", "b1")
    == idempotency_key("travel", "+15555550100", "b1"),
)
check(
    "different contacts get different keys",
    idempotency_key("travel", "+15555550100", "b1")
    != idempotency_key("travel", "+15555550101", "b1"),
)
check(
    "a new batch id allows a deliberate re-call",
    idempotency_key("travel", "+15555550100", "b1")
    != idempotency_key("travel", "+15555550100", "b2"),
)
check(
    "the key never contains the raw number",
    "5555550100" not in idempotency_key("travel", "+15555550100", "b1"),
)

# The key must bind what will actually be said and extracted. Otherwise
# editing a goal reuses a call placed under the old wording.
check(
    "a changed task changes the key",
    idempotency_key("travel", "+15555550100", "b1", task="Ask about Bali")
    != idempotency_key("travel", "+15555550100", "b1", task="Ask about Dubai"),
)
check(
    "a changed schema changes the key",
    idempotency_key("travel", "+15555550100", "b1", schema={"a": 1})
    != idempotency_key("travel", "+15555550100", "b1", schema={"a": 2}),
)
check(
    "identical task and schema give the same key",
    idempotency_key("travel", "+15555550100", "b1", task="x", schema={"a": 1})
    == idempotency_key("travel", "+15555550100", "b1", task="x", schema={"a": 1}),
)
check(
    "schema key order does not matter",
    idempotency_key("travel", "+15555550100", "b1", schema={"a": 1, "b": 2})
    == idempotency_key("travel", "+15555550100", "b1", schema={"b": 2, "a": 1}),
)

with tempfile.TemporaryDirectory() as tmp:
    ledger = str(Path(tmp) / "dispatched.txt")
    k = idempotency_key("travel", "+15555550100", "b1", task="x")
    record_dispatch(ledger, k, "travel", "requested")

    check("dispatch survives a restart", k in load_dispatches(ledger))
    check(
        "the ledger stores no raw numbers",
        "5555550100" not in Path(ledger).read_text(encoding="utf-8"),
    )
    check(
        "an unrelated key is not treated as dispatched",
        idempotency_key("travel", "+15555550199", "b1", task="x")
        not in load_dispatches(ledger),
    )

with tempfile.TemporaryDirectory() as tmp:
    supp = str(Path(tmp) / "dnc.txt")
    record_suppression(supp, "+15555550100", "travel")
    loaded = load_suppressions(supp)
    check("opt-out is persisted", len(loaded) == 1)
    check(
        "suppressed number is blocked",
        not check_dial(
            "+15555550100", 0, allowlist=[], ceiling=5, suppressed=loaded
        ).allowed,
    )
    check(
        "other numbers still dialable",
        check_dial("+15555550101", 0, allowlist=[], ceiling=5, suppressed=loaded).allowed,
    )
    check(
        "the file stores no raw numbers",
        "5555550100" not in Path(supp).read_text(encoding="utf-8"),
    )
    check(
        "opt-out beats the allowlist",
        not check_dial(
            "+15555550100",
            0,
            allowlist=["+15555550100"],
            ceiling=5,
            suppressed=loaded,
        ).allowed,
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
