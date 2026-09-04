"""Command line.

`preview` never places a call. `judge` runs entirely on recorded answers and
never places a call either. Only `run --live` can dial, and it needs an approval
token derived from the exact audit it is about to perform.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

from concord.calle import CalleAPIError, CalleClient
from concord.collector import (
    answers_from_result,
    build_payload,
    build_task,
    idempotency_key,
    window_is_open,
)
from concord.judge import rule_all
from concord.models import Answer, Audit, ConcordError, Rubric
from concord.report import render


def approval_token(audit: Audit, rubric: Rubric) -> str:
    """Bind approval to the complete call intent, not just its identifiers.

    An earlier version hashed only the ids, the branch numbers and the criterion
    ids. That meant the questions, the policy text, the allowed answers, the
    organisation named in the disclosure, the authorization references and the
    call window could all be rewritten while the operator's token stayed valid.
    An operator who approved a stock-availability audit could have placed a
    differently worded call to the same branches under the same approval.

    Everything an operator reads in the preview is hashed here, so any material
    edit invalidates the token they approved.
    """
    payload = json.dumps(
        {
            "audit": audit.id,
            "org": audit.org,
            "requested_by": audit.requested_by,
            "timezone": audit.timezone,
            "call_window": list(audit.call_window),
            "branches": sorted(
                [b.id, b.name, b.phone, b.authorization] for b in audit.branches
            ),
            "rubric": rubric.id,
            "rubric_title": rubric.title,
            "scenario": rubric.scenario,
            "criteria": sorted(
                [c.id, c.question, c.policy, c.field, c.expect, list(c.options)]
                for c in rubric.criteria
            ),
        },
        sort_keys=True,
    )
    digest = hashlib.sha256(payload.encode()).hexdigest()[:12].upper()
    return f"CONCORD-{digest}"


def cmd_preview(args: argparse.Namespace) -> int:
    audit = Audit.load(args.audit)
    rubric = Rubric.load(args.rubric)
    if audit.rubric_id != rubric.id:
        raise ConcordError(
            f"Audit expects rubric {audit.rubric_id!r} but {rubric.id!r} was given."
        )

    print("CONCORD  /  CALL PREVIEW")
    print("=" * 78)
    print(f"Audit       {audit.id}")
    print(f"Org         {audit.org}")
    print(f"Rubric      {rubric.id}  {rubric.title}")
    print(f"Window      {audit.call_window[0]}-{audit.call_window[1]} {audit.timezone}")
    print(f"Side effect Places {len(audit.branches)} outbound call(s) to your own branches.")
    print("Scope       Branch policy concordance. Not a staff performance review.")
    print()
    print("BRANCHES TO CALL")
    print(f"{'Branch':<38}{'Masked number':<18}{'Authorization'}")
    print("-" * 78)
    for b in audit.branches:
        print(f"{b.name[:37]:<38}{b.masked_phone:<18}{b.authorization[:22]}")
    print()
    print("SCENARIO")
    print(f"  {rubric.scenario}")
    print()
    print("QUESTIONS ASKED")
    for c in rubric.criteria:
        print(f"  {c.id}  {c.question}")
    print()
    print("APPROVAL CHECKPOINT")
    print("No call was placed. Review this exact audit before approving it.")
    token = approval_token(audit, rubric)
    print(f"Token        {token}")
    print(f"Live command concord run {args.audit} --rubric {args.rubric} --live --confirm {token}")
    return 0


def cmd_judge(args: argparse.Namespace) -> int:
    audit = Audit.load(args.audit)
    rubric = Rubric.load(args.rubric)
    if audit.rubric_id != rubric.id:
        raise ConcordError(
            f"Audit expects rubric {audit.rubric_id!r} but {rubric.id!r} was given."
        )
    with open(args.results, encoding="utf-8") as handle:
        raw = json.load(handle)
    answers = [Answer.parse(a) for a in raw.get("answers", ())]
    findings = rule_all(rubric, answers)
    print(render(audit, rubric, findings))
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    """Place the calls.

    Three gates, checked in this order and independently of each other:
    the operator asked for --live, the approval token matches this exact audit,
    and the branches' own call window is open.
    """
    audit = Audit.load(args.audit)
    rubric = Rubric.load(args.rubric)
    if audit.rubric_id != rubric.id:
        raise ConcordError(
            f"Audit expects rubric {audit.rubric_id!r} but {rubric.id!r} was given."
        )

    if not args.live:
        print("Preview mode. Re-run with --live and the approval token to place calls.")
        return 0

    if args.confirm != approval_token(audit, rubric):
        print(
            "Concord refused: the approval token does not match this exact audit. "
            "Run preview again and approve the audit you actually intend to place.",
            file=sys.stderr,
        )
        return 2

    if not window_is_open(audit):
        print(
            f"Concord refused: the call window for these branches is closed "
            f"({audit.call_window[0]}-{audit.call_window[1]} {audit.timezone}, weekdays). "
            "Branches are called during their own opening hours.",
            file=sys.stderr,
        )
        return 2

    client = CalleClient(
        api_key=os.environ.get("CALLE_API_KEY", ""),
        base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"),
    )
    payload = build_payload(audit, rubric)
    key = idempotency_key(audit, rubric)

    print(f"Placing {len(audit.branches)} call(s) for audit {audit.id}.")
    created = client.create_call(payload, key)
    call_id = str(created.get("id") or created.get("call_id") or "")
    if not call_id:
        raise ConcordError(f"CALL-E did not return a call id: {created!r}")
    print(f"CALL-E call id {call_id}. Keep this id; do not start a second audit.")

    completed = client.wait_for_completion(call_id)
    answers = answers_from_result(rubric, completed, audit)
    if args.save:
        record = {
            "audit_id": audit.id,
            "rubric_id": rubric.id,
            "call_id": call_id,
            "status": completed.get("status"),
            "answers": [
                {
                    "branch_id": a.branch_id,
                    "criterion_id": a.criterion_id,
                    "value": a.value,
                    "quote": a.quote,
                    "reached": a.reached,
                }
                for a in answers
            ],
        }
        with open(args.save, "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2)
        print(f"Answers written to {args.save}")

    print()
    print(render(audit, rubric, rule_all(rubric, answers)))
    return 0


def cmd_task(args: argparse.Namespace) -> int:
    """Print the exact call task and result schema, without placing a call."""
    audit = Audit.load(args.audit)
    rubric = Rubric.load(args.rubric)
    payload = build_payload(audit, rubric)
    print("CALL TASK")
    print("-" * 78)
    print(build_task(audit, rubric))
    print()
    print("RECIPIENT RESULT SCHEMA  (compiled from the rubric)")
    print("-" * 78)
    print(json.dumps(payload["recipient_result_schema"], indent=2))
    print()
    print(f"Idempotency-Key  {idempotency_key(audit, rubric)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="concord", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("audit")
        p.add_argument("--rubric", required=True)

    p_preview = sub.add_parser("preview", help="show the plan, place no calls")
    add_common(p_preview)
    p_preview.set_defaults(func=cmd_preview)

    p_judge = sub.add_parser("judge", help="rule recorded answers against the rubric")
    add_common(p_judge)
    p_judge.add_argument("--results", required=True)
    p_judge.set_defaults(func=cmd_judge)

    p_run = sub.add_parser("run", help="place the calls, requires --live and a token")
    add_common(p_run)
    p_run.add_argument("--live", action="store_true")
    p_run.add_argument("--confirm", default="")
    p_run.add_argument("--save", default="", help="write the recorded answers to this file")
    p_run.set_defaults(func=cmd_run)

    p_task = sub.add_parser("task", help="show the compiled call task and schema")
    add_common(p_task)
    p_task.set_defaults(func=cmd_task)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        raise SystemExit(args.func(args))
    except ConcordError as exc:
        print(f"Concord refused: {exc}", file=sys.stderr)
        raise SystemExit(2)
    except CalleAPIError as exc:
        print(f"CALL-E error: {exc}", file=sys.stderr)
        raise SystemExit(3)


if __name__ == "__main__":
    main()
