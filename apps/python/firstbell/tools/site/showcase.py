"""The showcase figure: one picture of the system doing its job.

It returns a self-contained block of HTML. Nothing here imports from the app, reads a
fixture or touches a network. The caller drops the string into the page and inlines
`showcase.css` beside it.

Why it is built this way. The page is served once with every script stripped, and it has
to stay legible under that. So the figure carries no script, and its structure, its
labels and its route are drawn statically. Only ten small marks move, and they move on
`transform` and `opacity`, which is the pair that costs no layout and no reflow. Freeze
them and the diagram is complete: the queue, three occupied lines, one mark resting at
each of the three endings, and the escalation flag part way along its rail.

The argument, in four stages.

    1. Unexplained absences   a register of children nobody has accounted for
    2. Calls placed           a wave of calls held at three lines at once
    3. Three endings          reason given, connected with nothing learned, no answer
    4. Worked worst first     the queue a person actually opens

Stage three is the whole point. A pipeline with two buckets has to file "the call
connected and we learned nothing" somewhere, and it files it with the successes. That is
how a dashboard reports full coverage for a child nobody heard about. The middle lane
carries the yellow because it is the lane that gets lost.

Riding above all four, on its own rail, is the safeguarding axis. It is drawn crossing
the outcome lanes because it is orthogonal to them: a case can be escalated whatever its
ending, and escalation takes it to the head of the queue rather than to a fourth bucket.

Geometry lives in this file as plain numbers in the 1200 by 580 user-unit grid. Colour,
motion and type live in `showcase.css`. The two are kept apart so a colour change never
moves a shape and a shape change never touches a token.
"""

from __future__ import annotations

# The grid. Every number below is a user unit inside viewBox "0 0 1200 580".
VIEW_W = 1200
VIEW_H = 580

# Column left edges, and the rule that sits under each stage caption.
COL_A = 40    # the register
COL_B = 322   # the calls
COL_C = 596   # the endings
COL_D = 920   # the worklist
COL_A_END = 196
COL_B_END = 510
COL_C_END = 902
COL_D_END = 1176

CAPTION_1 = 48    # first caption line, baseline
CAPTION_2 = 78    # second caption line, baseline
CAPTION_RULE = 94

MID = 372         # the centre line: register centre, queue, middle slot, middle lane

# Stage one. Twenty-one tiles, three across and seven down, centred on MID.
TILE_W = 44
TILE_H = 16
TILE_COLS = (40, 96, 152)
TILE_ROWS = (280, 308, 336, 364, 392, 420, 448)

# Stage two. Three call slots and the bracket that caps them.
SLOT_X = 336
SLOT_W = 174
SLOT_H = 40
SLOT_YS = (300, MID, 444)   # centres

# Stage three. Three lanes, each ending in its own glyph.
LANE_RESOLVED = 268
LANE_UNDETERMINED = MID
LANE_NO_ANSWER = 476
LANE_LABEL_LIFT = 22        # a label sits this far above its lane
GLYPH_X = 858
GLYPH_R = 15

# Stage four. The worklist panel and its rows.
PANEL = (920, 220, 256, 326)          # x, y, width, height
ROW_X = 936
ROW_W = 224
ROW_H = 60
ROW_YS = (240, 314, 388, 462)
ROW_TEXT_X = 980

# The safeguarding axis.
RAIL_Y = 164
RISER_X = 760
DROP_X = 1050

# Where a travelling mark starts, and how far along its route each keyframe stop is.
# These offsets are repeated in showcase.css and the two have to agree.
RUN_START_X = 216


def _tiles() -> str:
    """The register: one tile per unexplained absence."""
    out = []
    for y in TILE_ROWS:
        for x in TILE_COLS:
            out.append(
                f'<rect class="cs-tile" x="{x}" y="{y}" '
                f'width="{TILE_W}" height="{TILE_H}" rx="3"/>'
            )
    return "".join(out)


def _slots() -> str:
    """Three lines. A mark crossing one of these rects is a call in progress."""
    out = []
    for cy in SLOT_YS:
        out.append(
            f'<rect class="cs-slot" x="{SLOT_X}" y="{cy - SLOT_H // 2}" '
            f'width="{SLOT_W}" height="{SLOT_H}" rx="6"/>'
        )
    return "".join(out)


def _caption(x: int, end: int, first: str, second: str) -> str:
    return (
        f'<text class="cs-caption" x="{x}" y="{CAPTION_1}">'
        f'<tspan x="{x}">{first}</tspan>'
        f'<tspan x="{x}" y="{CAPTION_2}">{second}</tspan></text>'
        f'<line class="cs-rule" x1="{x}" y1="{CAPTION_RULE}" '
        f'x2="{end}" y2="{CAPTION_RULE}"/>'
    )


def _runner(n: int) -> str:
    """One call, on its way through.

    The outer group is placed by attribute and never moves. The two inner groups carry
    the animation: one translates along the route, the other steps down or up into a
    line and then into a lane. Both read their offsets from custom properties, which
    `.cs-run--1` through `.cs-run--9` in showcase.css set. That is where the line and
    lane each call takes is written down; there is a single pair of keyframes for all
    nine, and changing an assignment means changing one rule in the stylesheet.
    """
    return (
        f'<g class="cs-run cs-run--{n}" '
        f'transform="translate({RUN_START_X} {MID})">'
        '<g class="cs-run__x"><g class="cs-run__y">'
        '<circle class="cs-run__mark" r="8"/>'
        "</g></g></g>"
    )


def _rows() -> str:
    """The worklist, worst at the top.

    Each row repeats the glyph of the ending that put it there, so the queue and the
    lanes are readable as one picture rather than two.
    """
    rows = (
        ("safeguarding", "Safeguarding"),
        ("no-answer", "Third no answer"),
        ("no-answer", "No answer"),
        ("undetermined", "Nothing learned"),
    )
    out = []
    for (kind, label), y in zip(rows, ROW_YS):
        cy = y + ROW_H // 2
        out.append(
            f'<rect class="cs-row cs-row--{kind}" x="{ROW_X}" y="{y}" '
            f'width="{ROW_W}" height="{ROW_H}" rx="5"/>'
            + _glyph(kind, 958, cy, 10)
            + f'<text class="cs-row-label" x="{ROW_TEXT_X}" y="{cy + 7}">{label}</text>'
        )
    return "".join(out)


def _glyph(kind: str, cx: int, cy: int, r: int) -> str:
    """The three endings, and the flag, as shapes rather than as colours.

    Full, half, empty. The distinction survives greyscale, every kind of colour
    blindness and a forced-colours theme, because it is carried by the fill state and
    not by the hue. Colour is the second reading, never the only one.
    """
    if kind == "resolved":
        return f'<circle class="cs-glyph cs-glyph--resolved" cx="{cx}" cy="{cy}" r="{r}"/>'
    if kind == "undetermined":
        return (
            '<g class="cs-glyph cs-glyph--undetermined" '
            f'transform="translate({cx} {cy})">'
            f'<path class="cs-glyph__half" d="M 0 -{r} A {r} {r} 0 0 0 0 {r} Z"/>'
            f'<circle class="cs-glyph__ring" r="{r}"/></g>'
        )
    if kind == "no-answer":
        return (
            '<circle class="cs-glyph cs-glyph--no-answer" '
            f'cx="{cx}" cy="{cy}" r="{r}"/>'
        )
    # safeguarding
    return (
        f'<g class="cs-glyph cs-glyph--safeguarding" transform="translate({cx} {cy})">'
        f'<rect x="-{r}" y="-{r}" width="{2 * r}" height="{2 * r}" rx="3" '
        'transform="rotate(45)"/></g>'
    )


def _lane(y: int, kind: str, label: str, closed: bool) -> str:
    """One ending: a line, a label, the glyph that names it, and where it goes next.

    The resolved lane stops. The other two carry an arrow into the worklist, which is
    the routing argument stated without a sentence: connected and unexplained is not
    the same as closed.
    """
    line_end = GLYPH_X - GLYPH_R
    tail = ""
    if not closed:
        tail = (
            f'<line class="cs-lane" x1="{GLYPH_X + GLYPH_R}" y1="{y}" '
            f'x2="890" y2="{y}"/>'
            f'<path class="cs-arrow" d="M 890 {y - 7} L 906 {y} L 890 {y + 7} Z"/>'
        )
    return (
        f'<line class="cs-lane" x1="{COL_C}" y1="{y}" x2="{line_end}" y2="{y}"/>'
        + tail
        + _glyph(kind, GLYPH_X, y, GLYPH_R)
        + f'<text class="cs-lane-label" x="{COL_C}" y="{y - LANE_LABEL_LIFT}">'
        f"{label}</text>"
    )


DESCRIPTION = (
    "A four-stage diagram of one morning's absence follow-up. "
    "Stage one, a register of unexplained absences. "
    "Stage two, calls placed in a wave and held at three lines at once, so a queue "
    "of waiting calls backs up behind the three that are in progress. "
    "Stage three, three endings rather than two: a reason given, which closes; a call "
    "that connected and learned nothing, which does not close; and no answer. "
    "The middle ending is highlighted because a system with only two buckets files it "
    "with the successes and reports full coverage for a child nobody heard about. "
    "Stage four, a worklist ordered worst first, holding every case that did not close. "
    "Running above all four stages on its own rail is the safeguarding axis. It crosses "
    "the three endings rather than sitting among them, because a case can be escalated "
    "whatever its ending, and escalation sends it to the head of the worklist."
)


def showcase_markup() -> str:
    """Return the figure as one self-contained block of HTML.

    Every style it needs is in `showcase.css`, scoped under `.calle-showcase`. There is
    no script, no external reference and no identifier that a caller has to supply.
    """
    captions = (
        _caption(COL_A, COL_A_END, "Unexplained", "absences")
        + _caption(COL_B, COL_B_END, "Calls placed,", "three at a time")
        + _caption(COL_C, COL_C_END, "Three endings,", "not two")
        + _caption(COL_D, COL_D_END, "Worked", "worst first")
    )

    # Nine calls. Each takes the next line in turn, so line one holds calls one, four
    # and seven; line two holds two, five and eight; line three the rest. A call holds
    # its line for a third of the loop and the calls are spaced a ninth apart, which is
    # what keeps exactly three of them in the slots at any moment. The cap is not drawn
    # on top of the animation, it is the animation.
    runners = "".join(_runner(n) for n in range(1, 10))

    px, py, pw, ph = PANEL

    return (
        # Focusable and named, because under 34rem this box scrolls sideways rather than
        # shrinking the figure to the point where a label paints at seven pixels. A region
        # a pointer can pan and a keyboard cannot is a region half the readers cannot use,
        # and one with no name is one a screen reader announces as nothing.
        '<figure class="calle-showcase" tabindex="0" role="group" '
        'aria-label="How one morning’s absence follow-up runs, in four stages. '
        'Scrolls sideways on a narrow screen; the caption underneath says the same in '
        'words.">'
        f'<svg class="calle-showcase__svg" viewBox="0 0 {VIEW_W} {VIEW_H}" '
        f'width="{VIEW_W}" height="{VIEW_H}" role="img" '
        'aria-labelledby="calle-showcase-title" '
        'aria-describedby="calle-showcase-desc" focusable="false">'
        '<title id="calle-showcase-title">'
        "How one morning of unexplained absences is worked, from the register to the "
        "queue a person opens</title>"
        f'<desc id="calle-showcase-desc">{DESCRIPTION}</desc>'

        # The safeguarding axis is drawn first so the flow crosses in front of it.
        f'<path class="cs-axis" d="M {COL_A} {RAIL_Y} L {DROP_X} {RAIL_Y}"/>'
        f'<path class="cs-axis" d="M {RISER_X} {LANE_NO_ANSWER} L {RISER_X} {RAIL_Y}"/>'
        '<path class="cs-axis cs-axis--live" '
        f'd="M {DROP_X} {RAIL_Y} L {DROP_X} 232"/>'
        f'<path class="cs-arrow" d="M {DROP_X - 8} 232 L {DROP_X} 244 '
        f'L {DROP_X + 8} 232 Z"/>'
        f'<text class="cs-axis-label" x="{COL_A}" y="146">'
        "Safeguarding, at any point</text>"

        + captions

        # Stage one.
        + _tiles()
        + f'<text class="cs-note" x="{COL_A}" y="502">the register</text>'

        # Stage two.
        + f'<path class="cs-cap" d="M 334 268 L {COL_B} 268 L {COL_B} 476 L 334 476"/>'
        + _slots()
        + f'<text class="cs-note" x="{RUN_START_X}" y="502">waiting</text>'

        # Stage three. The band goes down before the lanes so the lanes sit on it.
        + '<rect class="cs-band" x="584" y="330" width="328" height="84" rx="8"/>'
        + _lane(LANE_RESOLVED, "resolved", "Reason given", closed=True)
        + f'<text class="cs-lane-label cs-end" x="{COL_C_END}" y="246">Closed</text>'
        + _lane(LANE_UNDETERMINED, "undetermined",
                "Connected, nothing learned", closed=False)
        + _lane(LANE_NO_ANSWER, "no-answer", "No answer", closed=False)

        # Stage four.
        + f'<rect class="cs-panel" x="{px}" y="{py}" width="{pw}" height="{ph}" rx="8"/>'
        + _rows()

        # The marks. Nine calls, and the one case that is escalated.
        + runners
        + f'<g class="cs-esc" transform="translate({RISER_X} {LANE_NO_ANSWER})">'
        '<g class="cs-esc__x"><g class="cs-esc__y">'
        '<rect class="cs-esc__mark" x="-9" y="-9" width="18" height="18" rx="3" '
        'transform="rotate(45)"/></g></g></g>'

        "</svg>"
        '<figcaption class="calle-showcase__caption">'
        "Unexplained absences, calls held at three lines at once, three endings rather "
        "than two, and the queue that is left. Safeguarding runs across all four."
        "</figcaption>"
        "</figure>"
    )
