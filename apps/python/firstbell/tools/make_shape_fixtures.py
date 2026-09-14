"""Generate the response fixtures the dispatcher tests read.

    python tools/make_shape_fixtures.py            # write tests/data/shape-*.json
    python tools/make_shape_fixtures.py --check     # fail if the committed files differ

Why these are generated and not recorded.

Three of the defects this dispatcher guards against were found by placing real calls, and for
a while the recorded responses themselves were the fixtures. They are not any more. The
upstream maintainer requires that no real-call artifact sit in the tree, and that requirement
holds even for a call somebody placed to their own phone using a reserved number, which is
what these were. So the recordings stay where they were made, outside this repository, and the
linked page publishes them with the transcript of each call and a shortened id. The receipt
files are on neither surface; the counts they produced are in evidence/recorded-calls.json.

That leaves a real question: if the fixture is authored, what stops it from being whatever
shape makes the tests pass?

The answer is that these are not hand-written. They are emitted by `calle_double`, and the
double's likeness to the production API is itself measured, by `tools/double_conformance.py`
against those recorded responses, and gated by
`test_the_double_emits_every_field_the_real_api_returns`. Every field, type, vocabulary and
timestamp relation in the files below therefore comes from something checked against
production rather than from anybody's memory of it.

What is authored, and should be read as authored: the words spoken. The Tamil and English
turns here were written for this fixture. They are not a transcript of anything, and nothing
in the suite treats them as evidence about what a real conversation contained. The claim that
CALL-E honours a requested locale is not made by these files; it is made by the receipts, and
the test that reads the Tamil here is named for what it actually checks, which is our own
reader.

Determinism. The double is pinned to a fixed clock and its ids come from a counter, so the same
call sequence produces byte-identical output every run. `--check` is what the drift test uses,
and it is the reason a hand edit to one of these files cannot survive.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
APP = HERE.parent
DATA = APP / "tests" / "data"

sys.path.insert(0, str(APP))

from calle_double import CalleDouble, Outcome  # noqa: E402

# A fixed instant, so the timestamps in the committed files never move. The date is the day
# the recorded responses this double was measured against were captured.
CLOCK = datetime(2026, 9, 4, 9, 15, 0, tzinfo=timezone.utc)

SCHEMA = {
    "type": "object",
    "required": ["reason_category", "expected_return"],
    "properties": {
        "reason_category": {"type": "string",
                            "enum": ["illness", "transport", "other", "unknown"]},
        "expected_return": {"type": "string",
                            "enum": ["today", "tomorrow", "later_this_week", "unknown"]},
        "parent_confirmed_aware": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "free_text_note": {"type": "string"},
    },
}

# Authored dialogue. Written for this fixture, not transcribed from a call. It is here because
# the reader has to cope with a conversation that never uses the alphabet the enum values are
# written in, and a fixture in English would not exercise that.
TAMIL_TURNS = (
    ("bot", "வணக்கம், இது பள்ளி அலுவலகத்திலிருந்து அழைக்கிறோம். "
            "இன்று உங்கள் மகள் பள்ளிக்கு வரவில்லை. காரணம் தெரியுமா?"),
    ("user", "அவளுக்கு உடம்பு சரியில்லை. நேற்று இரவு முதல் காய்ச்சல் இருக்கிறது."),
    ("bot", "புரிந்தது. நாளை பள்ளிக்கு வர முடியுமா?"),
    ("user", "ஆம், நாளை வருவாள். நான் அவளுடன் இருக்கிறேன்."),
    ("bot", "நன்றி. குணமாக வாழ்த்துகள்."),
)

# Somebody answers, talks, and the schema still cannot be filled from what they said. The
# extraction returns every required field as "unknown" and says so in its own note.
BUSY_TURNS = (
    ("bot", "Hello, this is the school office. Your daughter was marked absent today. "
            "Can you tell me why?"),
    ("user", "Sorry, I am at work right now, I cannot talk."),
    ("bot", "I understand. Would another time suit you better?"),
    ("user", "Call the house later."),
)


def shapes() -> dict[str, dict[str, Any]]:
    """One call per fixture, each on its own double so the ids start from the same place."""
    out: dict[str, dict[str, Any]] = {}

    # 1. The result arrives at the task level and the per-recipient field is null, because
    #    the request asked for a task result and nothing else. The first version of this
    #    dispatcher read only the per-recipient field and sent completed calls to a human.
    double = CalleDouble(now=CLOCK, latency_seconds=0)
    double.set_outcome("+915550000002", Outcome.answered(
        {"reason_category": "illness", "expected_return": "tomorrow",
         "parent_confirmed_aware": "yes",
         "free_text_note": "Fever since last night; a parent is at home."},
        TAMIL_TURNS,
        summary="Reached a parent, who gave a reason and a return date."))
    created = double.create_call(
        task="Ask why the student was absent and when they will return.",
        recipients=[{"phones": ["+915550000002"], "locale": "ta-IN", "region": "IN"}],
        result_schema=SCHEMA, metadata={"work_item": "S-2002"})
    out["shape-task-result-only.json"] = double.get_call(created["id"])

    # 2. Nobody is reached. The task says call_failed, the attempt says 603, and the attempt
    #    lasted zero seconds. SIP calls 603 "Decline", and the zero duration is the reason
    #    this dispatcher refuses to put that word in front of an administrator.
    double = CalleDouble(now=CLOCK, latency_seconds=0)
    double.set_outcome("+915550000003", Outcome.no_answer())
    created = double.create_call(
        task="Ask why the student was absent and when they will return.",
        recipients=[{"phones": ["+915550000003"], "locale": "ta-IN", "region": "IN"}],
        result_schema=SCHEMA, metadata={"work_item": "S-2003"})
    out["shape-declined-603.json"] = double.get_call(created["id"])

    # 3. Completed, schema-valid, and it learned nothing. Every required field came back
    #    "unknown". Branching on status alone files this as contacted and closes the record.
    double = CalleDouble(now=CLOCK, latency_seconds=0)
    double.set_outcome("+915550000004", Outcome.answered(
        {"reason_category": "unknown", "expected_return": "unknown",
         "parent_confirmed_aware": "unknown",
         "free_text_note": "The contact was at work and could not talk. No reason for the "
                           "absence and no return date were collected."},
        BUSY_TURNS,
        summary="Spoke to the contact, who could not talk."))
    created = double.create_call(
        task="Ask why the student was absent and when they will return.",
        recipients=[{"phones": ["+915550000004"], "locale": "en-IN", "region": "IN"}],
        result_schema=SCHEMA, metadata={"work_item": "S-2004"})
    out["shape-all-unknown.json"] = double.get_call(created["id"])

    return out


PROVENANCE = (
    "Authored, not recorded. Emitted by tools/make_shape_fixtures.py from calle_double, "
    "whose likeness to the production API is measured by tools/double_conformance.py and "
    "gated by test_the_double_emits_every_field_the_real_api_returns. The spoken turns were "
    "written for this fixture and are not a transcript of any call. No real-call artifact is "
    "committed to this repository. The recordings and transcripts of the calls that were "
    "placed are on the linked evidence page; their receipt files are in neither place, and "
    "the counts those receipts produced are in evidence/recorded-calls.json."
)


def render(name: str, call: dict[str, Any]) -> str:
    body = {"_provenance": PROVENANCE, **call}
    return json.dumps(body, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="compare the committed files against a fresh generation")
    args = parser.parse_args()

    generated = {name: render(name, call) for name, call in shapes().items()}

    if args.check:
        problems = []
        for name, text in generated.items():
            path = DATA / name
            if not path.exists():
                problems.append(f"{name} is missing")
                continue
            # newline="" so a line-ending change is a difference rather than being hidden by
            # universal newlines. These files are declared eol=lf in .gitattributes.
            on_disk = path.read_text(encoding="utf-8", newline="")
            if on_disk != text:
                problems.append(f"{name} differs from what the generator produces")
        stray = sorted(p.name for p in DATA.glob("shape-*.json")
                       if p.name not in generated)
        problems += [f"{name} is not produced by this generator any more" for name in stray]
        for line in problems:
            print(f"DRIFT  {line}")
        print("PASS  every fixture matches the generator" if not problems
              else f"FAIL  {len(problems)} fixture(s) drifted")
        return 1 if problems else 0

    DATA.mkdir(parents=True, exist_ok=True)
    for name, text in generated.items():
        path = DATA / name
        before = path.read_text(encoding="utf-8", newline="") if path.exists() else None
        if before == text:
            print(f"  unchanged  {name}")
            continue
        # newline="" so the LF in the rendered text is written literally on Windows too.
        with path.open("w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        print(f"  {'updated' if before else 'wrote'}    {name}  ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
