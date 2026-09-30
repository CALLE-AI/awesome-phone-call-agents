"""Check the offline double against the shape the real CALL-E API actually returns.

    python tools/double_conformance.py                     # uses $FIRSTBELL_RECEIPTS
    python tools/double_conformance.py --receipts DIR
    python tools/double_conformance.py --check             # verify the committed record

Why this exists.

Everything offline in this project is measured against `calle_double`, a CALL-E written from
the published documentation. That buys reproducibility, and it costs something a reader should
be suspicious of: a test that asserts our code against our own model of the API constrains our
model, not the API. If the model is wrong in the same direction as the code, both agree and the
suite is green.

That is not hypothetical here. It happened. The double used to derive the task-level
`structured_result` from the first recipient's, and production does the reverse: it populates the
task-level field and leaves the per-recipient one null. A real response was the only thing that
could have shown that, and it did. The double also omitted four task-level fields the API
returns, one of which a test asserted on, so that test could never have run against the double
at all.

So this tool compares the double's output against responses recorded from the production API.
It reads those responses from a directory outside this repository, because no real-call artifact
is committed here, and it writes down only key paths and the JSON types found at them. A path
list carries no conversation, no phone number and no provider id, so it is publishable while the
responses it was derived from are not.

Three outcomes, not two. With no receipts directory there is nothing to compare against, and
that is reported as `could-not-measure` and exits 3. Reporting it as a pass would be the
specific dishonesty this tool was written to prevent.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

HERE = Path(__file__).resolve().parent
APP = HERE.parent
RECORD = APP / "evidence" / "api-shape.json"

sys.path.insert(0, str(APP))

from calle_double import CalleDouble, Outcome  # noqa: E402

# The recorded response files, by the stage of the run that produced them. Named individually
# rather than globbed so that a missing one is a visible absence rather than a smaller sample.
RECEIPT_FILES = (
    "stage1-raw-call.json",
    "ambiguous-raw.json",
    "noanswer-raw.json",
    "exp-raw-all.json",
)


def type_paths(value: Any, prefix: str = "") -> dict[str, set[str]]:
    """Every key path in a JSON document, mapped to the types found there.

    A list contributes one path with `[]` and is then walked through every element, not just
    the first: a field that is a string in one recipient and null in another is exactly the
    variation worth recording, and reading element zero alone would miss it.
    """
    found: dict[str, set[str]] = {}

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            if not node:
                found.setdefault(path + ".{}", set()).add("empty_object")
            for key, child in node.items():
                walk(child, f"{path}.{key}")
        elif isinstance(node, list):
            if not node:
                found.setdefault(path + "[]", set()).add("empty_array")
            for child in node:
                walk(child, f"{path}[]")
        else:
            found.setdefault(path, set()).add(type(node).__name__)

    walk(value, prefix)
    return found


def merge(into: dict[str, set[str]], other: dict[str, set[str]]) -> dict[str, set[str]]:
    for path, types in other.items():
        into.setdefault(path, set()).update(types)
    return into


def call_objects(document: Any) -> Iterable[dict[str, Any]]:
    """Pull every call task out of a recorded file, whatever wrapper it arrived in.

    The recorded files are not uniform: some hold one response, some a list, some a mapping of
    stage name to response. A call task is identified by carrying `recipients`, which is the
    one field every response in the API has and no wrapper does.
    """
    pending = [document]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            if "recipients" in node and "id" in node:
                yield node
                continue
            pending.extend(node.values())
        elif isinstance(node, list):
            pending.extend(node)


SCHEMA = {
    "type": "object",
    "required": ["reason_category", "expected_return"],
    "properties": {
        "reason_category": {"type": "string"},
        "expected_return": {"type": "string"},
        "parent_confirmed_aware": {"type": "string"},
        "free_text_note": {"type": "string"},
    },
}
TALK = (("bot", "hello"), ("human", "she is unwell"), ("bot", "thank you"))


def double_paths() -> dict[str, set[str]]:
    """Drive the double through every outcome it can produce and collect the shapes.

    All four outcomes are needed. A failure path carries `failure_code` and an empty
    `transcript_turns`; an answered path carries a populated `structured_result`. Sampling one
    outcome would report the double as missing fields it emits perfectly well in another.
    """
    shapes: dict[str, set[str]] = {}
    cases = {
        "answered": Outcome.answered(
            {"reason_category": "illness", "expected_return": "tomorrow",
             "parent_confirmed_aware": "yes", "free_text_note": "back Monday"}, TALK),
        "no_answer": Outcome.no_answer(),
        "declined": Outcome.declined(),
        "ambiguous": Outcome.ambiguous(TALK),
    }
    for index, (name, outcome) in enumerate(cases.items()):
        phone = f"+9155500000{index:02d}"
        double = CalleDouble()
        double.set_outcome(phone, outcome)
        created = double.create_call(
            task=f"conformance probe: {name}",
            recipients=[{"phones": [phone], "locale": "ta-IN", "region": "IN"}],
            result_schema=SCHEMA,
            metadata={"work_item": "S-0001"},
        )
        merge(shapes, type_paths(double.get_call(created["id"])))
    return shapes


def real_paths(receipts: Path) -> tuple[dict[str, set[str]], int, list[str]]:
    shapes: dict[str, set[str]] = {}
    seen = 0
    read: list[str] = []
    for name in RECEIPT_FILES:
        path = receipts / name
        if not path.exists():
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        for call in call_objects(document):
            merge(shapes, type_paths(call))
            seen += 1
        read.append(name)
    return shapes, seen, read


def serialise(shapes: dict[str, set[str]]) -> dict[str, list[str]]:
    return {path: sorted(types) for path, types in sorted(shapes.items())}


def compare(real: dict[str, set[str]], double: dict[str, set[str]]) -> dict[str, Any]:
    """What the double is missing, and where its types disagree.

    Extra paths in the double are listed but do not fail the check. The double models more
    than any one recorded run exercises, so a path the sample never reached is not evidence of
    an invention. A path production returns and the double never emits is a different matter:
    code can depend on it, and offline nothing would notice.
    """
    missing = sorted(set(real) - set(double))
    extra = sorted(set(double) - set(real))
    mismatched = sorted(
        f"{path}: real {sorted(real[path])} vs double {sorted(double[path])}"
        for path in set(real) & set(double)
        if not real[path] & double[path]
    )
    return {"missing_in_double": missing, "extra_in_double": extra,
            "type_mismatches": mismatched}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"),
                        help="directory of recorded production responses, outside this repo")
    parser.add_argument("--check", action="store_true",
                        help="compare the live double against the committed record and stop")
    args = parser.parse_args()

    mine = double_paths()

    if args.check:
        if not RECORD.exists():
            print(f"COULD-NOT-MEASURE  no committed record at {RECORD}")
            return 3
        record = json.loads(RECORD.read_text(encoding="utf-8"))
        recorded = {path: set(types) for path, types in record["api_paths"].items()}
        verdict = compare(recorded, mine)
        problems = verdict["missing_in_double"] + verdict["type_mismatches"]
        for path in verdict["missing_in_double"]:
            print(f"MISSING  the API returns {path} and the double never emits it")
        for line in verdict["type_mismatches"]:
            print(f"TYPE     {line}")
        print("PASS  the double emits every path the recorded API responses carry"
              if not problems else f"FAIL  {len(problems)} divergence(s)")
        return 1 if problems else 0

    if not args.receipts:
        print("COULD-NOT-MEASURE  no receipts directory given, so there is nothing to compare\n"
              "                   against. Pass --receipts DIR or set FIRSTBELL_RECEIPTS.\n"
              "                   The recorded responses are deliberately not in this\n"
              "                   repository, so this is the expected result for anyone but\n"
              "                   the author. Run --check instead: it verifies the double\n"
              "                   against the shape recorded in evidence/api-shape.json.")
        return 3
    receipts = Path(args.receipts)
    theirs, seen, read = real_paths(receipts)
    if not seen:
        print(f"COULD-NOT-MEASURE  no recorded call responses found under {receipts}")
        return 3

    verdict = compare(theirs, mine)
    record = {
        "what": "Key paths and JSON types returned by the CALL-E production API, and by the "
                "offline double, compared. Paths and type names only: no transcript text, no "
                "phone number, no provider call id, and no field value of any kind.",
        "why": "The offline suite measures our code against our own model of the API. This "
               "record is the evidence that the model matches the real thing, and it is what "
               "keeps a future edit from quietly narrowing it.",
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "responses_compared": seen,
        "recorded_files_read": read,
        "api_paths": serialise(theirs),
        "double_paths": serialise(mine),
        **verdict,
    }

    # Rewrite only when something other than the clock changed. A generator that dirties its
    # own output on every run teaches the reader to ignore the diff, which is the one thing
    # this record needs them not to do.
    def substance(doc: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in doc.items() if k != "generated"}

    if RECORD.exists():
        previous = json.loads(RECORD.read_text(encoding="utf-8"))
        if substance(previous) == substance(record):
            print(f"{seen} recorded response(s): the shape is unchanged, "
                  f"{RECORD.name} left alone")
            return 0
    RECORD.write_text(json.dumps(record, indent=2, sort_keys=False) + "\n",
                      encoding="utf-8")

    print(f"{seen} recorded response(s) from {len(read)} file(s): "
          f"{len(theirs)} API paths, {len(mine)} double paths")
    for path in verdict["missing_in_double"]:
        print(f"  MISSING  {path}")
    for line in verdict["type_mismatches"]:
        print(f"  TYPE     {line}")
    print(f"  (+{len(verdict['extra_in_double'])} paths the double models beyond this sample)")
    print(f"wrote {RECORD.relative_to(APP)}")
    problems = verdict["missing_in_double"] + verdict["type_mismatches"]
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
