#!/usr/bin/env python3
"""Everything that must be true before a live call, checked without placing one.

Run from `backend/`:  .venv/bin/python scripts/live_preflight.py

It never calls `calls.create`, `call plan`, or `call run`. It reads configuration, compiles the
contract the next dial would send, asserts that schema against the documented CALL-E subset, and
optionally pokes the inference endpoint with a two-token completion. Prints PASS/FAIL per line and
exits non-zero if anything that would break a live call is wrong.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.calls.budget import count_real_calls  # noqa: E402
from app.calls.guards import UnapprovedBaseUrl, approved_calle_base_url, is_strict_e164  # noqa: E402
from app.calls.contract import CandidateView, assert_calle_schema_subset, compile_contract  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import init_db, session_scope  # noqa: E402
from app.domain.ranking import pay_for, rank_candidates  # noqa: E402
from app.models import Employee, Position  # noqa: E402
from app.obs import mask_phone  # noqa: E402
from app.orchestrator.reconcile import reconciler_name  # noqa: E402

OK, BAD, WARN = "PASS", "FAIL", "WARN"
failures = 0


def line(status: str, label: str, detail: str = "") -> None:
    global failures
    if status == BAD:
        failures += 1
    print(f"[{status}] {label}" + (f" — {detail}" if detail else ""))


def main() -> int:
    s = get_settings()
    print("BuddyE live-call preflight. Places nothing.\n")

    # --- provider and credentials -------------------------------------------------
    line(OK if s.CALL_PROVIDER == "calle_sdk" else BAD, "provider", f"CALL_PROVIDER={s.CALL_PROVIDER} (want calle_sdk)")
    line(OK if s.CALLE_API_KEY else BAD, "CALL-E API key", f"present, {len(s.CALLE_API_KEY)} chars" if s.CALLE_API_KEY else "missing")
    try:
        line(OK, "CALL-E base URL", approved_calle_base_url(s.CALLE_BASE_URL))
    except UnapprovedBaseUrl as exc:
        line(BAD, "CALL-E base URL", str(exc))
    try:
        import calle  # noqa: F401

        line(OK, "calle-ai SDK", "importable")
    except Exception as exc:  # noqa: BLE001
        line(BAD, "calle-ai SDK", str(exc))

    # --- the two gates that stop a stranger being dialled -------------------------
    allow = s.dialable_numbers
    line(OK if allow else BAD, "dial allowlist", f"{len(allow)} number(s): {', '.join(mask_phone(n) for n in allow) or 'EMPTY'}")
    for n in allow:
        if not is_strict_e164(n):
            line(BAD, "allowlist format", f"{mask_phone(n)} is not ASCII E.164 (+ then digits, no formatting)")

    init_db()
    with session_scope() as sess:
        used = count_real_calls(sess)
        pos = sess.exec(  # the open shift the demo will fill
            __import__("sqlmodel").select(Position).where(Position.status.in_(["OPEN", "FILLING"]))  # type: ignore[attr-defined]
        ).first()
        emps = sess.exec(__import__("sqlmodel").select(Employee)).all()
        dialable = [e for e in emps if e.phone in allow]
        line(
            OK if used < s.CALL_BUDGET_MAX else BAD,
            "call budget",
            f"{used}/{s.CALL_BUDGET_MAX} accepted calls used, {max(0, s.CALL_BUDGET_MAX - used)} left",
        )
        line(
            OK if dialable else BAD,
            "roster reachable",
            ", ".join(f"{e.name} {mask_phone(e.phone)}" for e in dialable) or "no seeded employee has an allowlisted number; run POST /api/demo/reset after setting DEMO_PHONE_*",
        )
        line(OK if pos else BAD, "open position", f"{pos.title} {pos.shift_date} {pos.start_time}-{pos.end_time}" if pos else "none")

        # --- the exact contract the next dial would send --------------------------
        if pos and dialable:
            ranked = [r for r in rank_candidates(sess, pos) if r["disqualified"] is None]
            queue = [r["name"] for r in ranked]
            first_dialable = next((r for r in ranked if sess.get(Employee, r["employee_id"]).phone in allow), None)  # type: ignore[union-attr]
            skipped_first = [r["name"] for r in ranked[: (ranked.index(first_dialable) if first_dialable else 0)]]
            line(OK, "candidate queue", " → ".join(queue[:6]) + (" …" if len(queue) > 6 else ""))
            line(
                OK if first_dialable else BAD,
                "first live dial",
                f"{first_dialable['name']}"
                + (f"  (skips {', '.join(skipped_first)}: not allowlisted)" if skipped_first else "")
                if first_dialable else "no allowlisted candidate is eligible",
            )
            if first_dialable:
                emp = sess.get(Employee, first_dialable["employee_id"])
                assert emp is not None
                from app.domain.requirements import parse_requirements
                from app.domain.terms import parse_terms
                from app.calls.contract import PositionView

                view = PositionView(
                    title=pos.title, role=pos.role, business_name=pos.business_name, shift_date=pos.shift_date,
                    start_time=pos.start_time, end_time=pos.end_time, hourly_rate=pos.hourly_rate,
                    requirements=parse_requirements(pos.requirements), terms=parse_terms(pos.terms), notes=pos.notes,
                )
                pay = pay_for(pos, emp)
                contract = compile_contract(view, CandidateView(name=emp.name, first_name=emp.name.split()[0],
                                                                preferred_language=emp.preferred_language), pay)
                try:
                    assert_calle_schema_subset(contract.result_schema)
                    props = contract.result_schema["properties"]
                    nested = sum(1 for v in props.values() if v.get("type") == "object")
                    line(OK, "compiled schema", f"{len(props)} fields, {nested} nested object, "
                                                f"{len(contract.result_schema['required'])} required, inside the documented subset")
                except ValueError as exc:
                    line(BAD, "compiled schema", str(exc))
                line(OK, "task length", f"{len(contract.task)} chars, locale {contract.locale}")
                line(OK, "terms to state", f"{len(contract.disclosures)} ({len(contract.material_terms)} material)")
                line(OK, "pay to disclose", f"${pay.gross_estimate} gross, {pay.overtime_hours}h overtime at ${pay.overtime_rate}")

    # --- webhook / inference ------------------------------------------------------
    line(OK, "webhook mode", "polling only (PUBLIC_BASE_URL unset)" if not s.PUBLIC_BASE_URL else f"webhook to {s.PUBLIC_BASE_URL}")
    name = reconciler_name(s)
    line(OK if name != "null" else WARN, "reconciler", f"{name} ({s.RECONCILE_MODEL})" if name == "glm" else name)
    if name == "glm":
        try:
            asyncio.run(_ping_inference(s))
            line(OK, "inference endpoint", f"{s.TOKENROUTER_BASE_URL} answered")
        except Exception as exc:  # noqa: BLE001
            line(WARN, "inference endpoint", f"{type(exc).__name__}: {exc}  (reconcile degrades to 'unknown', run still safe)")

    print()
    if failures:
        print(f"{failures} blocking problem(s). Do not place a call yet.")
        return 1
    print("Ready. A live call will dial only the allowlisted number(s) above.")
    return 0


async def _ping_inference(s) -> None:  # noqa: ANN001
    from openai import AsyncOpenAI

    client = AsyncOpenAI(base_url=s.TOKENROUTER_BASE_URL, api_key=s.TOKENROUTER_API_KEY, timeout=20.0, max_retries=0)
    await client.chat.completions.create(
        model=s.RECONCILE_MODEL, messages=[{"role": "user", "content": "Reply with the single word: ready"}],
        temperature=0, max_tokens=8,
    )


if __name__ == "__main__":
    raise SystemExit(main())
