"""One school morning, as an object you can turn.

Why this page exists, and why it is not on the first screen.

The entry that won micro1 put seventy-seven words on a homepage that never scrolled and
kept its WebGL on a second page, one click away, where the reader had already asked for
it. That is the shape copied here: the first screen is the two real calls and the sound of
them, and this is the room next door.

What it must not do is invent numbers. The tempting version of this board colours every
cell by an ending and projects an outcome split across a modelled morning. This project's
measured split is three resolved and four undetermined out of seven, from
`06-locale-matched-pairs`, and that run is a designed set of matched hard cases, not a
sample of anybody's Tuesday. Projected onto forty-one children it would claim twenty-three
of them unaccounted for, which is both false and, to a reader skimming, a product that
fails more often than it works.

So the board projects no split at all. Every absence is one tile and every tile is the
same, except one. The claim is the smallest one that is true and the only one worth
making: a morning is a lot of calls, they all look identical from the office, and exactly
one of them is a child nobody has actually accounted for. Finding which is the product.

The count is arithmetic over a cited rate, and the arithmetic is printed next to it.
"""

from __future__ import annotations

# England, Department for Education, "Pupil attendance in schools", full 2024/25 academic
# year: "the attendance rate across the 2024/25 academic year was 93.1%. The absence rate
# was, therefore, 6.9% across all schools". A six-hundred pupil secondary is the median
# sort of school this would be sold into. Both numbers are printed on the page beside the
# product of them, so a reader can do the multiplication and disagree with the premise
# rather than with the drawing.
PUPILS = 600
ABSENCE_RATE = 0.069
DFE_URL = ("https://explore-education-statistics.service.gov.uk/find-statistics/"
           "pupil-attendance-in-schools/2025-week-29")

COLS = 8


def absences() -> int:
    """How many children are absent on an average morning at that school."""
    return round(PUPILS * ABSENCE_RATE)


def grid() -> tuple[int, int]:
    """Columns and rows the tiles are laid out on."""
    n = absences()
    return COLS, -(-n // COLS)


def _static_svg(n: int, open_at: int) -> str:
    """The board as a flat isometric drawing, in the markup before any script runs.

    This is not a placeholder. It is what a reader gets with JavaScript off, with the CDN
    unreachable, with WebGL refused by the driver, and in print, and the gates check three
    of those four. The scene that replaces it says the same thing with a camera on it.
    """
    cols, rows = grid()
    w, h, gap = 34.0, 17.0, 3.0
    cells = []
    for i in range(n):
        c, r = i % cols, i // cols
        # Isometric projection: x runs down-right, y runs down-left.
        x = 300 + (c - r) * (w + gap) / 2
        y = 60 + (c + r) * (h + gap) / 2
        if i == open_at:
            # The one that never closed, drawn as a column standing out of the plane.
            cells.append(
                f'<g class=mrn-open>'
                f'<path d="M{x} {y - 54} l{w / 2} {h / 2} l0 54 l{-w / 2} {-h / 2} z"/>'
                f'<path d="M{x} {y - 54} l{-w / 2} {h / 2} l0 54 l{w / 2} {-h / 2} z"/>'
                f'<path class=mrn-cap d="M{x} {y - 54} l{w / 2} {h / 2} '
                f'l{-w / 2} {h / 2} l{-w / 2} {-h / 2} z"/>'
                f'</g>')
        else:
            cells.append(
                f'<path class=mrn-tile d="M{x} {y} l{w / 2} {h / 2} '
                f'l{-w / 2} {h / 2} l{-w / 2} {-h / 2} z"/>')
    height = 60 + (cols + rows) * (h + gap) / 2 + 40
    return (f'<svg class=mrn-flat viewBox="0 0 600 {height:.0f}" role=img '
            f'aria-label="{n} absences on one morning, drawn as {n} identical tiles, '
            'with one standing open as a column">'
            f'{"".join(cells)}</svg>')


def morning_markup() -> str:
    """The whole board: the drawing, the arithmetic under it, and the one claim."""
    n = absences()
    cols, rows = grid()
    # Deterministic, and interior on both axes, so the open column reads as one of the
    # crowd rather than as a label parked beside it. The first version of this was
    # `n // 2 + 3`, which on an eight-wide grid landed in the last column every time: the
    # arithmetic looked central and the picture had the whole argument standing on the
    # edge of the board. Pick the cell, not the index.
    open_at = (rows // 2) * cols + (cols // 2) - 1
    return (
        '<section class=morning '
        f'data-mrn-count="{n}" data-mrn-cols="{cols}" data-mrn-rows="{rows}" '
        f'data-mrn-open="{open_at}">'
        '<p class=eyebrow>One school morning, modelled</p>'
        f'<h1>{n} absences. One of them is not a child who stayed home.</h1>'
        '<p class=mrn-lede>Every tile is one family the office has to telephone before '
        'the register closes. From a desk they are identical, and they stay identical '
        'after the calls are made, because a call that reached somebody and learned '
        'nothing files itself next to the ones that worked. The column is the one this '
        'software refuses to lay flat.</p>'
        f'<div class=mrn-stage data-mrn-stage>{_static_svg(n, open_at)}</div>'
        '<p class=mrn-hint data-mrn-hint hidden>Drag to turn it.</p>'
        '<p class=mrn-note>'
        f'<b>Where {n} comes from.</b> {PUPILS} pupils at an absence rate of '
        f'{ABSENCE_RATE * 100:.1f} per cent is {PUPILS} &#215; {ABSENCE_RATE} = '
        f'{PUPILS * ABSENCE_RATE:.1f}, so {n}. The rate is the Department for '
        'Education&#8217;s measured figure for every school in England across the full '
        f'2024/25 academic year (<a href="{DFE_URL}">Pupil attendance in schools</a>). '
        'The school size is a premise, not a measurement, and it is printed here so it '
        'can be argued with.'
        '</p>'
        '<p class=mrn-note>'
        '<b>What this board does not claim.</b> It puts no outcome on any tile but one. '
        'This software has placed twelve real calls and the endings of those twelve are '
        'published with their receipts on the evidence page; a run built out of matched '
        'hard cases is not a sample of a real morning, and multiplying its proportions '
        'up to a school would state something nobody measured. The single open column is '
        'the shape of the problem, not a rate.'
        '</p>'
        '<p class=mrn-back><a href="index.html">Back to the two calls, and the '
        'recordings</a></p>'
        '</section>')


MORNING_CSS = """
.morning { max-width: 58rem; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.morning .eyebrow, .morning h1, .mrn-lede, .mrn-note, .mrn-hint,
.mrn-back { max-width: 62ch; }
.morning h1 { margin: var(--space-2) 0 var(--space-4); }
.mrn-lede { font-size: var(--size-4); line-height: 1.5; color: var(--ink-2);
  margin: 0 0 var(--space-5); }
.mrn-stage { position: relative; margin: 0 0 var(--space-3);
  min-height: 0; touch-action: pan-y; }
.mrn-stage canvas { display: block; width: 100%; height: auto; }
.mrn-flat { display: block; width: 100%; height: auto; overflow: visible; }
.mrn-tile { fill: var(--ink); opacity: 0.13; }
.mrn-open path { fill: var(--brand); }
.mrn-open .mrn-cap { fill: var(--brand); filter: brightness(1.12); }
.mrn-hint { font-family: var(--ui); font-size: var(--size-2); color: var(--ink-3);
  margin: 0 0 var(--space-5); }
.mrn-note { font-family: var(--ui); font-size: var(--size-2); line-height: 1.6;
  color: var(--ink-3); margin: 0 0 var(--space-3); }
.mrn-back { font-family: var(--ui); font-size: var(--size-2);
  margin: var(--space-5) 0 0; }
@media (prefers-reduced-motion: reduce) { .mrn-hint { display: none; } }
"""
