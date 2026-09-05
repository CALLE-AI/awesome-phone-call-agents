"""One call task → one scorecard. Deterministic first; the optional LLM evidence pass only adds citations."""
from __future__ import annotations

from typing import Any

from . import compliance, evidence, timing


def _turns(task: dict) -> list[dict]:
    out: list[dict] = []
    for r in task.get("recipients") or []:
        for a in r.get("attempts") or []:
            out.extend(a.get("transcript_turns") or [])
    return out


def schema_check(result: Any, schema: dict | None) -> dict:
    if schema is None:
        return {"checked": False, "valid": None, "errors": []}
    try:
        import jsonschema
        v = jsonschema.Draft202012Validator(schema)
        errs = [f"{'/'.join(str(p) for p in e.path) or '$'}: {e.message}" for e in v.iter_errors(result)]
        return {"checked": True, "valid": not errs, "errors": errs[:10]}
    except Exception as e:  # noqa: BLE001
        return {"checked": False, "valid": None, "errors": [str(e)[:200]]}


def review(task: dict, schema: dict | None = None, use_llm: bool = False) -> dict:
    turns = _turns(task)
    t = timing.analyze_turns(turns)
    comp = compliance.check(turns)
    result = task.get("structured_result")
    ev = evidence.deterministic(result, turns)
    llm_rows = evidence.llm(result, turns, task.get("task", "")) if use_llm else None
    if llm_rows:
        by = {r.get("field"): r for r in llm_rows}
        for row in ev:
            m = by.get(row["field"])
            if m is not None:
                row["supported"] = bool(m.get("supported"))
                row["how"] = "model read the transcript"
                row["turns"] = [int(x) for x in (m.get("turns") or []) if str(x).lstrip("-").isdigit()]
                row["note"] = str(m.get("note") or "")[:200]
    unsupported = [r for r in ev if r["supported"] is False]
    unknown = [r for r in ev if r["supported"] is None]
    sc = schema_check(result, schema)
    reasons: list[str] = []
    verdict = "approve"
    if task.get("status") != "completed":
        verdict = "reject"
        reasons.append(f"call {task.get('status')} ({task.get('failure_code') or 'no failure code'})")
    if sc["checked"] and not sc["valid"]:
        verdict = "reject"
        reasons.append("structured result does not match the schema")
    if unsupported:
        verdict = "reject" if verdict != "reject" else verdict
        reasons.append(f"{len(unsupported)} structured field(s) not supported by the transcript: " + ", ".join(r["field"] for r in unsupported[:4]))
    if comp["stop_requested"] and comp["stop_honored"] is False:
        verdict = "reject"
        reasons.append("callee asked to stop and the agent kept going")
    if not comp["ai_disclosed"] and turns:
        verdict = "needs_human" if verdict == "approve" else verdict
        reasons.append("no AI disclosure found in the agent's turns")
    if comp["sensitive_readback"]:
        verdict = "reject"
        reasons.append("agent read back a card/ID-like number")
    if t.p95 is not None and t.p95 > 6.0:
        verdict = "needs_human" if verdict == "approve" else verdict
        reasons.append(f"slow responses: p95 {t.p95}s")
    if t.overlaps >= 2:
        verdict = "needs_human" if verdict == "approve" else verdict
        reasons.append(f"{t.overlaps} overlapping turns (talking over the callee)")
    if unknown and verdict == "approve":
        reasons.append(f"{len(unknown)} field(s) could not be checked deterministically")
    conf = (task.get("completion_confidence") or {}).get("score")
    return {"call_id": task.get("id"), "verdict": verdict, "reasons": reasons, "task_completed": task.get("task_completed"), "completion_confidence": conf, "timing": t.as_dict(), "compliance": comp, "schema": sc, "evidence": ev, "unsupported_count": len(unsupported), "llm_used": bool(llm_rows)}
