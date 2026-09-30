"""Command line for Muster.

No subcommand places a real call except `run --live`, which additionally
requires CALLE_API_KEY and an explicit `--i-have-authorisation` flag. Every
other path is a preview or a scripted demo.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from .safety import redact
from . import adversary, backtest, cadence, calle, demo, ladder, register, roster
from .models import Attestation
from .runner import Plan, payload_for, plan_call, run_cycle

SCHEME = "the Northern Counties Pension Scheme"


def _cycle() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _print_attestation(plan: Plan, attestation: Attestation) -> None:
    print(f"  subject      {plan.subject.display_name}  ({plan.subject.subject_id})")
    print(f"  number       {plan.masked_phone()}")
    print(f"  grade        {attestation.grade.value}")
    print(f"  reasons      {', '.join(attestation.reasons)}")
    print(f"  nonce ok     {attestation.nonce_ok}")
    print(f"  challenges   {attestation.challenges_passed}/{attestation.challenges_asked}")
    print(f"  coaching     {attestation.coaching_suspected}")
    print(f"  auto-closes  {attestation.auto_closes}")
    print(f"  stops pay    {attestation.stops_payment}")
    for quote in attestation.evidence_quotes:
        print(f"    > {redact(quote)}")


def cmd_roster(_: argparse.Namespace) -> int:
    for subject in roster.ROSTER:
        flags = "needs-human" if subject.accessibility.requires_human_path else ""
        print(f"{subject.subject_id}  {subject.display_name:<22} {subject.reference:<10} {flags}")
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    """Show exactly what would be said and sent. Places no call."""
    plan = plan_call(roster.get(args.subject), args.cycle or _cycle(), SCHEME)
    print(f"number (masked)  {plan.masked_phone()}")
    print(f"idempotency key  {plan.idempotency_key}")
    print(f"challenge        {plan.issued_nonce.words} / {plan.issued_nonce.weekday}")
    print(f"prompts          {[p.prompt_id for p in plan.prompts]}")
    print("\n--- what the agent says ---")
    print(redact(plan.task_text))
    if args.show_payload:
        body = payload_for(plan)
        body["recipients"] = [{"phones": [plan.masked_phone()]}]
        print("\n--- POST /v1/calls (number masked) ---")
        print(json.dumps(body, indent=2))
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    """Run scripted calls through the real extraction and grading path."""
    cycle = args.cycle or _cycle()
    subjects = [roster.get(args.subject)] if args.subject else list(roster.ROSTER)
    for subject in subjects:
        scenario = args.scenario or demo.SUBJECT_SCENARIOS.get(subject.subject_id, "clean")
        plan = plan_call(subject, cycle, SCHEME)
        client = calle.DryRunClient(scripted_result=demo.scripted_call(plan, scenario))
        _, attestation = run_cycle(
            subject, cycle, SCHEME, client=client, plan=plan
        )
        print(f"\n[{scenario}]")
        _print_attestation(plan, attestation)
    return 0


def cmd_adversary(_: argparse.Namespace) -> int:
    """Run every named attack through the real grading engine."""
    outcomes = adversary.run_all()
    for outcome in outcomes:
        mark = "caught    " if outcome.caught else "NOT CAUGHT"
        note = "as documented" if outcome.as_expected else "UNEXPECTED - update the README"
        print(f"  {mark}  {outcome.grade.value:<20} {outcome.attack.name:<46} {note}")
    caught = sum(1 for o in outcomes if o.caught)
    print(f"\n  {caught} of {len(outcomes)} caught. The other two are documented limits, not oversights.")
    return 0 if all(o.as_expected for o in outcomes) else 1


def cmd_exposure(_: argparse.Namespace) -> int:
    """Model both cited cases against the configured cadence and ladder."""
    for modelled in backtest.model_all():
        print(f"  {modelled.case.title}")
        print(f"    {modelled.case.citation}")
        print(f"    undetected {modelled.actual_days:>6} days"
              f"  ->  modelled {modelled.modelled_days} days"
              f"  ({modelled.reduction_factor:.0f}x)")
    print("\n  Models the schedule only. It assumes no call can return CONFIRMED_LIVE")
    print("  after a death, because a challenge minted seconds ago cannot be answered")
    print("  on somebody's behalf and a relative vouching is never a pass.")
    return 0


def cmd_ladder(_: argparse.Namespace) -> int:
    """Show the escalation ladder and which rungs may never attest."""
    for step in ladder.ORDER:
        rung = ladder.RUNGS[step]
        attests = "may attest" if rung.may_attest else "NEVER attests"
        print(f"  {step.value:<20} {ladder.RUNG_DAYS[step]}d  {attests:<14} {rung.purpose}")
    print(f"\n  Reaches a person in {ladder.days_to_human()} days.")
    print("\n  Cadence by last grade:")
    for grade, days in cadence.INTERVAL_DAYS.items():
        print(f"    {grade.value:<20} {days if days is not None else 'schedule stops; a person owns it'}")
    return 0


def cmd_verify(_: argparse.Namespace) -> int:
    """Prove the API key works. Read-only: places no call, spends no credit."""
    key = os.environ.get("CALLE_API_KEY")
    if not key:
        print("CALLE_API_KEY is not set", file=sys.stderr)
        return 2
    try:
        goals = calle.HttpClient(api_key=key).list_goals()
    except calle.CalleError as error:
        print(f"credential check failed: {error}", file=sys.stderr)
        return 1
    print(f"credentials accepted; {len(goals.get('data', []))} published goal(s) visible")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    """Place a real call. Requires an explicit authorisation flag."""
    if not args.i_have_authorisation:
        print(
            "refusing to dial: pass --i-have-authorisation to confirm you are "
            "authorised to call this enrolled subject",
            file=sys.stderr,
        )
        return 2
    key = os.environ.get("CALLE_API_KEY")
    if not key:
        print("CALLE_API_KEY is not set", file=sys.stderr)
        return 2
    subject = roster.get(args.subject)
    cycle = args.cycle or _cycle()
    plan, attestation = run_cycle(
        subject, cycle, SCHEME, client=calle.HttpClient(api_key=key), plan=plan_call(subject, cycle, SCHEME)
    )
    _print_attestation(plan, attestation)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="muster", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("roster", help="list enrolled subjects").set_defaults(func=cmd_roster)

    plan_parser = sub.add_parser("plan", help="preview a call without placing it")
    plan_parser.add_argument("subject")
    plan_parser.add_argument("--cycle")
    plan_parser.add_argument("--show-payload", action="store_true")
    plan_parser.set_defaults(func=cmd_plan)

    demo_parser = sub.add_parser("demo", help="run scripted calls, no credentials needed")
    demo_parser.add_argument("subject", nargs="?")
    demo_parser.add_argument("--cycle")
    demo_parser.add_argument("--scenario", choices=sorted(demo.BUILDERS))
    demo_parser.set_defaults(func=cmd_demo)

    sub.add_parser("adversary", help="run the named attacks through the grader").set_defaults(func=cmd_adversary)
    sub.add_parser("exposure", help="model the cited cases against this cadence").set_defaults(func=cmd_exposure)
    sub.add_parser("ladder", help="show the escalation ladder and cadence").set_defaults(func=cmd_ladder)
    sub.add_parser("verify", help="check credentials, place no call").set_defaults(func=cmd_verify)

    run_parser = sub.add_parser("run", help="place a real call")
    run_parser.add_argument("subject")
    run_parser.add_argument("--cycle")
    run_parser.add_argument("--i-have-authorisation", action="store_true")
    run_parser.set_defaults(func=cmd_run)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
