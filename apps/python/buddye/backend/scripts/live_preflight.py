#!/usr/bin/env python3
"""Everything that must be true before a live BuddyE sweep, checked without placing a call.

Run from `backend/`:  .venv/bin/python scripts/live_preflight.py

It never calls `calls.create`, `call plan` or `call run`. It reads configuration, runs the startup
checks the server itself runs, triages the open hazard, compiles the contract the first live dial
would send and asserts that schema against the documented CALL-E subset. Prints PASS/FAIL/WARN per
line and exits non-zero if anything that would break or endanger a live call is wrong. Phone numbers
are masked and no credential is printed.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.calls.budget import count_real_calls  # noqa: E402
from app.calls.contract import assert_calle_schema_subset, compile_contract  # noqa: E402
from app.calls.guards import UnapprovedBaseUrl, approved_calle_base_url, is_strict_e164  # noqa: E402
from app.calls.preflight import validate_startup  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import init_db, session_scope  # noqa: E402
from app.domain.risk import triage  # noqa: E402
from app.models import Hazard  # noqa: E402
from app.obs import mask_phone  # noqa: E402
from app.orchestrator.reconcile import reconciler_name  # noqa: E402
from app.orchestrator.sweep import hazard_view, load_roster, neighbour_view  # noqa: E402

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

    # --- provider, credentials, and the checks the server refuses to start without ------
    line(OK if s.CALL_PROVIDER in {"calle_sdk", "calle_mcp"} else BAD, "provider",
         f"CALL_PROVIDER={s.CALL_PROVIDER} (want calle_sdk or calle_mcp)")
    if s.CALL_PROVIDER == "calle_sdk":
        line(OK if s.CALLE_API_KEY else BAD, "CALL-E API key", "present" if s.CALLE_API_KEY else "missing")
        try:
            line(OK, "CALL-E base URL", approved_calle_base_url(s.CALLE_BASE_URL))
        except UnapprovedBaseUrl as exc:
            line(BAD, "CALL-E base URL", str(exc))
    for problem in validate_startup(s):
        line(BAD, "startup check", problem)

    # --- who may be rung --------------------------------------------------------------
    allow = s.dialable_numbers
    line(OK if allow else BAD, "dial allowlist", f"{len(allow)} number(s): {', '.join(mask_phone(n) for n in sorted(allow)) or 'EMPTY'}")
    for n in allow:
        if not is_strict_e164(n):
            line(BAD, "allowlist format", f"{mask_phone(n)} is not ASCII E.164 (+ then digits, no formatting)")

    init_db()
    with session_scope() as sess:
        used = count_real_calls(sess)
        line(OK if used < s.CALL_BUDGET_MAX else BAD, "call budget",
             f"{used}/{s.CALL_BUDGET_MAX} calls used, {max(0, s.CALL_BUDGET_MAX - used)} left")

        hazard = sess.exec(__import__("sqlmodel").select(Hazard).where(Hazard.status != "CLOSED")).first()
        line(OK if hazard else BAD, "open hazard", f"{hazard.kind}: {hazard.headline}" if hazard else "none; run POST /api/demo/reset")
        roster = load_roster(sess)
        by_id = {n.id: n for n in roster}
        dialable = [n for n in roster if n.check_in_consent and n.phone in allow]
        line(OK if dialable else BAD, "roster reachable",
             ", ".join(f"{n.name} {mask_phone(n.phone)}" for n in dialable)
             or "no consenting neighbour has an allowlisted number; set DEMO_PHONE_* and run POST /api/demo/reset")

        # --- the exact contract the first live dial would send ---------------------------
        if hazard and dialable:
            order = [a for a in triage(roster, hazard) if a.may_call]
            line(OK, "call order", " → ".join(a.name for a in order[:6]) + (" …" if len(order) > 6 else ""))
            first = next((by_id[a.neighbour_id] for a in order if by_id[a.neighbour_id].phone in allow), None)
            if first is None:
                line(BAD, "first live dial", "no allowlisted neighbour is in the call order")
            else:
                skipped = [a.name for a in order[: [a.neighbour_id for a in order].index(first.id)]]
                line(OK, "first live dial", first.name + (f"  (skips {', '.join(skipped)}: not allowlisted)" if skipped else ""))
                contract = compile_contract(hazard_view(hazard, s), neighbour_view(first))
                try:
                    assert_calle_schema_subset(contract.result_schema)
                    props = contract.result_schema["properties"]
                    line(OK, "compiled schema", f"{len(props)} fields, {len(contract.result_schema['required'])} required, "
                                                "inside the documented subset")
                except ValueError as exc:
                    line(BAD, "compiled schema", str(exc))
                line(OK, "task length", f"{len(contract.task)} chars, locale {contract.locale}")

    # --- webhook / inference -------------------------------------------------------------
    line(OK, "webhook mode", "polling only (PUBLIC_BASE_URL unset)" if not s.PUBLIC_BASE_URL
         else "webhook enabled (only POST /api/calle/webhook/{token} is reachable from outside)")
    name = reconciler_name(s)
    line(OK if name != "null" else WARN, "reconciler", name if name != "null" else "none: unknown fields stay unknown")

    print()
    if failures:
        print(f"{failures} blocking problem(s). Do not place a call yet.")
        return 1
    print("Ready. A live call will dial only the allowlisted number(s) above.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
