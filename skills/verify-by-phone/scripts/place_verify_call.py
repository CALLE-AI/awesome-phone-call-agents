#!/usr/bin/env python3
"""Place one disclosed verification call. DRY RUN BY DEFAULT.

Dry run prints the exact task text and a masked recipient, dials nothing, and
needs no credentials. Pass --live (with CALLE_API_KEY set) to actually dial.
Exactly one call per live invocation; there is no batch mode on purpose.
"""

import argparse
import os
import re
import sys
import uuid

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


# Must stay byte-identical to CALL_CONDUCT in backend/app/runs.py. This file is
# standard-library-only on purpose so the skill installs standalone, so it cannot
# import the original; tests/test_skill_parity.py compares the two strings and
# fails on the commit that lets them drift.
CALL_CONDUCT = (
    "Record the answers exactly as given. If the person "
    "hedges, capture their exact wording. If they decline to speak with an automated "
    "caller, thank them and end the call immediately. If asked to hold, wait briefly, "
    "then thank them and end the call rather than waiting indefinitely. If you "
    "reach voicemail or an answering machine, do NOT leave a message: end the "
    "call politely and immediately, because a directory answer cannot be "
    "established from a recording and nobody should find a robot message on "
    "their line. If you are asked for patient details, such as a name, a date of "
    "birth, an insurance member or card number, or a reason for the visit, say "
    "plainly that you do not have that information because this is a directory "
    "verification call and not an appointment request, then repeat the question "
    "you called to ask. Never invent any such detail, not even a placeholder. "
    "Never guess: "
    "anything not clearly stated must be recorded as unknown. Keep the call under two "
    "minutes and always remain polite."
)


def build_task(org: str, accepting: str | None, plan: str | None) -> str:
    questions = []
    if accepting is not None:
        questions.append("whether the practice is currently accepting new patients")
    if plan is not None:
        questions.append(f"whether the practice currently accepts {plan}")
    if not questions:
        questions.append("whether the published listing information is current")
    asks = "; and ".join(questions)
    return (
        f"You are placing a short verification call to {org} on behalf of a records "
        "verification service. Open with: 'Hi, this is an automated assistant calling "
        f"to verify directory information for {org}. This call may be recorded.' "
        f"Then politely ask: {asks}. " + CALL_CONDUCT
    )


def mask(phone: str) -> str:
    return phone[:3] + "*" * (len(phone) - 6) + phone[-3:]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--org", required=True, help="Organization name as listed")
    parser.add_argument("--phone", required=True, help="Published line, E.164 (+15550101234)")
    parser.add_argument("--claim-accepting-new-patients", choices=["yes", "no"], default=None)
    parser.add_argument("--claim-plan", default=None, help="Insurance plan name to verify")
    parser.add_argument("--live", action="store_true", help="Actually place the call")
    args = parser.parse_args()

    if not E164.match(args.phone):
        sys.exit("ERROR: --phone must be E.164, for example +15550101234")

    task = build_task(args.org, args.claim_accepting_new_patients, args.claim_plan)
    print(f"recipient: {mask(args.phone)}")
    print(f"task:\n{task}\n")

    if not args.live:
        print("DRY RUN: no call placed. Re-run with --live to dial.")
        return

    api_key = os.environ.get("CALLE_API_KEY", "")
    if not api_key:
        sys.exit("ERROR: set CALLE_API_KEY to place a live call.")
    try:
        from calle import CalleClient
    except ImportError:
        sys.exit("ERROR: pip install calle-ai (the package installs as module 'calle').")

    idempotency_key = f"verify-{uuid.uuid4().hex[:16]}"
    with CalleClient(api_key=api_key) as client:
        created = client.calls.create(
            task=task,
            recipient={"phone": args.phone},
            metadata={"skill": "verify-by-phone", "org": args.org},
            idempotency_key=idempotency_key,
        )
    print(f"call created: id={created.get('id')} status={created.get('status')}")
    print(f"idempotency key (reuse to avoid double-dialing): {idempotency_key}")
    print("next: python3 scripts/poll_result.py --call-id", created.get("id"))


if __name__ == "__main__":
    main()
