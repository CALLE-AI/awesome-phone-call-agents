"""The committed figure has to be the figure the generator produces.

A drawing checked into a repository is a file somebody exported once. This one is generated,
so the check is whether running the generator again would change it. If it would, the page is
shipping a picture that no longer matches the code or the palette that made it, which is the
same class of defect as a typed number sitting beside a counted one.

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
    """`--check` regenerates and reports drift rather than writing over it."""
    pytest.importorskip("lottie", reason="python-lottie is not installed in this environment")

    proc = subprocess.run(
        [sys.executable, "tools/make_figure.py", "--check"],
        cwd=APP, capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        "the committed figure is not what tools/make_figure.py produces now:\n"
        f"{proc.stdout}{proc.stderr}\n"
        "Run `python tools/make_figure.py` and commit the result."
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
        pytest.skip("the figure has not been generated in this checkout")

    body = svg.read_text(encoding="utf-8")
    assert "<text" not in body and "<tspan" not in body, (
        "the figure has grown text elements. The three labels are HTML beside the SVG so "
        "they can be read, searched and translated; a word inside the drawing is none of "
        "those things."
    )
