# -*- coding: utf-8 -*-
"""Risk ranking and the batch loop.

The point is not to call everyone. It is to call the most urgent household first,
and to sort what comes back into buckets a human can act on.

Fail-closed twice over: unknown equipment is treated as the most critical, and an
unknown battery level is treated as already empty.
"""
from . import engine
from .adapters import FakeAdapter

# How dangerous losing power is for each equipment type.
EQUIPMENT_WEIGHT = {
    "ventilator": 3.0,          # measured in hours
    "unknown": 3.0,             # fail-closed: if we do not know, assume the worst
    "oxygen_concentrator": 2.5,
    "dialysis": 2.5,
    "suction_machine": 2.0,
    "power_wheelchair": 1.0,
}


def priority_score(case: dict) -> float:
    """Higher goes first. Equipment weight x10 plus battery urgency inside a 6-hour window."""
    weight = EQUIPMENT_WEIGHT.get(case.get("equipment_type", "unknown"), 3.0)
    battery = case.get("battery_hours_hint")
    if battery is None:
        battery = 0.0  # fail-closed: unknown battery is treated as depleted
    urgency = max(0.0, 6.0 - float(battery))
    return weight * 10.0 + urgency


def rank(cases: list) -> list:
    """Return a new list in call order. Stable: equal scores keep input order."""
    return sorted(cases, key=lambda c: -priority_score(c))


# Which bucket each terminal code lands in.
BOARD_BUCKETS = {
    "answered_needs_help": "needs_help",      # dispatch something
    "insufficient_data": "human_followup",    # a person should call back
    "wrong_person": "human_followup",
    "halted_safe": "human_followup",
    "no_answer": "retry_queue",
    "voicemail": "retry_queue",
    "answered_ok": "confirmed_safe",
    "declined": "do_not_disturb",             # respect it, do not call again
}


def run_batch(cases: list, mode: str = "dry_run", human_confirmed: bool = False,
              adapter=None) -> dict:
    """Rank, call each in order, bucket the results.

    Returns {"order": [case_id...], "board": {bucket: [result...]}, "results": [...]}.
    """
    adapter = adapter or FakeAdapter()
    ordered = rank(cases)
    board = {b: [] for b in ("needs_help", "human_followup", "retry_queue",
                             "confirmed_safe", "do_not_disturb")}
    results = []
    for case in ordered:
        call_input = {k: v for k, v in case.items() if k != "battery_hours_hint"}
        result = engine.run(call_input, mode=mode, human_confirmed=human_confirmed,
                            adapter=adapter)
        results.append(result)
        if mode != "dry_run":
            bucket = BOARD_BUCKETS.get(result["result_code"], "human_followup")
            board[bucket].append({
                "case_id": result["case_id"],
                "result_code": result["result_code"],
                "needs": (result["structured_result"] or {}).get("needs"),
                "confidence": result["completion_confidence"]["label"],
                "handoff_context": result["handoff_context"] if result["needs_human"] else None,
            })
    return {"order": [c["case_id"] for c in ordered], "board": board, "results": results}
