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
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP / "tools"))

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


def facts() -> dict:
    passed, ran = browser_gate_count()
    return {
        "tests": test_count(),
        "mutations": mutation_count(),
        "browser_gates_passed": passed,
        "browser_gates_run": ran,
        "figures": sourced_figures(),
        "palette": palette(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true",
                        help="emit the document the video build reads")
    args = parser.parse_args()

    data = facts()
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
