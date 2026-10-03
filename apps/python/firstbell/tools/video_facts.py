"""Every number and colour the demo video is allowed to put on screen, derived here.

The video is built outside this repository, which is how it came to publish two figures
that had rotted. A caption plate rendered "The suite goes from 78 passing to a failure that
names itself" and "Thirteen rules were checked this way", baked into a PNG, while the suite
had grown to three hundred and the mutation table to a hundred and thirty-eight rows.
Nothing could have caught it: the plate was a picture, the generator lived in a scratch
directory, and no gate in this repository has ever been able to see either.

That is the same defect this entry exists to argue against, sitting inside the artifact a
judge watches rather than the one they read.

So the video stops typing numbers. It reads this file, which computes every one of them
from the thing it describes, exactly as the judge page already does. A card can still be
wrong about what it means, but it can no longer be wrong about what it counts.

The palette is here for the same reason. The page's inks are defined in `page.css` and the
video's were retyped into a Python file beside it, so the two could drift a hue apart
without anything noticing. They are now read out of the stylesheet.

Run it:

    python tools/video_facts.py            # human readable
    python tools/video_facts.py --json     # what the video build consumes

`--json` is the interface. The video build is not in this repository and must not have to
import Python from it, so the contract between them is one JSON document on stdout.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP / "tools"))
# The cost card reads the wage constants out of the program itself rather than a
# second copy of them, so `firstbell` has to be importable from here as well.
sys.path.insert(0, str(APP))

# The stylesheet is the single definition of every colour this project uses. Reading the
# tokens out of it rather than restating them means a re-cut on the page reaches the video
# on the next build, which is the whole point of the file existing.
TOKEN = re.compile(r"^\s*(--[a-z0-9-]+):\s*(oklch\([^)]*\))\s*;", re.MULTILINE)

# Only the tokens the video actually paints with. A card that wants a colour not on this
# list should add it here on purpose rather than reach into the stylesheet for whatever it
# finds, because that is how a video ends up using a token meant for a focus ring.
VIDEO_TOKENS = (
    "--paper", "--card", "--ink", "--ink-2", "--ink-3",
    "--line", "--line-strong",
    "--resolved", "--undetermined", "--failed",
    "--live", "--link",
)


def _oklch_to_srgb(text: str) -> str:
    """Convert one `oklch(L C H)` declaration to a `#RRGGBB` string.

    The video renders through Remotion, and a browser would resolve `oklch()` itself, but
    the cards are also drawn by Pillow in places and Pillow has never heard of it. One
    conversion here keeps both consumers on the same value rather than letting the two
    render paths disagree about what `--resolved` looks like.
    """
    import math

    found = re.findall(r"-?\d*\.?\d+", text)
    lightness, chroma, hue = (float(v) for v in found[:3])
    hr = math.radians(hue)
    a, b = chroma * math.cos(hr), chroma * math.sin(hr)

    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3

    red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    blue = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def channel(value: float) -> int:
        value = max(0.0, min(1.0, value))
        srgb = value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
        return round(srgb * 255)

    return "#%02X%02X%02X" % (channel(red), channel(green), channel(blue))


def palette() -> dict[str, str]:
    """The video's colours, read out of the page's own stylesheet."""
    css = (APP / "tools" / "site" / "page.css").read_text(encoding="utf-8")
    found = dict(TOKEN.findall(css))
    missing = [name for name in VIDEO_TOKENS if name not in found]
    if missing:
        raise SystemExit(
            f"page.css no longer defines {', '.join(missing)}. The video paints with these, "
            "so a rename here is a rename the video has to be told about."
        )
    return {name.lstrip("-"): _oklch_to_srgb(found[name]) for name in VIDEO_TOKENS}


def mutation_count() -> int:
    """Rows in the mutation table, counted by the same reader the page uses."""
    from judge_page import mutation_rows

    return len(mutation_rows())


def test_count() -> int:
    """What `pytest -q` would print, taken from pytest's own collection.

    Counting `def test_` in the source would give a different number, because parametrised
    tests collect more than once. The video says the number a reviewer sees when they run
    the suite, so it has to come from the thing that prints it.
    """
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "--collect-only", "-q",
         "-p", "no:cacheprovider"],
        cwd=APP, capture_output=True, text=True,
    )
    found = re.search(r"(\d+) tests? collected", proc.stdout)
    if not found:
        raise SystemExit(
            "could not read a collected test count out of pytest. The video will not be "
            "given a number nobody measured:\n" + proc.stdout[-400:]
        )
    return int(found.group(1))


def browser_gate_count() -> tuple[int, int]:
    """Gates passed and gates run, read off the last gate report.

    Returns a COULD-NOT-MEASURE rather than a zero when the report is absent, because a
    video that says "0 of 0 gates" because a file was missing is worse than one that
    refuses to render.
    """
    report = APP / "tools" / "gates" / "gate-report.json"
    if not report.exists():
        raise SystemExit(
            "tools/gates/gate-report.json is not here, so the number of browser gates "
            "cannot be measured. Run `node tools/gates/run.mjs` before building the video."
        )
    data = json.loads(report.read_text(encoding="utf-8"))
    gates = data.get("gates") or data.get("results") or []
    passed = sum(1 for g in gates if str(g.get("status", "")).upper() == "PASS")
    return passed, len(gates)


def sourced_figures() -> list[dict]:
    """The externally published numbers, each with the source that settles it.

    A figure the video puts on screen without its publisher is a figure a judge cannot
    check, so the whole record travels rather than just the value.
    """
    data = json.loads((APP / "evidence" / "statistics.json").read_text(encoding="utf-8"))
    return [
        {k: fig[k] for k in ("id", "value", "claim", "publisher", "url", "published")}
        for fig in data["figures"]
    ]


def calls(receipts_dir: Path) -> dict[str, dict]:
    """Every work item a receipt records, with its call identifier already masked.

    The call panels in the video were typed by hand and printed three identifiers at full
    length, months after `judge_page.mask_id` had stripped them from the page "so a new
    surface cannot reintroduce a whole one". The video was that new surface: it is built
    outside this repository, so nothing here could see it.

    Masking on the way out is not enough when the caller holds the whole value anyway, so
    this returns work item to masked id and the video build is never handed a complete one.
    """
    import judge_page

    judge_page.RECEIPTS = receipts_dir
    out: dict[str, dict] = {}
    for _name, receipt in judge_page.receipts():
        for item in receipt.get("items", []):
            work_item = item.get("id")
            if not work_item or work_item in out:
                continue
            out[work_item] = {
                "call_id_masked": judge_page.mask_id(item.get("call_id") or ""),
                "resolution": item.get("resolution"),
                "reason": item.get("reason"),
            }
    return dict(sorted(out.items()))


def live_runs(receipts_dir: Path) -> dict[str, int]:
    """Runs that reached the production API, and how many calls they placed between them.

    The evidence card counted "receipts from calls against the live API: 4" for as long as
    the card existed. There were four when somebody typed it. There are six now, and they
    placed twelve calls. Nothing was going to notice, because the number was a string in a
    generator that no longer exists.
    """
    import judge_page

    judge_page.RECEIPTS = receipts_dir
    runs = [r for _name, r in judge_page.receipts() if r.get("reached_production_api")]
    if not runs:
        raise SystemExit(
            f"no receipt under {receipts_dir} records reaching the production API, so the "
            "evidence card cannot be given a count. This is a measurement failure, not a "
            "zero."
        )
    return {
        "runs": len(runs),
        "calls_placed": sum(int(r.get("calls_placed") or 0) for r in runs),
    }


def economics() -> dict:
    """What the demonstration run costs against what a desk costs, from the run itself.

    Somebody reading the entry as a buyer reported that the whole business case was inside
    a console shot at eleven pixels, "in a font I cannot read", and that a unit price is not
    a budget. The numbers were good and they were unreadable, which is the same as not
    having them.

    The same reader later found four different per-call figures across three surfaces, all
    of them arithmetic this program printed, none of them saying which run they came from.
    So this card leads with what the account was billed, and the two ceilings are labelled:
    the net one is the figure the entry quotes everywhere, and the gross one is here because
    it is the larger and somebody who saw it in an older cut should be able to find it.

    They are computed rather than restated. `python -m firstbell --json` prints exactly what
    the human report prints, from the same summary object, so a card built on this cannot
    disagree with the terminal beside it in the cut.
    """
    from firstbell.domain import StaffCost

    proc = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv", "--json"],
        cwd=APP, capture_output=True, text=True,
    )
    start = proc.stdout.find("{")
    if start < 0:
        raise SystemExit(
            "the demonstration run printed no JSON, so the video cannot be given a cost "
            "case: " + (proc.stdout[-400:] or proc.stderr[-400:])
        )
    run = json.loads(proc.stdout[start:])

    ceiling = run["break_even_per_call_minute"]
    if not ceiling:
        raise SystemExit(
            "the run reported no break-even, which is a measurement failure rather than a "
            "cost of zero"
        )

    staff = StaffCost.us_school_office()
    # What the calls actually cost, from the account's own billing panel rather than from
    # an assumption. The file carries the three things thirteen calls cannot settle.
    price = json.loads(
        (APP / "evidence" / "observed-price.json").read_text(encoding="utf-8"))["observed"]
    # The work the safeguarding rule adds, at the counsellor wage, which the run computes
    # and prints. A ceiling that ignores it is the number this entry stopped quoting.
    added = run.get("escalation_cost_per_call_lead_minute") or 0.0
    return {
        # Money per call, per minute one manual attempt takes. A rate rather than a flat
        # saving, because what CALL-E charges is unpublished and a school knows its own
        # wage bill and its own call length.
        "break_even_per_call_minute": round(ceiling, 4),
        "break_even_at_three_minutes": round(ceiling * 3, 2),
        # Gross minus the callbacks, at three minutes for each. The one figure the README,
        # the page and this card all quote.
        "net_ceiling_at_three_minutes": round((ceiling - added) * 3, 2),
        "escalation_cost_at_three_minutes": round(added * 3, 2),
        "billed_per_call": price["per_call_usd"],
        "billed_events": price["billed_events"],
        "billed_total": price["period_total_usd"],
        "currency": staff.currency,
        "hourly": round(staff.hourly, 2),
        "annual": staff.annual,
        "hours_per_year": staff.hours_per_year,
        "occupation": staff.occupation,
        "industry": staff.industry,
        "source": staff.source,
        "source_url": staff.source_url,
        "attempts_billed": run["attempts_billed"],
        "attempts_removed": run["attempts_removed"],
        "attempts_still_open": run["attempts_still_open"],
        # Deliberately null, and the card says so. Explaining an absence does not make a
        # child present, so no attendance funding is recovered by the call.
        "funding_recovered": run["funding_recovered"],
    }


def facts(receipts_dir: Path) -> dict:
    passed, ran = browser_gate_count()
    return {
        "tests": test_count(),
        "mutations": mutation_count(),
        "browser_gates_passed": passed,
        "browser_gates_run": ran,
        "figures": sourced_figures(),
        "palette": palette(),
        "calls": calls(receipts_dir),
        "live_runs": live_runs(receipts_dir),
        "economics": economics(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true",
                        help="emit the document the video build reads")
    parser.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"),
                        help="the receipts directory the page is built from")
    args = parser.parse_args()

    if not args.receipts:
        # Exit 3 and the same first word as the other four, rather than SystemExit's 1.
        # A reviewer reading a 1 has no way to tell a check that failed from an input that
        # was never going to be here.
        print("COULD-NOT-MEASURE  pass --receipts or set FIRSTBELL_RECEIPTS. The call\n"
              "                   panels read their identifiers from the receipts, so there\n"
              "                   is no default worth guessing. The recordings are\n"
              "                   deliberately not in this repository.")
        return 3
    receipts_dir = Path(args.receipts).resolve()
    if not receipts_dir.is_dir():
        print(f"COULD-NOT-MEASURE  --receipts {receipts_dir} is not a directory")
        return 3

    data = facts(receipts_dir)
    if args.json:
        print(json.dumps(data, indent=2))
        return 0

    print(f"tests            {data['tests']}")
    print(f"mutation rows    {data['mutations']}")
    print(f"browser gates    {data['browser_gates_passed']} of {data['browser_gates_run']}")
    print("figures")
    for fig in data["figures"]:
        print(f"  {fig['value']:>7}  {fig['claim'][:52]}  ({fig['publisher']})")
    print("palette")
    for name, value in data["palette"].items():
        print(f"  {name:<16} {value}")
    money = data["economics"]
    print(f"break-even       {money['currency']}{money['break_even_per_call_minute']:.2f}"
          f" per call per minute, {money['currency']}"
          f"{money['break_even_at_three_minutes']:.2f} at three minutes")
    print(f"live runs        {data['live_runs']['runs']}"
          f" placing {data['live_runs']['calls_placed']} calls")
    print("calls")
    for work_item, call in data["calls"].items():
        print(f"  {work_item:<8} {call['call_id_masked']:<18} {call['resolution']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
