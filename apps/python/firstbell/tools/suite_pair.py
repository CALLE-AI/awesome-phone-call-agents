"""Measure the suite and write the pair down, so nothing has to type it.

The stat card on the first screen of the reviewer page says how many of the collected tests
actually run on a build like the one being read. That number could not be measured where it
was used: collecting is cheap, but a pass-and-skip pair needs the suite to run, and the suite
reads the page the builder is building. So the builder read the pair out of a sentence in the
README, and its own docstring said as much: "The page cannot measure the pair for itself."

A reviewer in the buyer's seat found that and was right to. In an entry whose argument is
that a claim ships with the thing that checks it, the largest count on the front screen was
the one figure a person had typed. The collected count was held against a live collection.
The pair beside it was held against nothing but the sentence it came from.

This runs the suite, writes what happened to `evidence/suite-pair.json`, and the builder
reads that. It is not part of the suite, for the reason a gate cannot require what it
produces: a test that ran this would be measuring a run that included itself.

    python tools/suite_pair.py                 # measure and write
    python tools/suite_pair.py --check         # compare the file to a fresh run

`--check` exits 1 on a disagreement and 3 when it could not measure, which is the same
three-outcome contract the rest of this repository uses.

The pair depends on what is on disk. A built tree with a gate report runs more of the suite
than a clean checkout does, and both numbers are true of their own tree, so the file records
which one it measured and the README publishes both.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent
OUT = APP / "evidence" / "suite-pair.json"

TAIL = re.compile(r"(?:(\d+) failed,\s*)?(\d+) passed(?:,\s*(\d+) skipped)?")


def measure() -> dict:
    """Run the suite and read its own last line, which is the only summary pytest gives.

    Parsed rather than counted from the exit status, because the exit status cannot tell a
    skip from a pass and the whole point of this file is the difference between them.
    """
    done = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"],
                          cwd=APP, capture_output=True, text=True)
    lines = [line for line in done.stdout.splitlines() if line.strip()]
    if not lines:
        raise SystemExit(f"pytest printed nothing:\n{done.stderr[-2000:]}")

    for line in reversed(lines):
        found = TAIL.search(line)
        if found:
            failed = int(found.group(1) or 0)
            passed = int(found.group(2))
            skipped = int(found.group(3) or 0)
            break
    else:
        raise SystemExit(f"no pytest summary line in:\n{lines[-1]!r}")

    built = (APP / "out" / "index.html").is_file()
    report = (APP / "tools" / "gates" / "gate-report.json").is_file()
    return {
        "what_this_is": (
            "What the suite did on the tree this was run against, written by "
            "tools/suite_pair.py rather than typed. The stat card on the reviewer page "
            "reads this file. A pass-and-skip pair cannot be measured by the builder "
            "itself, because the suite reads the page the builder writes, so it used to "
            "come out of a sentence in the README and was the one number on the front "
            "screen that nothing checked."),
        "why_the_pair_is_not_one_number": (
            "A skip here is a could-not-measure and not a pass. Some gates need a built "
            "page, the recordings that are held outside this repository, or a gate report "
            "from node tools/gates/run.mjs. A clean checkout skips more of them and its "
            "pair is equally true of it, so the README publishes both and this records "
            "which tree was measured."),
        "collected": passed + skipped + failed,
        "passed": passed,
        "skipped": skipped,
        "failed": failed,
        "tree": ("built" if built and report else
                 "built page, no gate report" if built else "clean checkout"),
        "page_present": built,
        "gate_report_present": report,
        "measured_on": date.today().isoformat(),
        "regenerate_with": "python tools/suite_pair.py",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="suite_pair", description="Measure the suite and record the pair.")
    parser.add_argument("--check", action="store_true",
                        help="compare the recorded pair to a fresh run instead of writing")
    args = parser.parse_args(argv)

    if args.check:
        if not OUT.is_file():
            print(f"COULD-NOT-MEASURE  no {OUT.relative_to(APP)}. Run this without "
                  "--check to write it.")
            return 3
        held = json.loads(OUT.read_text(encoding="utf-8"))
        fresh = measure()
        if held["tree"] != fresh["tree"]:
            print(f"COULD-NOT-MEASURE  the recorded pair was measured on a "
                  f"{held['tree']} and this is a {fresh['tree']}, which run different "
                  "numbers of gates. Nothing here disagrees; the two are not comparable.")
            return 3
        if held.get("failed"):
            print(f"{OUT.name} was written by a run with {held['failed']} failing "
                  "test(s), so the pair on the reviewer page's first screen was measured "
                  "on a red suite. Fix the suite and run this again without --check.")
            return 1
        same = all(held.get(k) == fresh[k] for k in ("collected", "passed", "skipped"))
        if not same:
            print(f"the recorded pair is {held.get('passed')} passed, "
                  f"{held.get('skipped')} skipped of {held.get('collected')}; this run "
                  f"gives {fresh['passed']} passed, {fresh['skipped']} skipped of "
                  f"{fresh['collected']}.")
            return 1
        print(f"suite-pair.json agrees with this run: {fresh['passed']} passed, "
              f"{fresh['skipped']} skipped of {fresh['collected']}, on a {fresh['tree']}.")
        return 0

    facts = measure()
    OUT.write_text(json.dumps(facts, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{OUT.relative_to(APP)}  {facts['passed']} passed, {facts['skipped']} skipped "
          f"of {facts['collected']}, on a {facts['tree']}.")
    if facts["failed"]:
        print(f"{facts['failed']} failed. The pair is recorded as measured, because a file "
              "that quietly refused to record a red run would be the more dangerous of the "
              "two behaviours.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
