# -*- coding: utf-8 -*-
"""Show the call you would place, without placing it.

    python dry_run.py "students only" "Students only"
    python dry_run.py "advancement costs money" "the remaining 90 teams will be
                       responsible for a registration fee"

It prints the exact task text and the result schema, with a fictional phone
number, and exits non zero when the clause does not justify a call.

WHY THIS EXISTS. A developer gets twenty free calls. Tuning a call task by
placing it spends them all and leaves none to demonstrate anything. Everything
that can be settled without dialling is settled here.

This is also the no-call path the repository asks every runnable contribution
to provide.
"""
from __future__ import annotations
import json
import sys

from bridge import call_task, FAMILIES, NothingToAsk, validate_result_schema

# A fictional number, in the range reserved for documentation. It is never
# dialled by this script, which places no call at all.
FICTIONAL = "+33000000000"


def main(argv=None):
    a = argv or sys.argv[1:]
    if len(a) < 2:
        print(__doc__.strip())
        print("\nknown families")
        for f in FAMILIES:
            print("  %s" % f)
        return 2
    family = a[0]
    # A trailing `--country X` supplies the context some families require.
    context, rest = {}, a[1:]
    if "--country" in rest:
        at = rest.index("--country")
        if at + 1 < len(rest):
            context["country"] = rest[at + 1]
        rest = rest[:at] + rest[at + 2:]
    quote = " ".join(rest)
    try:
        prepared = call_task(FICTIONAL, family, quote, "dry run", context)
    except NothingToAsk as e:
        print("NO CALL JUSTIFIED, %s" % e)
        print("This is not a failure. It is the common case, and it is the")
        print("reason this path exists.")
        return 1

    print("CLAUSE, family %s" % prepared["family"])
    print("  the page says, %s" % prepared["quote"])
    print("\nCALL TASK, exactly as it would be sent")
    for part in prepared["task"].split(". "):
        if part.strip():
            print("  %s." % part.strip().rstrip("."))
    print("\nEXPECTED RESULT SCHEMA")
    print(json.dumps(prepared["result_schema"], ensure_ascii=False, indent=2))

    problems = validate_result_schema(prepared["result_schema"])
    print("\nSCHEMA CHECKED AGAINST THE PROVIDER CONTRACT")
    if problems:
        for problem in problems:
            print("  REJECTED, %s" % problem)
        print("  A malformed schema is not refused when the call is created.")
        print("  The call runs and the structured result comes back null, so")
        print("  the check belongs here, before anyone's phone rings.")
        return 1
    print("  conforming, the provider will be able to return a result")

    print("\nNo call was placed. The number above is fictional.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
