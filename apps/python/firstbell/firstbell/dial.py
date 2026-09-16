"""`python -m firstbell dial +NNNNNNNNNNN` : one real call, to a number you consent for.

Why this exists. Everything else in this tool takes a work file, because a school has one
and because a list of children is the unit the job is actually about. That is the wrong
shape for the one case where somebody wants to see the software work: a reviewer, a head
of year, or the author, who has one number, their own, and thirty seconds.

Why it does not just dial. The obvious version of this command takes a number and rings
it. That version is an auto-dialler, and it walks around `dispatch/consent.py`, which is
the check this entire tool argues a school should be doing before a phone rings. Shipping
a flag that skips your own central claim is worse than not shipping the flag.

So it goes through. `--i-consent` is an assertion about a specific number, and this
command turns that assertion into the thing the schema calls a consent record: dated,
scoped to voice and attendance, naming the number it covers, with the operator recorded as
the source. That record is written and then checked by the same code that checks a
district's register. The gate is not bypassed for the demonstration; the demonstration is
the gate working.

What it is not. It is not a way to give consent on somebody else's behalf. The wording of
the flag, the prompt it prints and the record it writes all say the same thing: the person
running the command is asserting they may lawfully call this number, and they are
accountable for that. `docs/consent-record.md` is explicit that nothing in this repository
makes a call lawful, and that is as true here as anywhere else.

Everything after the record is written is the ordinary path. This builds a one-row work
file and a one-record register and hands both to `main()`, so the dispatch, the retries,
the schema check, the escalation rule and the receipt are the tested code and not a second
implementation that only this command uses.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import date
from pathlib import Path

from dispatch.e164 import canonical
from dispatch.models import mask

# What counts as a diallable number lives in `dispatch/e164.py`, and this command uses
# it rather than keeping its own copy: this path and a district work file reach the same
# dialler, and a second spelling of "diallable" is a second thing to get wrong.
#
# The rule it replaced was `re.match(r"^\+[1-9]\d{7,14}$", number)`, which had two holes.
# `\d` on a str pattern matches Eastern Arabic and Devanagari numerals, so a number in
# digits no telephone network carries was accepted. And `$` matches immediately before a
# trailing newline as well as at the end, so a pasted `+915550000001` with the newline
# still attached passed the check and went to the platform with the newline on it.

CONSENT_ID = "CR-DIAL-{day}"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m firstbell dial",
        description="Place one real attendance call to a number you consent for.")
    p.add_argument("number",
                   help="The number to call, in E.164, for example +915550000001.")
    p.add_argument("--i-consent", action="store_true",
                   help="Assert that you may lawfully call this number. Required. "
                        "Writes a dated consent record naming it, which the run then "
                        "checks like any other.")
    p.add_argument("--locale", default="en-IN",
                   help="The language to call in (default: en-IN). ta-IN is the other "
                        "one this project has real recordings for.")
    p.add_argument("--name", default="the student",
                   help="The student name the call will use (default: the student).")
    p.add_argument("--receipt", type=Path, default=None,
                   help="Where to write the receipt. Default: a temporary file, whose "
                        "path is printed.")
    p.add_argument("--offline", action="store_true",
                   help="Run against the bundled double instead of the real API. No "
                        "call, no credits, same code path.")
    return p


def consent_record(number: str, today: date) -> dict:
    """One record, for one number, dated today, scoped as narrowly as the schema allows.

    `expires_at` is today. A permission asserted at a command line to place one call has
    no business outliving that call, and a register full of open-ended records created by
    a demonstration command is exactly the boolean-column problem this schema replaced.
    """
    return {
        "id": CONSENT_ID.format(day=today.isoformat()),
        "student_id": "S-DIAL",
        "guardian_name": "the person running this command",
        "channel": "voice",
        "purpose": "attendance",
        "given_at": today.isoformat(),
        "expires_at": today.isoformat(),
        "withdrawn_at": None,
        "phones": [number],
        "evidence": "asserted with --i-consent at the command line by the operator",
        "recorded_by": "python -m firstbell dial",
    }


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    # Grouping is stripped by `canonical`, not here, so this command accepts every
    # spelling a work file does and dials the one exact string either way.
    number = canonical(args.number)

    if number is None:
        # Masked like any other destination. Text that fails this check is usually a
        # typo, and a typo in a telephone number is still somebody's telephone number.
        print(f"{mask(args.number.strip())} is not an E.164 number.\n"
              "It needs a leading +, then a country code that does not start with "
              "zero, then the number: +915550000001. ASCII digits only, eight to "
              "fifteen of them, and no letters.")
        return 2

    if not args.i_consent:
        print(
            f"Refusing to call {mask(number)} without --i-consent.\n"
            "\n"
            "This tool checks a dated consent record before every call it places, and "
            "this command is not an exception to that: it writes one for the number you "
            "give it and then checks it, so the run is the same run a school would get.\n"
            "\n"
            "Passing --i-consent asserts that you may lawfully call this number. Use it "
            "on your own line. Nothing here makes a call lawful; see "
            "docs/consent-record.md.\n"
            "\n"
            "  python -m firstbell dial <the number you gave> --i-consent\n"
            "\n"
            "The number is masked above deliberately. A refusal is printed to a "
            "terminal that is often recorded or piped to a file, and a destination "
            "nobody has consented to is the last thing that should outlive the "
            "command in a scrollback.")
        return 2

    today = date.today()
    record = consent_record(number, today)
    work_dir = Path(tempfile.mkdtemp(prefix="firstbell-dial-"))

    # Written to a temporary directory, not to the repository. It names a real telephone
    # number, and the pull-request checklist forbids one of those in the tree.
    register = work_dir / "consent.json"
    register.write_text(json.dumps({"records": [record]}, indent=2), encoding="utf-8")

    work = work_dir / "one.csv"
    work.write_text(
        "id,phones,locale,region,consent,consent_record,student_name,absence_date\n"
        f"S-DIAL,{number},{args.locale},"
        f"{number[1:3] if number.startswith('+9') else ''},yes,"
        f"{record['id']},{args.name},{today.isoformat()}\n",
        encoding="utf-8")

    receipt = args.receipt or (work_dir / "receipt.json")

    from .cli import main as run

    argv2 = [
        "--work-file", str(work),
        "--consent-records", str(register),
        # One. Twice, because a mistake here is a phone call.
        "--limit", "1", "--max-calls", "1", "--concurrency", "1",
        "--receipt", str(receipt),
        "--include-transcript",
    ]
    if not args.offline:
        argv2 += ["--live", "--yes-i-mean-it"]

    # Masked for the reason the refusal is. The record itself, in the temporary
    # directory whose path is printed on the next line, carries the real number: this
    # line is the copy that ends up in a terminal log or a screen recording.
    print(f"consent record {record['id']} written for {mask(number)}, "
          "valid today only")
    print(f"receipt will be at {receipt}")
    code = run(argv2)
    print(f"\nreceipt: {receipt}")
    return code
