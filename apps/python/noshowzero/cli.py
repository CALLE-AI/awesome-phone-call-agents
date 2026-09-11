#!/usr/bin/env python
"""NoShowZero - appointment reminder calls and waitlist refill, over CALL-E.

Preview (default) - builds the exact CALL-E reminder request for an appointment and prints it.
Calls nobody and needs no API key:

    python cli.py

Preview the waitlist offer - who would be offered the appointment's slot if it were released,
why everyone else was skipped, and the exact offer request:

    python cli.py --offer

Replay - decide on a saved terminal call snapshot, offline:

    python cli.py --replay examples/fictional_reminder_call.json
    python cli.py --replay examples/fictional_offer_call.json

Check - side-effect-free credential check (GET /v1/goals):

    python cli.py --check

Place one real call - dials a real phone and spends CALL-E credits:

    export NOSHOWZERO_ALLOWED_DESTINATIONS="+12125550116"
    python cli.py --execute --i-have-consent                 # the reminder
    python cli.py --offer --execute --i-have-consent         # the waitlist offer, after a release

A live call requires three things: the destination in NOSHOWZERO_ALLOWED_DESTINATIONS (the
operator is authorized to call it), ``consent_to_call: true`` on the appointment or waitlist
record (the patient agreed to these calls), and --i-have-consent on this run. The CLI never
places the waitlist offer by itself: a released slot prints the command to run next.
Phone numbers are masked in all output.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from noshowzero.phone import ALLOWLIST_ENV, DestinationError, allowlist, mask, mask_all, normalize_e164
from noshowzero.results import decide, extract_duration_seconds, extract_transcript
from noshowzero.task import local_slot
from noshowzero.waitlist import pick_candidate

HERE = Path(__file__).resolve().parent
RULE = "-" * 72


def _load(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _print_decision(call: dict, patient: str = "Patient") -> dict:
    decision = decide(call)
    print(RULE)
    print(f"decision ({decision['kind']})")
    print(RULE)
    for key in ("call_status", "outcome", "appointment_status", "reminder_status", "release_slot",
                "reschedule_preference", "book", "entry_status", "offer_next"):
        if key in decision and decision[key] not in (None, False):
            print(f"{key:<22}{decision[key]}")
    for key in ("reason", "notes", "summary"):
        if decision.get(key):
            print(f"{key:<22}{mask_all(decision[key])}")
    print(f"{'duration_seconds':<22}{extract_duration_seconds(call)}")
    transcript = extract_transcript(call, patient=patient)
    if transcript:
        print(RULE)
        print("transcript")
        print(RULE)
        print(mask_all(transcript))
    return decision


def _candidate(clinic: dict, appointment: dict, waitlist: list[dict]):
    candidate, skipped = pick_candidate(
        waitlist, slot_id=str(appointment["appointment_id"]), slot_at=appointment["appointment_at"],
        service_type=appointment["service_type"], timezone=clinic["timezone"],
    )
    time_str, date_str = local_slot(appointment["appointment_at"], clinic["timezone"])
    print(RULE)
    print(f"waitlist match for the {appointment['service_type']} slot at {time_str} on {date_str}")
    print(RULE)
    names = {str(e.get("entry_id")): e.get("patient_name") for e in waitlist}
    for entry_id, reason in skipped:
        print(f"  skip   {names.get(entry_id, entry_id):<18} {reason}")
    if candidate:
        print(f"  offer  {candidate['patient_name']:<18} first matching patient (oldest entry)")
    else:
        print("  nobody on the waitlist matches this slot")
    return candidate


def _print_request(request: dict, destination: str, authorized: bool, consent: bool, base_url: str) -> None:
    body = request["body"]
    print(f"recipient       {mask(destination)}")
    print(f"patient consent {'yes' if consent else 'NO'}")
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


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--clinic", default=str(HERE / "examples" / "clinic.json"))
    p.add_argument("--appointment", default=str(HERE / "examples" / "appointment.json"))
    p.add_argument("--waitlist", default=str(HERE / "examples" / "waitlist.json"))
    p.add_argument("--window", default="24h", choices=["72h", "24h", "2h"], help="reminder window")
    p.add_argument("--offer", action="store_true", help="the waitlist offer for the appointment's slot")
    p.add_argument("--replay", metavar="CALL_JSON", help="decide on a saved terminal call snapshot")
    p.add_argument("--check", action="store_true", help="verify CALLE_API_KEY without placing a call")
    p.add_argument("--execute", action="store_true", help="place one real call")
    p.add_argument("--i-have-consent", action="store_true", dest="consent")
    p.add_argument("--webhook-url", default=None, help="https terminal webhook endpoint")
    p.add_argument("--timeout", type=float, default=600.0)
    args = p.parse_args()

    clinic, appointment, waitlist = _load(args.clinic), _load(args.appointment), _load(args.waitlist)

    if args.replay:
        call = _load(args.replay)
        decision = _print_decision(call)
        if decision.get("release_slot"):
            if _candidate(clinic, appointment, waitlist):
                print(RULE)
                print("Slot released. Preview the offer:  python cli.py --offer")
        return 0

    from noshowzero.client import (
        CalleAPIError, CredentialTargetError, build_offer_request, build_reminder_request, resolve_base_url,
    )

    try:
        base_url = resolve_base_url()
    except CredentialTargetError as exc:
        print(f"Refusing to start: {exc}", file=sys.stderr)
        return 2

    if args.check:
        from noshowzero.client import CalleClient

        try:
            CalleClient().check_credentials()
        except (CalleAPIError, RuntimeError) as exc:
            print(f"Credential check failed: {exc}", file=sys.stderr)
            return 1
        print(f"CALLE_API_KEY accepted by {base_url}. No call was placed.")
        return 0

    print(RULE)
    print(f"clinic          {clinic['name']}  ({clinic['timezone']})")
    if args.offer:
        record = _candidate(clinic, appointment, waitlist)
        if not record:
            return 0
        print(RULE)
        print(f"waitlist entry  {record['patient_name']}  (entry_id {record['entry_id']})")
    else:
        record = appointment
        time_str, date_str = local_slot(appointment["appointment_at"], clinic["timezone"])
        print(f"appointment     {appointment['patient_name']} - {appointment['service_type']} at {time_str} "
              f"on {date_str}  (appointment_id {appointment['appointment_id']}, {args.window} reminder)")

    try:
        destination = normalize_e164(str(record.get("phone") or ""))
        authorized = destination in allowlist()
    except DestinationError as exc:
        print(f"Invalid destination: {exc}", file=sys.stderr)
        return 2

    slot = {"slot_id": str(appointment["appointment_id"]), "slot_at": appointment["appointment_at"],
            "service_type": appointment["service_type"]}
    if args.offer:
        request = build_offer_request(clinic, record, destination, webhook_url=args.webhook_url, **slot)
    else:
        request = build_reminder_request(clinic, appointment, destination, args.window, webhook_url=args.webhook_url)
    _print_request(request, destination, authorized, record.get("consent_to_call") is True, base_url)

    if not args.execute:
        print(RULE)
        print("PREVIEW - no call was placed. Add --execute --i-have-consent to dial.")
        print(RULE)
        return 0

    if not args.consent:
        print("Refusing to place a live call without --i-have-consent.\n"
              "This dials a real phone. Confirm the patient agreed to be called.", file=sys.stderr)
        return 2

    from noshowzero.client import CalleClient, place_offer_call, place_reminder_call

    print(f"Placing a REAL call to {mask(destination)} ...")
    try:
        client = CalleClient()
        if args.offer:
            call = place_offer_call(clinic, record, webhook_url=args.webhook_url, client=client, **slot)
        else:
            call = place_reminder_call(clinic, appointment, args.window, webhook_url=args.webhook_url, client=client)
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
        print(f"{exc}. The call may still complete; re-running reuses the same Idempotency-Key.")
        return 1
    decision = _print_decision(final, patient=record["patient_name"].split()[0])
    if decision.get("release_slot") and _candidate(clinic, appointment, waitlist):
        print(RULE)
        print("Slot released. Offer it (dials the waitlist patient):  python cli.py --offer --execute --i-have-consent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
