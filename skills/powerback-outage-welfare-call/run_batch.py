# -*- coding: utf-8 -*-
"""Batch runner for the PowerBack outage welfare call skill.

Nothing here dials a real number. The default is dry-run, and the only adapter
wired in is the local FakeAdapter. Live calling lives behind two in-code gates
plus an environment gate, and is deliberately not exposed as a CLI flag.

    python run_batch.py                  rank only, dry-run
    python run_batch.py --show-preview   also print the pre-call consent preview
    python run_batch.py --simulate       full loop with FakeAdapter, prints the triage board
    python run_batch.py --simulate --json  also write ui data for a board page
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from scripts import consent, triage  # noqa: E402


def _wrap(text: str, width: int) -> list:
    """Wrap without pulling in a dependency."""
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def _print_preview(cases: list, show_all: bool) -> None:
    """Print the pre-call consent preview: what the operator approves before dialling."""
    print("\nPre-call consent preview (consent-first: no dial without this step)")
    shown = cases if show_all else cases[:1]
    for case in shown:
        p = consent.build_preview(case)
        print(f"  Case: {p['case_id']}")
        print(f"  Callee (masked): {p['phone_masked']}")
        print(f"  Scenario: {p['scenario']} ({p['language']})")
        print(f"  Disclosure allowlist (the agent is told to say ONLY these): "
              f"{', '.join(p['disclosure_allowlist'])}")
        print("  What the agent will be told to say "
              "(first sentence is always the AI disclosure):")
        for line in _wrap(p["task_text"], 88):
            print(f"    {line}")
    if not show_all and len(cases) > 1:
        print(f"  ({len(cases) - 1} more cases, same shape - "
              f"use --show-preview-all to print them)")


def main() -> int:
    simulate = "--simulate" in sys.argv
    show_all = "--show-preview-all" in sys.argv
    show_preview = "--show-preview" in sys.argv or show_all

    roster_path = os.path.join(os.path.dirname(__file__), "assets", "synthetic_roster.json")
    with open(roster_path, encoding="utf-8") as f:
        cases = json.load(f)

    mode = "live" if simulate else "dry_run"
    out = triage.run_batch(cases, mode=mode, human_confirmed=simulate)

    print("Call priority (ranked by risk - most urgent first):")
    for i, cid in enumerate(out["order"], 1):
        print(f"  {i}. {cid}")

    if show_preview:
        by_id = {c["case_id"]: c for c in cases}
        _print_preview([by_id[cid] for cid in out["order"]], show_all)

    if simulate:
        print("\nTriage board:")
        for bucket, items in out["board"].items():
            print(f"  [{bucket}] {len(items)} case(s)")
            for it in items:
                print(f"    - {it['case_id']} {it['result_code']} "
                      f"needs={it['needs']} conf={it['confidence']}")
                # Anything routed to a human shows exactly what crosses the boundary.
                if it.get("handoff_context"):
                    print("      Handoff context (allowlisted fields only):")
                    for k, v in it["handoff_context"].items():
                        print(f"        {k}: {v}")
    elif not show_preview:
        print("\n(dry-run: nothing was dialled. Use --simulate for the full FakeAdapter loop)")

    if "--json" in sys.argv:
        import datetime
        ui_dir = os.path.join(os.path.dirname(__file__), "ui")
        os.makedirs(ui_dir, exist_ok=True)
        payload = {
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "mode": mode,
            "order": out["order"],
            "board": out["board"],
        }
        with open(os.path.join(ui_dir, "data.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        print(f"ui/data.json written ({payload['generated_at']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
