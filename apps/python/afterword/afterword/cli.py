"""Command line for Afterword.

No subcommand places a real call except `run`, which additionally requires
CALLE_API_KEY and an explicit `--i-have-authorisation` flag. Every other path
is a preview or a scripted demo, so the default way to use this package cannot
ring a bereavement team.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .safety import redact
from . import calle, demo, registry
from .models import CaptureResult, Grade, Pack
from .runner import Plan, payload_for, plan_call, run_institution


def _print_result(plan: Plan, result: CaptureResult) -> None:
    print(f"  institution   {plan.institution.name}  ({plan.institution.institution_id})")
    print(f"  number        {plan.masked_phone()}")
    print(f"  grade         {result.grade.value}")
    print(f"  reasons       {', '.join(result.reasons)}")
    requirement = result.requirement
    if requirement is not None:
        print(f"  department    {requirement.department or '-'}")
        print(f"  documents     {'; '.join(requirement.documents_needed) or '-'}")
        print(f"  certified ok  {requirement.certified_copy_accepted.value}")
        print(f"  direct debits {requirement.direct_debits_action.value}")
        print(f"  reference     {requirement.reference_opened or '-'}")
    for item in result.conflicts:
        print(f"  conflict      {item.field_name}")
        print(f"    this call   {item.stated}")
        print(f"    on file     {item.counter}  [{item.counter_source}]")
    print(f"  in pack       {result.goes_in_pack}")
    print(f"  closes acct   {result.closes_account}")
    print(f"  accepts terms {result.accepts_terms}")
    for quote in result.evidence_quotes:
        print(f"    > {redact(quote)}")


def _print_pack(pack: Pack) -> None:
    print("\n--- pack ---")
    for grade, results in pack.by_grade.items():
        print(f"  {grade.value:<22} {len(results)}")
    print(f"  disputes recorded      {len(pack.disputes)}")
    print(f"  still needs a person   {len(pack.outstanding)}")


def cmd_estate(_: argparse.Namespace) -> int:
    estate = registry.ESTATE
    print(f"estate     {estate.estate_id}")
    print(f"deceased   {estate.deceased_name}")
    print(f"executor   {estate.executor_name}")
    print(f"reference  {estate.reference}")
    print(f"disclosure budget: {', '.join(estate.disclosable)}")
    print(f"withheld from every call: {len(estate.withheld)} value(s), never spoken")
    print("\ninstitutions")
    for institution in registry.INSTITUTIONS:
        policy = "policy on file" if institution.recorded_policy else "no policy on file"
        prior = len(registry.priors(institution.institution_id))
        print(
            f"  {institution.institution_id}  {institution.name:<32} "
            f"{institution.masked_phone():<16} {policy}, {prior} prior call(s)"
        )
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    """Show exactly what would be said and sent. Places no call."""
    plan = plan_call(registry.ESTATE, registry.get(args.institution))
    print(f"institution      {plan.institution.name}")
    print(f"number (masked)  {plan.masked_phone()}")
    print(f"idempotency key  {plan.idempotency_key}")
    print(f"disclosure       {', '.join(plan.estate.disclosable)}")
    print("\n--- what the agent says ---")
    print(redact(plan.task_text))
    if args.show_payload:
        body = payload_for(plan)
        body["recipients"] = [{"phones": [plan.masked_phone()]}]
        body["task"] = "<as above>"
        print("\n--- POST /v1/calls (number masked) ---")
        print(json.dumps(body, indent=2))
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    """Run scripted calls through the real extraction and grading path."""
    estate = registry.ESTATE
    chosen_institutions = (
        [registry.get(args.institution)] if args.institution else list(registry.INSTITUTIONS)
    )
    results: list[CaptureResult] = []
    for institution in chosen_institutions:
        scenario = args.scenario or demo.INSTITUTION_SCENARIOS.get(
            institution.institution_id, "captured"
        )
        plan = plan_call(estate, institution)
        client = calle.DryRunClient(scripted_result=demo.scripted_call(plan, scenario))
        _, result = run_institution(
            estate,
            institution,
            priors=registry.priors(institution.institution_id),
            client=client,
            plan=plan,
        )
        results.append(result)
        print(f"\n[{scenario}]")
        _print_result(plan, result)
    if len(results) > 1:
        _print_pack(Pack(estate=estate, results=tuple(results)))
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
            "refusing to dial: pass --i-have-authorisation to confirm the "
            "executor has asked for this institution to be called",
            file=sys.stderr,
        )
        return 2
    key = os.environ.get("CALLE_API_KEY")
    if not key:
        print("CALLE_API_KEY is not set", file=sys.stderr)
        return 2
    institution = registry.get(args.institution)
    plan, result = run_institution(
        registry.ESTATE,
        institution,
        priors=registry.priors(institution.institution_id),
        client=calle.HttpClient(api_key=key),
    )
    _print_result(plan, result)
    return 0 if result.grade is not Grade.UNREACHED else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="afterword", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("estate", help="show the estate and who has to be told").set_defaults(
        func=cmd_estate
    )

    plan_parser = sub.add_parser("plan", help="preview a call without placing it")
    plan_parser.add_argument("institution")
    plan_parser.add_argument("--show-payload", action="store_true")
    plan_parser.set_defaults(func=cmd_plan)

    demo_parser = sub.add_parser("demo", help="run scripted calls, no credentials needed")
    demo_parser.add_argument("institution", nargs="?")
    demo_parser.add_argument("--scenario", choices=sorted(demo.BUILDERS))
    demo_parser.set_defaults(func=cmd_demo)

    sub.add_parser("verify", help="check credentials, place no call").set_defaults(
        func=cmd_verify
    )

    run_parser = sub.add_parser("run", help="place a real call")
    run_parser.add_argument("institution")
    run_parser.add_argument("--i-have-authorisation", action="store_true")
    run_parser.set_defaults(func=cmd_run)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
