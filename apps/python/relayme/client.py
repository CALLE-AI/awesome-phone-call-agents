#!/usr/bin/env python3
"""RelayMe: place one disclosed CALL-E call for a user who cannot use the phone,
and return the call to them as a text thread plus a fail-closed structured result.

Mock mode (default) runs with no credentials and no network: it reserves the
task, replays a fixture transcript, and runs it through the same classifier and
thread builder the live path uses. The --execute path drives the real `calle`
CLI:

    calle call plan  --to-phone <E164> --goal "<text>"   -> plan_id, confirm_token
    calle call run   --plan-id <id> --confirm-token <t>  -> run_id
    calle call status --run-id <id>                      -> get_call_run result

Live results are read from the CLI envelope at result.structuredContent (plan)
and status_result.structuredContent (status), per the CALL-E CLI reference.

Safety is enforced in code, not just prose:
  - reserve-before-dial idempotency (dispatch.ReservationStore)
  - the agent may ask only pre-authorized follow-ups (dispatch.enforce_followup_budget)
  - results fail closed and an answer is dropped unless the transcript supports
    it and the call disclosed it was AI (dispatch.classify)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dispatch import (  # noqa: E402
    ReservationStore, DispatchError, classify, enforce_followup_budget,
)
from thread import build_thread, thread_to_dicts, render_plaintext  # noqa: E402

DEFAULT_STORE = Path(__file__).parent / ".reservations.json"


def mask_phone(e164: str) -> str:
    """Show only the last 2 digits: +15550000123 -> +1********23."""
    if not e164 or len(e164) < 4:
        return "***"
    return e164[:2] + "*" * (len(e164) - 4) + e164[-2:]


def build_goal(task: dict) -> str:
    """Render the CALL-E goal from the task, matching SKILL.md's goal template."""
    followups = enforce_followup_budget(task.get("allowed_followups"))
    followups_text = "; ".join(followups) if followups else "none"
    return (
        "You are an AI phone assistant calling on behalf of a person who cannot "
        "use the phone directly. Disclose immediately and clearly that you are an "
        "AI assistant making this call for someone, and that this is one short call.\n\n"
        f"You are calling {task['business_display_name']}. "
        f"Reason for the call: {task['caller_context']}.\n\n"
        f'Ask this one question and listen carefully: "{task["question"]}"\n\n'
        f"If the answer is incomplete, you may ask only these follow-ups: {followups_text}. "
        "Ask nothing else. Do not give medical, legal, or financial advice. Do not "
        "agree to, book, buy, or cancel anything on the caller's behalf. Do not share "
        "personal details about the caller beyond the reason for the call.\n\n"
        "Capture the answer in the caller's own terms. If the person is unsure, record "
        "that as unknown rather than guessing. If you reach voicemail, do not leave "
        "sensitive details; record that it was voicemail. Thank them and end the call."
    )


def validate_task(task: dict) -> list[str]:
    """Fail-closed preflight. Returns a list of problems (empty == ok)."""
    problems = []
    for field in ("task_id", "to_phone_e164", "business_display_name", "question", "caller_context"):
        if not task.get(field):
            problems.append(f"missing required field: {field}")
    if task.get("consent") is not True:
        problems.append("consent must be true (the user must authorize this one call)")
    phone = task.get("to_phone_e164", "")
    if phone and not (phone.startswith("+") and phone[1:].isdigit()):
        problems.append("to_phone_e164 must be E.164, e.g. +15550000123")
    followups = task.get("allowed_followups") or []
    if len(followups) > 3:
        problems.append("allowed_followups is capped at 3")
    return problems


def print_preview(task: dict, goal: str) -> None:
    print("=" * 68)
    print("RelayMe call preview  (no call is placed in this step)")
    print("=" * 68)
    print(f"  Task ID:      {task['task_id']}")
    print(f"  Calling:      {task['business_display_name']}")
    print(f"  Number:       {mask_phone(task['to_phone_e164'])}")
    print(f"  Idempotency:  relayme:{task['task_id']}")
    print("\n  Question the agent will ask:")
    print(f'    "{task["question"]}"')
    print("\n  Full CALL-E goal:")
    for line in goal.splitlines():
        print(f"    {line}")
    print("=" * 68)


def _calle(argv: list[str]) -> dict:
    """Run a `calle` CLI command and return parsed JSON stdout."""
    proc = subprocess.run(["calle", *argv], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"calle {' '.join(argv)} failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def run_live(task: dict, goal: str, poll_seconds: int = 10, max_polls: int = 30) -> tuple[dict, list[dict]]:
    """Drive the real CALL-E plan -> run -> status flow. Returns (raw_result, transcript)."""
    plan_argv = ["call", "plan", "--to-phone", task["to_phone_e164"], "--goal", goal]
    for opt in ("language", "region", "timezone"):
        if task.get(opt):
            plan_argv += [f"--{opt}", task[opt]]
    plan = _calle(plan_argv).get("result", {}).get("structuredContent", {})
    if not plan.get("plan_id") or plan.get("ready_to_run") is False:
        return {"outcome": "needs_human",
                "transcript_summary": "Call could not be planned; clarification needed."}, []

    run = _calle(["call", "run", "--plan-id", plan["plan_id"],
                  "--confirm-token", plan["confirm_token"]])
    run_id = run.get("run_id") or run.get("status_result", {}).get("structuredContent", {}).get("run_id")
    if not run_id:
        return {"outcome": "needs_human",
                "transcript_summary": "Call run did not return a stable run_id; recover manually."}, []

    for _ in range(max_polls):
        status = _calle(["call", "status", "--run-id", run_id])
        sc = status.get("status_result", {}).get("structuredContent", {})
        if sc.get("state") in {"completed", "failed", "ended"} or sc.get("structured_result"):
            raw = sc.get("structured_result", sc)
            transcript = sc.get("transcript") or raw.get("transcript") or []
            return raw, transcript
        time.sleep(poll_seconds)
    return {"outcome": "needs_human",
            "transcript_summary": "Call did not reach a terminal state within the polling window."}, []


def main() -> int:
    ap = argparse.ArgumentParser(description="RelayMe: text-first phone relay via CALL-E.")
    ap.add_argument("--task", required=True, help="path to task JSON")
    ap.add_argument("--mock", action="store_true", help="no-call replay (default if --execute absent)")
    ap.add_argument("--execute", action="store_true", help="place a real CALL-E call (requires calle auth)")
    ap.add_argument("--fixture", default=None, help="fixture path for mock mode")
    ap.add_argument("--thread", action="store_true", help="print the user-facing text thread")
    ap.add_argument("--emit-thread-json", default=None, help="write web-view thread JSON to this path")
    ap.add_argument("--store", default=str(DEFAULT_STORE), help="reservation store path")
    args = ap.parse_args()

    task = json.loads(Path(args.task).read_text())

    problems = validate_task(task)
    if problems:
        print("Preflight failed:")
        for p in problems:
            print(f"  - {p}")
        return 2

    goal = build_goal(task)
    print_preview(task, goal)

    # Reserve before any dial. A second run of the same task_id is refused.
    store = ReservationStore(args.store)
    try:
        store.reserve(task["task_id"])
    except DispatchError as e:
        print(f"\nRefusing to dial: {e}")
        return 3

    try:
        if not args.execute:
            fixture_path = Path(args.fixture) if args.fixture else (
                Path(__file__).parent / "fixtures" / "answered.json"
            )
            fixture = json.loads(fixture_path.read_text())
            transcript = fixture.get("mock_transcript", [])
            print("\n[mock] Replaying fixture transcript (no live call):\n")
            for turn in transcript:
                who = "Agent " if turn["speaker"] == "agent" else "Callee"
                print(f"    {who}: {turn['text']}")
            raw = fixture.get("structured_result", {})
        else:
            print("\n[live] Placing a real call via CALL-E...")
            raw, transcript = run_live(task, goal)

        result = classify(raw, transcript)
    finally:
        # Terminal outcome releases the reservation; uncertain holds it for recovery.
        try:
            store.complete(task["task_id"], result["outcome"] if "result" in dir() else "needs_human")
        except Exception:
            pass

    print("\nStructured result:")
    print(json.dumps(result, indent=2))

    thread = build_thread(task, result, transcript)

    if args.thread:
        print("\nText thread (what the user reads):\n")
        print(render_plaintext(thread))

    if args.emit_thread_json:
        payload = {
            "outcome": result["outcome"],
            "outcome_text": result["transcript_summary"] or result["outcome"],
            "messages": thread_to_dicts(thread),
        }
        Path(args.emit_thread_json).write_text(json.dumps(payload, indent=2))
        print(f"\nWrote web-view thread JSON to {args.emit_thread_json}")

    print(f"\nOutcome: {result['outcome']}")
    if result["outcome"] in {"answered", "partial"} and result["answer"]:
        print(f"Answer for the user:\n  {result['answer']}")
    else:
        print("No confirmed answer surfaced. Routed for a human where needed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
