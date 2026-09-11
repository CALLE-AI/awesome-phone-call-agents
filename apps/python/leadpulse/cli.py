#!/usr/bin/env python
"""LeadPulse - call a new web lead back within a minute, over CALL-E.

Preview (default) - builds the exact CALL-E request for a form submission and prints
it. Calls nobody and needs no API key:

    python cli.py

Replay - decide on a saved terminal call snapshot, offline:

    python cli.py --replay examples/fictional_completed_call.json

Check - side-effect-free credential check (GET /v1/goals):

    python cli.py --check

Place one real call - dials a real phone and spends CALL-E credits:

    export LEADPULSE_ALLOWED_DESTINATIONS="+14155550142"
    python cli.py --execute --i-have-consent --form my_lead.json

A live call requires three things: the destination in LEADPULSE_ALLOWED_DESTINATIONS
(the operator is authorized to call it), ``consent_to_call: true`` in the form
submission (the lead asked to be called), and --i-have-consent on this run.
Phone numbers are masked in all output.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from leadpulse.phone import ALLOWLIST_ENV, DestinationError, allowlist, mask, mask_all, normalize_e164
from leadpulse.results import decide, extract_duration_seconds, extract_transcript

HERE = Path(__file__).resolve().parent
RULE = "-" * 72


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _print_decision(call: dict) -> None:
    decision = decide(call)
    print(RULE)
    print("decision")
    print(RULE)
    print(f"call status        {decision['call_status']}")
    print(f"outcome            {decision['outcome']}")
    if decision["score"] is not None:
        print(f"score              {decision['score']} / 100")
        for field, points in decision["score_breakdown"].items():
            print(f"  {field:<17}+{points}")
        print(f"hot lead           {'yes' if decision['hot_lead'] else 'no'}")
        print(f"send booking link  {'yes' if decision['send_booking_link'] else 'no'}")
    if decision["reason"]:
        print(f"reason             {mask_all(decision['reason'])}")
    if decision.get("notes"):
        print(f"notes              {mask_all(decision['notes'])}")
    print(f"duration_seconds   {extract_duration_seconds(call)}")
    transcript = extract_transcript(call)
    if transcript:
        print(RULE)
        print("transcript")
        print(RULE)
        print(mask_all(transcript))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--form", default=str(HERE / "examples" / "form_submission.json"))
    p.add_argument("--business", default=str(HERE / "examples" / "business.json"))
    p.add_argument("--replay", metavar="CALL_JSON", help="decide on a saved terminal call snapshot")
    p.add_argument("--check", action="store_true", help="verify CALLE_API_KEY without placing a call")
    p.add_argument("--execute", action="store_true", help="place one real call")
    p.add_argument("--i-have-consent", action="store_true", dest="consent")
    p.add_argument("--webhook-url", default=None, help="https terminal webhook endpoint")
    p.add_argument("--timeout", type=float, default=600.0)
    args = p.parse_args()

    if args.replay:
        _print_decision(_load(args.replay))
        return 0

    from leadpulse.client import CalleAPIError, CredentialTargetError, build_request, resolve_base_url

    try:
        base_url = resolve_base_url()
    except CredentialTargetError as exc:
        print(f"Refusing to start: {exc}", file=sys.stderr)
        return 2

    if args.check:
        from leadpulse.client import CalleClient

        try:
            CalleClient().check_credentials()
        except (CalleAPIError, RuntimeError) as exc:
            print(f"Credential check failed: {exc}", file=sys.stderr)
            return 1
        print(f"CALLE_API_KEY accepted by {base_url}. No call was placed.")
        return 0

    business, form = _load(args.business), _load(args.form)
    try:
        destination = normalize_e164(str(form.get("phone") or ""))
        authorized = destination in allowlist()
    except DestinationError as exc:
        print(f"Invalid destination: {exc}", file=sys.stderr)
        return 2

    request = build_request(business, form, destination, webhook_url=args.webhook_url)
    body = request["body"]

    print(RULE)
    print(f"business        {business.get('name')}")
    print(f"lead            {form.get('name')}  (lead_id {form.get('lead_id')})")
    print(f"recipient       {mask(destination)}")
    print(f"form consent    {'yes' if form.get('consent_to_call') is True else 'NO'}")
    print(f"authorized      {'yes' if authorized else f'NO - not in {ALLOWLIST_ENV}'}")
    print(f"api origin      {base_url}")
    print(f"idempotency_key {request['idempotency_key']}")
    print(f"webhook_url     {body.get('webhook_url') or '(none - results will be polled)'}")
    print(RULE)
    print("task")
    print(RULE)
    print(mask_all(body["task"]))
    print(RULE)
    print("result_schema")
    print(RULE)
    print(json.dumps(body["result_schema"], indent=2))

    if not args.execute:
        print(RULE)
        print("PREVIEW - no call was placed. Add --execute --i-have-consent to dial.")
        print(RULE)
        return 0

    if not args.consent:
        print(
            "Refusing to place a live call without --i-have-consent.\n"
            "This dials a real phone. Confirm the lead asked to be called back.",
            file=sys.stderr,
        )
        return 2

    from leadpulse.client import CalleClient, place_call

    print(f"Placing a REAL call to {mask(destination)} ...")
    try:
        client = CalleClient()
        call = place_call(business, form, webhook_url=args.webhook_url, client=client)
    except (DestinationError, PermissionError) as exc:
        print(f"Refusing to dial: {exc}", file=sys.stderr)
        return 2
    except (CalleAPIError, CredentialTargetError, RuntimeError) as exc:
        print(f"Cannot place the call: {exc}", file=sys.stderr)
        return 2
    call_id = str(call["id"])
    print(f"created  call_id={call_id}  status={call.get('status')}")

    if args.webhook_url:
        print("The terminal result will be delivered to the webhook. Not waiting.")
        return 0

    print(f"polling up to {args.timeout:.0f}s for a terminal result (polling never redials) ...")
    try:
        final = client.wait_for_result(call_id, timeout_seconds=args.timeout)
    except TimeoutError as exc:
        print(f"{exc}. The call may still complete; a retry for the same lead_id reuses its Idempotency-Key.")
        return 1
    _print_decision(final)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
