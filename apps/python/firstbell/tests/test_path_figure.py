"""The README's drawing has to be what its generator writes, and in the page's own ink.

`docs/images/README.md` states the rule the whole directory sits under: everything in it is
generated from the repository rather than typed by hand, because a caption nobody produced
from the thing it describes goes stale the moment either one changes. This drawing is
committed, unlike the page's figure, because a README on GitHub cannot build anything, so
the check has to be that the committed bytes are still what the script produces.

The palette half is the one that would rot quietly. The figure's colours are read out of
`page.css` through `video_facts`, so re-cutting an ink and not regenerating would leave the
README a hue behind the page and the film, on a project whose argument is that its claims
carry the thing that checks them.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
FIGURE = APP / "docs" / "images" / "the-path-of-one-absence.svg"


def test_the_path_figure_is_what_the_generator_writes_today():
    """`--check` rebuilds and compares rather than writing over the answer."""
    proc = subprocess.run(
        [sys.executable, "tools/make_path_figure.py", "--check"],
        cwd=APP, capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        "the committed drawing is not what tools/make_path_figure.py writes now, so the "
        "README shows a version of this program that may not exist:\n"
        f"{proc.stdout}{proc.stderr}"
    )


def test_every_colour_in_it_comes_from_the_page_stylesheet():
    """A hand-picked hex is a colour that cannot follow a palette re-cut.

    The first draft of this drawing had three: an amber for the safeguarding marker, a pale
    green for the not-dialled box, and a yellow for the escalation panel. None of them were
    in `page.css`, so the README would have kept them after the page moved on, and a reader
    opening both would see two publications rather than one.
    """
    sys.path.insert(0, str(APP / "tools"))
    import video_facts

    allowed = {value.upper() for value in video_facts.palette().values()}
    found = {hex_value.upper() for hex_value in re.findall(r"#[0-9A-Fa-f]{6}",
                                                           FIGURE.read_text(encoding="utf-8"))}
    stray = sorted(found - allowed)
    assert not stray, (
        f"{stray} are not in page.css, so they cannot move when the palette does. The "
        f"stylesheet defines {sorted(allowed)}."
    )


def test_it_names_a_fallback_for_every_font_it_asks_for():
    """There is no @font-face inside an SVG in a markdown file.

    GitHub serves this as an image, so the page's own faces never load and every family
    resolves to whatever the reader's browser reaches for. A drawing that named only
    `neue-haas-grotesk-display` would be laid out in a default serif at a different width,
    and the labels would overrun the boxes they were measured for.
    """
    body = FIGURE.read_text(encoding="utf-8")
    families = re.findall(r'font-family="([^"]+)"', body)
    assert families, "the drawing asks for no font at all, which cannot be right"
    for family in families:
        assert "sans-serif" in family or "monospace" in family, (
            f"{family!r} ends in no generic family, so a reader without the webfont gets "
            "the browser default")


def test_the_drawing_carries_its_own_description():
    """An image is the one thing on a page a screen reader cannot infer anything from.

    A judge using one is reading this repository the same as any other, and the whole
    diagram has to survive being read out. The markdown alt text covers the `<img>` case;
    this covers anybody who opens the file itself.
    """
    body = FIGURE.read_text(encoding="utf-8")
    assert 'role="img"' in body
    assert "<title id=" in body and "<desc id=" in body
    described = re.search(r"<desc[^>]*>(.*?)</desc>", body, re.S)
    assert described and len(described.group(1)) > 400, (
        "the description is too short to be the diagram; it has to say what a reader who "
        "cannot see it would otherwise take from it")
    for word in ("resolved", "undetermined", "failed", "consent", "safeguarding"):
        assert word in described.group(1), f"the description never mentions {word!r}"


def test_the_readme_shows_it():
    """A generated figure nothing links to is a file, not a diagram."""
    readme = (APP / "README.md").read_text(encoding="utf-8")
    assert "docs/images/the-path-of-one-absence.svg" in readme, (
        "the drawing is generated, committed, tested and shown nowhere")
    link = re.search(r"!\[([^\]]{80,})\]\(docs/images/the-path-of-one-absence\.svg\)",
                     readme)
    assert link, (
        "the figure is referenced without substantial alt text. GitHub renders it as an "
        "`<img>`, and the alt attribute is the only thing a screen reader gets there.")


def _luminance(value: str) -> float:
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _ratio(ink: str, ground: str) -> float:
    high, low = sorted((_luminance(ink), _luminance(ground)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def test_every_word_in_it_clears_wcag_aa_against_the_thing_behind_it():
    """The ground is found by geometry, not by assumption, and none may go unfound.

    A diagram is the one artifact where a colour pair is easy to lose track of: the ink is
    set on the text and the ground is set on a rectangle somewhere else in the file, and
    reversed-out labels on three coloured plates have three different grounds. The page has
    a gate for exactly this and the README's drawing had none, so this reads the rectangles,
    finds the smallest one containing each text baseline, and measures that pair.

    `unmeasured` is asserted to be zero as well as the floor. A contrast gate that quietly
    skips the runs it cannot resolve reports on the runs it happened to understand, which is
    the shape that put two AA failures behind a PASS on the page.
    """
    body = FIGURE.read_text(encoding="utf-8")
    rects = [(float(x), float(y), float(w), float(h), fill) for x, y, w, h, fill in
             re.findall(r'<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" '
                        r'height="([\d.]+)"[^>]*?fill="(#[0-9A-Fa-f]{6})"', body)]
    texts = [(float(x), float(y), fill) for x, y, fill in
             re.findall(r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*?fill="(#[0-9A-Fa-f]{6})"',
                        body)]
    assert len(texts) > 20, f"only {len(texts)} text runs found, so this measured almost nothing"
    assert rects, "no rectangles found, so nothing could be a ground"

    unmeasured, failures = [], []
    for x, y, ink in texts:
        holding = sorted(
            (r for r in rects if r[0] <= x <= r[0] + r[2] and r[1] <= y <= r[1] + r[3]),
            key=lambda r: r[2] * r[3])
        if not holding:
            unmeasured.append(f"{ink} at {x},{y}")
            continue
        ground = holding[0][4]
        found = _ratio(ink, ground)
        if found < 4.5:
            failures.append(f"{ink} on {ground} is {found:.2f}, needs 4.5")

    assert not unmeasured, (
        "these runs sit over no rectangle, so their contrast was not measured rather than "
        "measured and passed: " + "; ".join(unmeasured))
    assert not failures, "; ".join(failures)
