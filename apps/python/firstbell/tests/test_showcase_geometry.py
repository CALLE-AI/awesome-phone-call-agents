"""The showcase figure's route is one set of numbers, held in two files.

`tools/site/showcase.py` lays the figure out and derives, in `ROUTE`, exactly how far a
mark has to travel to get from the register to its ending. `tools/site/showcase.css`
declares those same distances as custom properties, because the keyframes that move the
marks live there and a keyframe cannot read Python.

That is a split nobody can hold in their head, and the figure has already been bitten by
it twice. The offsets were previously written out by hand in both files under a comment
asking the next person to keep them in step. A comment is not a mechanism: when the
figure was rebuilt on a new grid, the stylesheet's numbers still parsed, still animated
and still produced motion, so nothing failed. The marks simply travelled to the wrong
places. Separately, `page.css` held two of the same offsets for the pause control, and
they went stale the same silent way.

So this file is the mechanism. It reads both files and asserts that every route value the
layout derives is the value the stylesheet declares, and that neither file has grown one
the other does not know about. It cannot check that the numbers are *right*, which is
what eyes and the browser gates are for. It can check that there is only one answer.
"""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
SITE = APP / "tools" / "site"
SHOWCASE_CSS = SITE / "showcase.css"
PAGE_CSS = SITE / "page.css"


def _showcase():
    """Load the figure module by path, the way `judge_page.py` loads it."""
    spec = importlib.util.spec_from_file_location("showcase", SITE / "showcase.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _declared() -> dict[str, int]:
    """Every `--cs-<name>: <n>px` the figure's stylesheet declares, as plain ints.

    Only literal pixel values are collected. A property whose value is a `var()` or a
    `calc()` is derived from one of these rather than being a route number itself, and
    including it would mean asserting against an expression instead of a distance.
    """
    text = SHOWCASE_CSS.read_text(encoding="utf-8")

    # Only the root block. The nine per-call rules further down set --cs-slot-y and
    # --cs-lane-y to a direction each, and three of the nine pick 0px, which is a
    # position and not a route constant. Reading the whole file counts those as
    # offsets showcase.py forgot to derive, which is the wrong complaint.
    start = text.index(".calle-showcase {")
    root = text[start:text.index("\n}", start)]

    return {
        name: int(value)
        for name, value in re.findall(r"(--cs-[a-z0-9-]+):\s*(-?\d+)px;", root)
    }


def test_every_route_offset_matches_the_layout_that_derives_it():
    route = _showcase().ROUTE
    declared = _declared()

    missing = sorted(set(route) - set(declared))
    assert not missing, (
        "showcase.py derives route offsets the stylesheet never declares, so the "
        f"keyframes cannot use them: {missing}"
    )

    wrong = {
        name: (want, declared[name])
        for name, want in sorted(route.items())
        if declared[name] != want
    }
    assert not wrong, (
        "the stylesheet is animating to distances the layout does not agree with. "
        "Each entry below is name: (showcase.py, showcase.css). Fix the stylesheet, "
        f"because showcase.py derives its values from the grid: {wrong}"
    )


def test_the_stylesheet_declares_no_route_offset_the_layout_does_not_know_about():
    """A leftover from an older grid parses, animates, and moves a mark nowhere useful.

    This is the direction the drift actually ran last time. Deleting a stop from the
    route and leaving its declaration behind costs nothing at build time and produces a
    figure whose marks end up in the wrong place, so the orphan is worth failing on.
    """
    route = _showcase().ROUTE
    orphans = sorted(set(_declared()) - set(route))
    assert not orphans, (
        "showcase.css declares route offsets showcase.py no longer derives. Either the "
        f"layout dropped them or the stylesheet was never cleaned up: {orphans}"
    )


def test_the_pause_control_reads_the_figures_own_offsets():
    """`page.css` may name these properties. It may not hold a copy of their values.

    The pause checkbox sits in `page.css` because the control is the page's, not the
    figure's, and its `:checked` rules rest the same marks the reduced-motion block
    rests. They used to do it with two literal offsets copied out of the figure. That
    copy is the exact failure this file exists to prevent, so it is asserted against
    here rather than only being fixed.
    """
    rules = [
        line for line in PAGE_CSS.read_text(encoding="utf-8").splitlines()
        if ".calle-showcase .cs-esc__" in line or ".calle-showcase .cs-run__" in line
    ]
    assert rules, "the pause control's rules for the figure have gone missing"

    literals = [line.strip() for line in rules
                if re.search(r"translate[XY]\(\s*-?\d+px", line)]
    assert not literals, (
        "page.css holds a literal geometry offset for the figure. Name the custom "
        f"property showcase.css declares instead: {literals}"
    )
