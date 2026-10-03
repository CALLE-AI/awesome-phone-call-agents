"""The demonstration scenario as a file the HTTP double can read.

The README offers two ways to run against the double, and for a long time only one of
them worked. In process, `firstbell/scenario.py` binds a fixed mixed morning to the
example numbers: two answered in two languages, one answered on the second number, one
real conversation that yields nothing, one nobody home, one safeguarding case. Over HTTP
the server had nothing bound, so every recipient got the double's fallback answer of
`{"ok": true}` and the application reported every call as missing `reason_category`. A
judge following the second path saw a product that did not work.

The scenario stays in `firstbell/scenario.py`, because the reasoning beside each outcome
is the reason those outcomes were chosen and a JSON file cannot hold it. This exports it,
so the file the server reads and the scenario the in-process run applies cannot describe
two different mornings.

    python tools/export_demo_outcomes.py            # write examples/demo-outcomes.json
    python tools/export_demo_outcomes.py --check     # fail if it has drifted

`--check` is what the suite runs. A generated file nobody compares is a file that goes
stale, and this project has that failure recorded three times over.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

OUT = APP / "examples" / "demo-outcomes.json"

COMMENT = (
    "The offline demonstration scenario, exported from firstbell/scenario.py by "
    "tools/export_demo_outcomes.py. Bind it with `python -m calle_double.server "
    "--outcomes examples/demo-outcomes.json` so the HTTP double answers the way the "
    "in-process one does. Every number and every conversation here is fictional. Do not "
    "edit this file: edit the scenario and re-export, because the comments beside those "
    "outcomes are the reasons they were chosen."
)


def document() -> dict:
    from calle_double import CalleDouble

    from firstbell.scenario import apply_demo_outcomes

    double = CalleDouble()
    apply_demo_outcomes(double)
    bound = double.outcomes()
    if not bound:
        raise SystemExit("the scenario bound nothing, so there is nothing to export")
    return {
        "_comment": COMMENT,
        "numbers": {phone: outcome.to_spec()
                    for phone, outcome in sorted(bound.items())},
    }


def rendered() -> str:
    return json.dumps(document(), indent=2, ensure_ascii=False) + "\n"


def _shown(path: Path) -> str:
    """A path a reader recognises, without assuming where it is.

    `relative_to` raises for anything outside the app, which a test pointing this at a
    temporary file discovers as a ValueError inside the very message that was meant to
    explain a drift.
    """
    try:
        return str(path.relative_to(APP))
    except ValueError:
        return str(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if the file on disk is not what this produces")
    args = ap.parse_args()

    text = rendered()
    if args.check:
        if not OUT.exists():
            print(f"{_shown(OUT)} is missing; run this without --check")
            return 1
        if OUT.read_text(encoding="utf-8") != text:
            print(f"{_shown(OUT)} has drifted from firstbell/scenario.py; "
                  "run this without --check")
            return 1
        print(f"{_shown(OUT)} is what the scenario produces now")
        return 0

    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"{_shown(OUT)}: {len(document()['numbers'])} number(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
