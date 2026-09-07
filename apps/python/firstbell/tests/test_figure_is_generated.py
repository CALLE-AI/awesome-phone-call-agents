"""The figure has to come out the same every time the generator runs.

A drawing checked into a repository is a file somebody exported once, so this one is not
checked in at all. `judge_page.py` builds it during the page build and `.gitignore` keeps it
out of the tree. What is left to check is that the generator is deterministic: a figure that
comes out differently on a second run is a figure whose appearance depends on when somebody
happened to build the page.

The palette half is the reason this matters more than it looks. The figure's colours are read
out of `page.css` through `video_facts`, so re-cutting an ink and not regenerating leaves a
figure a hue behind the words next to it, on the one page whose argument is that its claims
carry the thing that checks them.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
FIGURES = APP / "tools" / "site" / "figures"


def test_the_committed_figure_is_what_the_generator_makes_today():
    """`--check` regenerates and compares, rather than writing over the answer."""
    pytest.importorskip("lottie", reason="python-lottie is not installed in this environment")

    proc = subprocess.run(
        [sys.executable, "tools/make_figure.py", "--check"],
        cwd=APP, capture_output=True, text=True,
    )
    # Exit 3 is could-not-measure, which is what an unbuilt checkout gets: the figure is
    # generated rather than committed, so the first run has nothing to compare against.
    # `--check` used to report that as "changed" and exit 1, so a fresh clone failed here
    # and then passed on the second run, having written the figure while checking for it.
    if proc.returncode == 3:
        pytest.skip("no figure to compare against yet: " + proc.stdout.strip())

    assert proc.returncode == 0, (
        "running tools/make_figure.py twice does not give the same bytes, so the "
        "figure the page ships depends on when it was built:\n"
        f"{proc.stdout}{proc.stderr}"
    )


def test_the_figure_carries_no_text_of_its_own():
    """Words belong beside the drawing, not inside it.

    Text baked into an SVG has no @font-face, so it renders in whatever the reader's browser
    reaches for. It cannot be selected, cannot be found by a page search, and a translation
    tool cannot see it, which would be a poor joke on a page about families who do not read
    English. The labels are HTML for that reason, and this stops them drifting back in.
    """
    svg = FIGURES / "three-endings.svg"
    if not svg.exists():
        pytest.skip("the figure has not been built in this checkout yet")

    body = svg.read_text(encoding="utf-8")
    assert "<text" not in body and "<tspan" not in body, (
        "the figure has grown text elements. The three labels are HTML beside the SVG so "
        "they can be read, searched and translated; a word inside the drawing is none of "
        "those things."
    )
