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

# The calling window, and the only premise on this board that is not measured or derived
# from something measured. An English secondary takes the register at first bell and closes
# it mid-morning; the office works the absence list in between. The two numbers are printed
# under the drawing, and every time a tile reports when it is hovered is read off them, so
# a reader who disagrees with the window can see exactly which times move.
#
# They are stated as a premise rather than dressed up as a measurement because the board
# already refuses to project an outcome split it did not measure, and a fabricated clock
# would be the same mistake wearing a smaller hat.
WINDOW_START = "08:30"
WINDOW_MINUTES = 50


def window_end() -> str:
    """The far end of the calling window, so the note and the tiles cannot disagree."""
    h, m = (int(p) for p in WINDOW_START.split(":"))
    total = h * 60 + m + WINDOW_MINUTES
    return f"{total // 60:02d}:{total % 60:02d}"


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


def morning_markup(placed: str, compact: bool = False) -> str:
    """The whole board: the drawing, the arithmetic under it, and the one claim.

    `compact` returns the same board with none of the writing around it, for the first
    screen of the evidence page. A judge who never scrolls has to be able to turn it, and
    a text link to another page is a link most of them will not follow. The arithmetic,
    the source and the two paragraphs of what this does not claim stay on the full board,
    one click away, because they are what somebody checking it needs and not what
    somebody deciding in thirty seconds needs.

    It carries no `<h1>`. Act 00 already has one and a second would give the page two
    document titles.
    """
    n = absences()
    cols, rows = grid()
    # Deterministic, and interior on both axes, so the open column reads as one of the
    # crowd rather than as a label parked beside it. The first version of this was
    # `n // 2 + 3`, which on an eight-wide grid landed in the last column every time: the
    # arithmetic looked central and the picture had the whole argument standing on the
    # edge of the board. Pick the cell, not the index.
    open_at = (rows // 2) * cols + (cols // 2) - 1
    shell = (
        f'data-mrn-count="{n}" data-mrn-cols="{cols}" data-mrn-rows="{rows}" '
        f'data-mrn-open="{open_at}" '
        # Two numbers rather than forty-one timestamps. The scene spaces the calls across
        # the window itself, so the times cannot drift from the premise that produced them
        # and the markup does not carry a list a reader would have to check line by line.
        f'data-mrn-start="{WINDOW_START}" data-mrn-span="{WINDOW_MINUTES}">'
    )
    if compact:
        return (
            '<section class="morning morning-compact" ' + shell
            + '<p class=eyebrow>One school morning, modelled</p>'
            + f'<div class=mrn-stage data-mrn-stage>{_static_svg(n, open_at)}</div>'
            + '<p class=mrn-hint data-mrn-hint hidden>Drag to turn it. Point at '
              'a tile for its slot in the morning.</p>'
            + f'<p class=mrn-say>{n} absences in one morning at a school of {PUPILS}, at '
              'the national rate. Every tile is a family somebody has to telephone before '
              'the register closes, and from the desk they are identical. One of them is '
              'not a child who stayed home. '
              '<a href="the-morning.html">Where the number comes from, and what happens '
              'when the morning is longer than the cut-off &#8594;</a></p>'
            + '</section>')
    return (
        '<section class=morning ' + shell
        + '<p class=eyebrow>One school morning, modelled</p>'
        + f'<h1>{n} absences. One of them is not a child who stayed home.</h1>'
        + '<p class=mrn-lede>Every tile is one family the office has to telephone before '
        'the register closes. From a desk they are identical, and they stay identical '
        'after the calls are made, because a call that reached somebody and learned '
        'nothing files itself next to the ones that worked. The column is the one this '
        'software refuses to lay flat.</p>'
        f'<div class=mrn-stage data-mrn-stage>{_static_svg(n, open_at)}</div>'
        '<p class=mrn-hint data-mrn-hint hidden>Drag to turn it. Point at a tile '
        'for its slot in the morning.</p>'
        '<p class=mrn-note>'
        f'<b>Where {n} comes from.</b> {PUPILS} pupils at an absence rate of '
        f'{ABSENCE_RATE * 100:.1f} per cent is {PUPILS} &#215; {ABSENCE_RATE} = '
        f'{PUPILS * ABSENCE_RATE:.1f}, so {n}. The rate is the Department for '
        'Education&#8217;s measured figure for every school in England across the full '
        f'2024/25 academic year (<a href="{DFE_URL}">Pupil attendance in schools</a>). '
        'The school size is a premise, not a measurement, and it is printed here so it '
        'can be argued with. So is the window: the board lays the '
        f'{n} calls evenly across an office morning from {WINDOW_START} to '
        f'{window_end()}, which is where the time on each tile comes from when you '
        'point at it.'
        '</p>'
        '<p class=mrn-note>'
        '<b>What this board does not claim.</b> It puts no measured outcome on any tile. '
        'The only thing it says about a call is the split it draws, forty that close and '
        'one that does not, and the clock face a tile reports is its slot in the window '
        'above and not a time anybody dialled. '
        # Was "and the transcript of every one of them is on the evidence page", which
        # was not true: the evidence page draws two of them and holds the rest in a
        # data island no reader opens. The count is the claim worth making here.
        'This software has placed ' + placed + ' real calls through CALL-E. A run '
        'built out of '
        'matched hard cases is not a sample of a real morning, and multiplying its '
        'proportions up to a school would state something nobody measured. The single '
        'open column is the shape of the problem, not a rate.'
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
/* --live-mark, not --brand. This page defines no property called --brand; the only brand
 * name in page.css is --brand-field. An undefined custom property does not fall back, it
 * makes the declaration invalid at computed-value time, and `fill` then inherits -- so
 * `fill: var(--brand)` painted the one gold object on this board pure black, on a board
 * whose other forty tiles are #201e1a at 0.13. Measured with JavaScript off on
 * 2026-09-10: rgb(0, 0, 0) for both the shaft and the cap. It looked deliberate and it
 * was a name that does not exist.
 *
 * --live-mark is the right name by page.css's own rule: it is the saturated grade of the
 * yellow and it "only ever appears on a call object". A call nobody closed is a call
 * object. It measures 3.41 against the paper, which clears the 3:1 a graphic needs. */
.mrn-open path { fill: var(--live-mark); }
.mrn-open .mrn-cap { fill: var(--live-mark); filter: brightness(1.16); }
.mrn-hint { font-family: var(--ui); font-size: var(--size-2); color: var(--ink-3);
  margin: 0 0 var(--space-5); }

/* ---- the same board, on the first screen ----------------------------------------------
 * No page of its own, no width of its own, and no title: it sits in act 00's reading
 * column directly under the two calls, so a judge meets both sensory objects before they
 * meet a paragraph. Hear the calls, turn the morning.
 *
 * The height is capped here rather than in the script. `mount` sizes the canvas from the
 * stage's own width and would give a 753px column a 391px board, which on a 900px screen
 * pushes the thing under it off the fold. 300px keeps the board, its hint and the line
 * under it inside one screen with the audio instrument above them. */
.morning-compact { max-width: none; margin: 0; padding: 0; }
/* 300px, not 232. The board is framed so that no rotation the drag allows takes it out
 * of the canvas, and the pose that costs the most is a quarter turn: the long axis of an
 * eight-by-six grid lies up the short side of the frame and needs a third more height than
 * width. In a 16:9 box that headroom has to come out of the board, which is why it filled
 * 40% of its frame at rest and read as shrunken. A squarer box pays for the headroom in
 * page height instead, and the board comes back up. The height is the lever, not the
 * camera. */
.morning-compact .mrn-stage { margin-bottom: var(--space-1); height: 300px; }
.morning-compact .mrn-stage canvas,
.morning-compact .mrn-flat { height: 100%; width: 100%; object-fit: contain; }
.morning-compact .eyebrow { margin-bottom: var(--space-2); }
.morning-compact .mrn-hint { margin-bottom: var(--space-2); }
.mrn-say { font-family: var(--ui); font-size: var(--size-2); line-height: 1.6;
  color: var(--ink-3); max-width: 62ch; margin: 0 0 var(--space-4); }
.mrn-say a { color: var(--ink-2); }
.mrn-note { font-family: var(--ui); font-size: var(--size-2); line-height: 1.6;
  color: var(--ink-3); margin: 0 0 var(--space-3); }
.mrn-back { font-family: var(--ui); font-size: var(--size-2);
  margin: var(--space-5) 0 0; }
/* ---- the hover read-out ----------------------------------------------------------------
 * A plain block, absolutely positioned against .mrn-stage, which is the only positioned
 * ancestor it has. Not a popover, not a portal, and not appended to the body: a tooltip
 * parented anywhere above the stage is a new element in the document's flow at the exact
 * moment the reader is looking somewhere else.
 *
 * The width rule is the load-bearing one. `max-width: calc(100% - 16px)` with a nowrap
 * line and a clipped overflow means the box can never be wider than the stage minus its
 * own inset, whatever text is put in it, so the clamp the script applies to `left` always
 * has somewhere legal to land. At 390px the stage is 342px wide and an unclamped box of
 * this text would reach past the right edge of the document, which widens the document,
 * which is a horizontal scrollbar on every page the board appears on. The overflow gate
 * checks six widths across ten pages and this is the element most able to fail it.
 *
 * --paper on --ink is 13.64, so it clears AA by a wide margin if it is ever measured with
 * a reader on it. The script does not create the element until the first hover, so a gate
 * that never points at the board never sees it at all. */
.mrn-tip { position: absolute; left: 0; top: 0; display: none; z-index: 2;
  pointer-events: none; box-sizing: border-box; max-width: calc(100% - 16px);
  padding: 5px 9px; border-radius: 3px;
  background: var(--ink); color: var(--paper);
  font-family: var(--ui); font-size: var(--size-1); line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 6px 16px rgb(0 0 0 / 20%); }
.mrn-tip[data-open] { display: block; }
.mrn-tip b { font-family: var(--mono); font-weight: 500; }
.mrn-tip i { font-style: normal; opacity: 0.7; padding-left: 6px; }
.mrn-tip[data-flag] i { color: var(--brand-field); opacity: 1; }

@media (prefers-reduced-motion: reduce) { .mrn-hint { display: none; } }
"""
