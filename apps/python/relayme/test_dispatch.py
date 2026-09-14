#!/usr/bin/env python3
"""No-network tests for dispatch safety. Run: python3 test_dispatch.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dispatch import (  # noqa: E402
    ReservationStore, DispatchError, classify, enforce_followup_budget,
)

failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        failures.append(name)


def expect_raises(name, fn):
    try:
        fn()
        check(name, False)
    except DispatchError:
        check(name, True)


CALLEE_TURN = [{"speaker": "agent", "text": "Is it ready?"},
               {"speaker": "callee", "text": "Yes, ready."}]

with tempfile.TemporaryDirectory() as d:
    store = ReservationStore(Path(d) / "res.json")

    # reserve-before-dial
    store.reserve("task-1")
    check("first reserve succeeds", store.status("task-1").state == "reserved")
    expect_raises("second reserve of same task is refused", lambda: store.reserve("task-1"))

    # terminal outcome completes; uncertain holds
    store.complete("task-1", "answered")
    check("terminal outcome marks done", store.status("task-1").state == "done")

    store.reserve("task-2")
    store.complete("task-2", "needs_human")  # uncertain -> held
    check("uncertain outcome holds reservation", store.status("task-2").state == "reserved")
    expect_raises("held task cannot be redialled", lambda: store.reserve("task-2"))

    expect_raises("empty task_id refused", lambda: store.reserve(""))

# corrupt journal fails closed
with tempfile.TemporaryDirectory() as d:
    p = Path(d) / "bad.json"
    p.write_text("{ not json")
    store = ReservationStore.__new__(ReservationStore)
    store.path = p
    expect_raises("corrupt journal refuses to dial", lambda: store.reserve("x"))

# --- classifier: fail closed ---
r = classify({"outcome": "answered", "answer": "Yes, ready.", "disclosed_ai": True}, CALLEE_TURN)
check("supported+disclosed answer survives", r["outcome"] == "answered" and r["answer"] == "Yes, ready.")

r = classify({"outcome": "answered", "answer": "Yes", "disclosed_ai": True}, transcript=None)
check("answer with no callee turn -> needs_human", r["outcome"] == "needs_human" and r["answer"] == "")

r = classify({"outcome": "answered", "answer": "Yes", "disclosed_ai": False}, CALLEE_TURN)
check("undisclosed AI -> needs_human", r["outcome"] == "needs_human")

r = classify({"outcome": "banana", "answer": "x"}, CALLEE_TURN)
check("unknown outcome -> needs_human", r["outcome"] == "needs_human")

r = classify({"outcome": "voicemail", "answer": "leak"}, CALLEE_TURN)
check("voicemail blanks the answer", r["answer"] == "")

# --- followup budget ---
check("valid followups pass", enforce_followup_budget(["a", "b"]) == ["a", "b"])
check("blank followups dropped", enforce_followup_budget(["a", "  ", ""]) == ["a"])
expect_raises("too many followups refused", lambda: enforce_followup_budget(["a", "b", "c", "d"]))

print()
if failures:
    print(f"{len(failures)} test(s) failed")
    sys.exit(1)
print("all tests passed")
