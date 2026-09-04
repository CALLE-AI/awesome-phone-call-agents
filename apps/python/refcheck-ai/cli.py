#!/usr/bin/env python
"""RefCheck - structured employment reference checks over CALL-E.

Preview (default) - builds the task and schema, prints them, calls nobody:

    python cli.py --template engineering

Place one real call - dials a real phone and spends CALL-E credits:

    python cli.py --execute --i-have-consent \
        --to "+15555550142" \
        --referee "Jordan Referee" \
        --candidate "Alex Candidate" \
        --role "Senior Software Engineer" \
        --company "Northwind"

`--i-have-consent` asserts that the referee agreed to be called and the
candidate authorised the reference check. Only call numbers you own or are
authorised to call. Sample numbers here are in the reserved fictional
+1 555 01xx range.
"""
from __future__ import annotations

import argparse
import json
import sys

from refcheck.results import extract_duration_seconds, extract_transcript
from refcheck.scoring import compute_reference_score, score_to_recommendation
from refcheck.templates import TEMPLATES

RULE = "-" * 72


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--execute", action="store_true", help="place a real call")
    p.add_argument("--i-have-consent", action="store_true", dest="consent")
    p.add_argument("--template", choices=sorted(TEMPLATES), default="standard")
    p.add_argument("--to", default="+15555550100", help="referee phone, E.164")
    p.add_argument("--referee", default="Jordan Referee")
    p.add_argument("--relationship", default="Former direct manager")
    p.add_argument("--candidate", default="Alex Candidate")
    p.add_argument("--role", default="Senior Software Engineer")
    p.add_argument("--company", default="Northwind")
    p.add_argument("--jd", default="owning the payments platform and reviewing others' code")
    p.add_argument("--webhook-url", default=None, help="terminal webhook endpoint")
    p.add_argument("--timeout", type=float, default=1200.0)
    args = p.parse_args()

    questions = TEMPLATES[args.template]
    reference = {
        "id": "cli-reference",
        "referee_name": args.referee,
        "referee_phone": args.to,
        "relationship": args.relationship,
    }
    candidate = {
        "id": "cli-candidate",
        "name": args.candidate,
        "role_applied_for": args.role,
        "company_name": args.company,
        "job_description_summary": args.jd,
    }

    # Imported here so preview works without CALLE_API_KEY set.
    from refcheck.client import build_request

    request = build_request(reference, candidate, questions, webhook_url=args.webhook_url)

    print(RULE)
    print(f"template        {args.template} ({len(questions)} questions)")
    print(f"recipient       {args.to}")
    print(f"idempotency_key {request['idempotency_key']}")
    print(f"webhook_url     {request.get('webhook_url') or '(none - will poll instead)'}")
    print(RULE)
    print("task")
    print(RULE)
    print(request["task"])
    print()
    print(RULE)
    print("result_schema")
    print(RULE)
    print(json.dumps(request["result_schema"], indent=2))
    print()

    if not args.execute:
        print(RULE)
        print("PREVIEW - no call was placed. Add --execute --i-have-consent to dial.")
        print(RULE)
        return 0

    if not args.consent:
        print(
            "Refusing to place a live call without --i-have-consent.\n"
            "This dials a real phone. Confirm the referee agreed to be called\n"
            "and the candidate authorised the reference check.",
            file=sys.stderr,
        )
        return 2

    from refcheck.client import place_call, wait_for_result

    print(f"Placing a REAL call to {args.to} ...")
    call = place_call(reference, candidate, questions, webhook_url=args.webhook_url)
    call_id = str(call["id"])
    print(f"created  call_id={call_id}  status={call.get('status')}")

    if args.webhook_url:
        print("Terminal result will be delivered to the webhook. Not waiting.")
        return 0

    print(f"waiting up to {args.timeout:.0f}s for a terminal result ...")
    final = wait_for_result(call_id, timeout_seconds=args.timeout)

    print()
    print(RULE)
    print(f"terminal status: {final.get('status')}")
    print(RULE)
    result = final.get("structured_result")
    print(json.dumps(result, indent=2) if result else "null - no schema-valid result")
    if result:
        score = compute_reference_score(result.get("answers"), result.get("referee_enthusiasm"))
        print()
        print(f"reference score  {score} / 10")
        if score is not None:
            print(f"recommendation   {score_to_recommendation(score)}")
    print(f"duration_seconds {extract_duration_seconds(final)}")
    transcript = extract_transcript(final)
    if transcript:
        print()
        print(RULE)
        print("transcript")
        print(RULE)
        print(transcript)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
