#!/usr/bin/env python3
"""Place one disclosed verification call. DRY RUN BY DEFAULT.

Dry run prints the exact task text and a masked recipient, dials nothing, and
needs no credentials. Pass --live (with CALLE_API_KEY set) to actually dial.
At most one new call per live invocation; retries reuse the saved request.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

from poll_result import write_payload

E164 = re.compile(r"\+[1-9][0-9]{7,14}")
RESULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "organization_confirmation": {
            "type": "string",
            "description": "Respondent's confirmation or denial of the named organization, or unknown.",
        },
        "accepting_new_patients": {
            "type": "string",
            "description": "yes, no, or unknown; unknown if not asked or not clearly answered.",
        },
        "accepts_plan": {
            "type": "string",
            "description": "yes, no, or unknown for the named plan; unknown if not asked or answered.",
        },
    },
    "required": ["organization_confirmation", "accepting_new_patients", "accepts_plan"],
}


# Must stay byte-identical to CALL_CONDUCT in backend/app/runs.py. This file is
# standard-library-only on purpose so the skill installs standalone, so it cannot
# import the original; tests/test_skill_parity.py compares the two strings and
# fails on the commit that lets them drift.
CALL_CONDUCT = (
    "First establish that you have reached the organization named above. If the "
    "person says you have reached a different business, a private residence, or a "
    "wrong number, do NOT ask the verification questions: thank them and end the "
    "call, because an answer from somewhere else is not evidence about this "
    "listing. "
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
    # The identity question comes first and is not optional. Extraction fails
    # closed without a positive confirmation that the respondent represents this
    # listing, so a script that never asks guarantees an abstention. The product
    # builder in backend/app/runs.py has always asked; this one had drifted.
    questions = [f"first, confirm you have reached the right place by asking: 'Is this {org}?'"]
    if accepting is not None:
        questions.append("then ask whether the practice is currently accepting new patients")
    if plan is not None:
        questions.append(f"then ask whether the practice currently accepts {plan}")
    if len(questions) == 1:
        # No generic fallback. There used to be one ("whether the published
        # listing information is current") and it was unextractable by
        # construction: no claim pattern matches it, so the call could never
        # produce a recordable answer. Callers must supply a claim; main()
        # rejects this case before dialing and this guard keeps any other
        # caller from reintroducing it quietly.
        raise ValueError("build_task requires at least one claim to verify")
    asks = "; ".join(questions)
    return (
        f"You are placing a short verification call to {org} on behalf of a records "
        "verification service. Open with: 'Hi, this is an automated assistant calling "
        f"to verify directory information for {org}. This call may be recorded.' "
        f"Then ask ONE question at a time, waiting for an answer before asking the "
        f"next: {asks}. " + CALL_CONDUCT
    )


def mask(phone: str) -> str:
    return phone[:3] + "*" * (len(phone) - 6) + phone[-3:]


def utc_day() -> str:
    # timezone.utc, not datetime.UTC: the alias is 3.11+, and this file ships
    # standalone into repositories whose default interpreter may be older.
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")  # noqa: UP017


def default_idempotency_key(
    org: str, phone: str, accepting: str | None, plan: str | None, day: str
) -> str:
    """Derive an initial key; saved --state takes precedence on every retry."""
    # ponytail: daily deduplication; pass a fresh --idempotency-key for a same-day repeat.
    material = "\x00".join([org.strip().lower(), phone.strip(), accepting or "", plan or "", day])
    return "verify-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]


def prepare_state(path: str, request: dict, key: str, explicit_key: str | None) -> dict:
    """Persist the original input before sending; an existing file is a retry."""
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        os.chmod(path, 0o600)
        with open(path, encoding="utf-8") as handle:
            state = json.load(handle)
        saved_key = state["idempotency_key"]
        if not isinstance(saved_key, str) or not 1 <= len(saved_key.strip()) <= 255:
            raise ValueError("saved idempotency key is invalid")
        if state["request"] != request or (
            explicit_key is not None and state["idempotency_key"] != explicit_key
        ):
            raise ValueError("state belongs to different input; use a different --state for a new call")
        return state
    state = {"idempotency_key": key, "request": request}
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)
    return state


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--org", required=True, help="Organization name as listed")
    parser.add_argument("--phone", required=True, help="Published line, E.164 (+15550101234)")
    parser.add_argument("--claim-accepting-new-patients", choices=["yes", "no"], default=None)
    parser.add_argument("--claim-plan", default=None, help="Insurance plan name to verify")
    parser.add_argument("--live", action="store_true", help="Actually place the call")
    parser.add_argument(
        "--state", default="verify-call.json",
        help="Private saved request and Call ID. Reuse for retries; new calls need a new path and key.",
    )
    parser.add_argument(
        "--idempotency-key",
        default=None,
        help=(
            "Reuse a specific key. Pass the key printed by the run you are "
            "retrying so a call that may already exist is never placed twice."
        ),
    )
    args = parser.parse_args()

    if not E164.fullmatch(args.phone):
        sys.exit("ERROR: --phone must be E.164, for example +15550101234")
    if args.idempotency_key is not None and not 1 <= len(args.idempotency_key.strip()) <= 255:
        sys.exit("ERROR: --idempotency-key must contain 1-255 characters after trimming.")

    # Refuse a call that cannot produce a result. With neither claim supplied
    # the task used to fall back to asking "whether the published listing
    # information is current", which no extractor pattern matches, so the call
    # was guaranteed to yield nothing extractable. That is worse than a bug:
    # it spends real money and a real person's time on a question whose answer
    # this tool has no way to record. Refuse before dialing, not after.
    if args.claim_accepting_new_patients is None and args.claim_plan is None:
        sys.exit(
            "ERROR: nothing to verify. Pass at least one claim:\n"
            "  --claim-accepting-new-patients yes|no\n"
            "  --claim-plan 'Example PPO'\n"
            "A call with no claim cannot produce an extractable answer, so it "
            "would use a real call and a real person's time for nothing."
        )

    task = build_task(args.org, args.claim_accepting_new_patients, args.claim_plan)
    idempotency_key = args.idempotency_key or default_idempotency_key(
        args.org,
        args.phone,
        args.claim_accepting_new_patients,
        args.claim_plan,
        utc_day(),
    )
    request = {
        "task": task,
        "phone": args.phone,
        "result_schema": RESULT_SCHEMA,
        "metadata": {"skill": "verify-by-phone", "org": args.org},
    }
    if args.live:
        try:
            state = prepare_state(args.state, request, idempotency_key, args.idempotency_key)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            sys.exit(
                f"ERROR: cannot prepare {args.state}: {exc}\n"
                "If this is a retry, keep the original state and key; do not delete them to retry."
            )
        idempotency_key = state["idempotency_key"]
    print(f"recipient: {mask(args.phone)}")
    # Printed BEFORE the request on purpose. If the create call times out, the
    # operator still has the key and can retry without risking a second dial.
    print(f"idempotency key: {idempotency_key}", flush=True)
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
        sys.exit("ERROR: pip install calle-ai==1.0.1 (the package installs as module 'calle').")

    try:
        with CalleClient(api_key=api_key) as client:
            created = client.calls.create(**state["request"], idempotency_key=idempotency_key)
    except Exception as exc:
        # Deliberately broad: any failure at all leaves the call's fate unknown,
        # and a narrower catch would let some of them escape as a traceback with
        # no recovery instructions.
        # An error here is ambiguous: the request may have reached the platform
        # and placed the call before the response was lost. Re-running blind
        # would dial a real office twice, so spell out the safe recovery.
        sys.exit(
            f"ERROR: the create request failed: {str(exc).replace(args.phone, mask(args.phone))}\n"
            "The call MAY ALREADY HAVE BEEN PLACED. Do not re-run this command blind.\n"
            "Retry with the same --state, unchanged input, and the original key:\n"
            f"  --state {args.state} --idempotency-key {idempotency_key}"
        )
    if not isinstance(created.get("id"), str) or not created["id"]:
        sys.exit("ERROR: response has no Call ID. Keep --state and retry unchanged; acceptance is uncertain.")
    print(f"call accepted: id={created['id']} status={created.get('status')}", flush=True)
    state["id"] = created["id"]
    write_payload(state, args.state)
    print(f"saved request and API Call ID to {args.state} (mode 0600)")
    print("next: python3 scripts/poll_result.py --call-id", created["id"])


if __name__ == "__main__":
    main()
