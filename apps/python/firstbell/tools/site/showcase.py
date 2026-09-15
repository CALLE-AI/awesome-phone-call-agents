"""The showcase figure: one picture of the system doing its job.

It returns a self-contained block of HTML. Nothing here imports from the app, reads a
fixture or touches a network. The caller drops the string into the page and inlines
`showcase.css` beside it.

Why it is built this way. The page is served once with every script stripped, and it has
to stay legible under that. So the figure carries no script, and its structure, its
labels and its route are drawn statically. Only ten small marks move, and they move on
`transform` and `opacity`, which is the pair that costs no layout and no reflow. Freeze
them and the diagram is complete: three calls waiting, three occupied lines, one mark
resting at each of the three endings, and the escalation part way along its rail.

The argument, in four stages.

    01  The register        children nobody has accounted for
    02  Calls placed        a wave of calls held at three lines at once
    03  Three endings       a reason given, nothing learned, no answer
    04  Worst first         the queue a person actually opens

Stage three is the whole point. A pipeline with two buckets has to file "the call
connected and we learned nothing" somewhere, and it files it with the successes. That is
how a dashboard reports full coverage for a child nobody heard about. That one row
carries the figure's only tint, because it is the row that gets lost.

Riding above all four, on its own rail, is the safeguarding axis. It is drawn above the
stages rather than among them because it is orthogonal to them: a case can be escalated
whatever its ending, and escalation takes it to the head of the queue rather than to a
fourth bucket. Dashed stubs drop from the rail onto the first three cards, which is the
"at any point" said in ink rather than in words, and the one solid segment is the route
a case is actually taking.

How it is drawn, and the four rules that hold it together.

    Cards, not shapes.   Each stage is a card: a fill, a hairline, a four-unit stripe
                         down the left edge, a header of eyebrow over title over
                         sublabel, and a status tag riding the header rule. Under each
                         one is a plate carrying its own silhouette, offset along a
                         single oblique, so a card stands off the ground by a stated
                         distance rather than floating over a blur. Depth is geometry
                         here and there is still no shadow in the file. The four widths
                         differ, because four equal boxes is the layout a template picks
                         and it flattens the fact that stage three carries most of the
                         argument.
    Orthogonal only.     Every connector runs on one axis. The single corner, where the
                         safeguarding rail turns down into the worklist, is a quarter arc
                         of radius 8. There is no diagonal line in the figure.
    One accent.          Amber appears on the safeguarding thread and on the middle
                         ending, and nowhere else. Everything else is ink, paper and a
                         hairline. An accent on five things is not an accent.
    Shape before colour. Full disc, half disc, dashed ring, diamond. The four endings are
                         told apart with the colour removed, which is what keeps them
                         readable in greyscale, under every kind of colour blindness and
                         in a forced-colours theme.

Why the figure is tilted, and why the tilt is not in here.

The four cards stand at four heights on a board that is turned a few degrees away from
the reader. Half of that is drawn in this file and half of it cannot be. An SVG element
does not establish a 3D rendering context in Chrome: `perspective` and
`transform-style: preserve-3d` set on an SVG ancestor are reported back by
`getComputedStyle` and change nothing, and a `translateZ` under one was measured at the
same rect to the hundredth of a pixel as one with no perspective anywhere. So the
projection is declared on the one HTML box inside this figure, the `<svg>` itself, whose
parent `<figure>` carries the perspective. Everything below that box is drawn depth: a
plate per card, offset on both axes at once, which is a transform SVG does support and a
measurement can see. That last part matters more than it sounds. The scroll-walk gate
decides whether two pieces of text overlap by reading their client rects, so a depth
effect whose painted result and reported rect disagree would be a defect that gate is
structurally unable to find.

Geometry lives in this file as plain numbers in the 1240 by 660 user-unit grid. Colour,
motion and type live in `showcase.css`. The two are kept apart so a colour change never
moves a shape and a shape change never touches a token.

The offsets the marks animate along are derived here, in `ROUTE`, and asserted against
the stylesheet by `tests/test_showcase_geometry.py`. They used to be written out twice
with a comment asking the next person to keep them in step, which is a promise no comment
can keep.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# The grid. Every number below is a user unit inside viewBox "0 0 1240 660".
# ---------------------------------------------------------------------------

VIEW_W = 1240
VIEW_H = 660

MARGIN = 40

# The safeguarding rail runs above the cards, on its own band.
RAIL_LABEL_Y = 40
RAIL_Y = 64
STUB_END = 104          # a dashed stub stops six units short of a card

# The four cards share a top and a bottom.
CARD_TOP = 110
CARD_BOT = 562
CARD_H = CARD_BOT - CARD_TOP
CARD_R = 6
STRIPE_W = 4
PAD = 20

CARD_A = (40, 216)      # the register        40 .. 256
CARD_B = (312, 240)     # the lines          312 .. 552
CARD_C = (580, 328)     # the endings        580 .. 908
CARD_D = (952, 248)     # the worklist       952 .. 1200

# The card header, identical in all four so the four rules line up.
EYEBROW_Y = 140
TITLE_Y = 176
SUB_Y = 202
HEAD_RULE_Y = 222

# The three tracks. Stage two's lines and stage three's endings sit on the same three
# y values, so a mark crossing between them travels on one axis at a time.
TRACK = (282, 390, 498)
MID = TRACK[1]

# ---- Stage one: the register ----------------------------------------------
REG_X = 60              # after the stripe and the padding
REG_END = 236
REG_ROW_Y0 = 254
REG_ROW_STEP = 36
REG_ROWS = 7
REG_MARK = 7            # the small square that stands for a child
REG_BAR_X = 74
REG_BAR_H = 8
REG_BAR_W = (84, 70, 96, 64, 88, 76, 92)
REG_RULE_Y = 508
REG_COUNT_Y = 534
REG_COUNT = 21

# ---- Stage two: the lines --------------------------------------------------
SLOT_X = 332
SLOT_W = 200            # 332 .. 532
SLOT_H = 44
SLOT_LABEL_LIFT = 32
CAP_NOTE_Y = 546

# The bus bar in the gap between stage two and stage three. Three lines run into it and
# three endings run out of it, which is one element saying what nine crossing connectors
# would have said illegibly: any line can produce any ending.
BUS_X = 566
BUS_TOP = 274
BUS_BOT = 506

# ---- Stage three: the endings ----------------------------------------------
END_X = 600
END_W = 288             # 600 .. 888
END_H = 84
GLYPH_X = 632
GLYPH_R = 13
END_TEXT_X = 660
END_TITLE_DY = -6
END_SUB_DY = 20
END_TAG_X = 876

# The three rows, and which of them is the one that does not close. They are up here
# rather than inside `_endings()` so the stage's status tag can count them instead of
# carrying a number somebody typed next to them.
FOCAL_ENDING = "undetermined"
END_ROWS = (
    ("resolved", "Reason given", "the call closes here", ""),
    (FOCAL_ENDING, "Nothing learned", "connected, still unexplained", ""),
    ("no-answer", "No answer", "retried, then queued", ""),
)

# ---- Stage four: the worklist ----------------------------------------------
WL_X = 972
WL_W = 208              # 972 .. 1180
WL_H = 62
WL_Y0 = 240
WL_STEP = 78
WL_RANK_X = 984
WL_GLYPH_X = 1014
WL_GLYPH_R = 9
WL_TEXT_X = 1034

# The queue, worst first, and up here for the same reason the endings are: the tag on
# this card says how many rows are waiting and there is one list to read that off.
WL_ROWS = (
    ("safeguarding", "Safeguarding"),
    ("no-answer", "3rd no answer"),
    ("no-answer", "No answer"),
    (FOCAL_ENDING, "Nothing learned"),
)

# Where the two open endings and the safeguarding rail enter the worklist. Three attach
# points on one edge, none of them shared, all of them more than twelve units apart.
DROP_X = 930            # the rail turns down here, in the middle of the gap
WL_IN_Y = WL_Y0 + WL_H // 2     # the head of the queue
ELBOW_R = 8
ARROW = 6               # half the height of an arrowhead

# ---- The legend ------------------------------------------------------------
LEG_RULE_Y = 596
LEG_Y = 626
LEG_R = 9
LEGEND = (
    (40, "resolved", "Reason given"),
    (250, "undetermined", "Nothing learned"),
    (490, "no-answer", "No answer"),
    (670, "safeguarding", "Safeguarding"),
    (880, "call", "Call in progress"),
)

# ---- How far each card stands off the ground -------------------------------
#
# One number per stage, in user units, applied to x and to y at once. Equal on both
# axes is the whole point: every plate in the figure is offset along the same
# forty-five degree oblique, so four cards read as one projection rather than as four
# unrelated drop shadows. Stage three stands highest because it carries the argument,
# and stage one lowest because a register is a record that has not moved yet.
#
# The plate is drawn at the card's own rect and pushed out from under it by
# `showcase.css`, so with transforms off it sits exactly beneath an opaque card and
# the figure is the flat drawing it has always been. That is why the depth is a
# transform rather than a second rectangle at an offset: it has an off switch.
#
# Both clearances are asserted below rather than promised in a sentence. Neither one
# is text and neither one pushes the page sideways, so no browser gate can see a plate
# that has slid under the legend rule or off the edge of the viewBox.
LIFT = {"a": 6, "b": 9, "c": 14, "d": 10}

assert CARD_BOT + max(LIFT.values()) < LEG_RULE_Y - 12, (
    "the deepest plate reaches the legend rule: a card's extrusion would print "
    "under the key that explains the figure"
)
assert CARD_D[0] + CARD_D[1] + LIFT["d"] < VIEW_W - MARGIN // 2, (
    "the worklist's plate runs off the right of the viewBox, which the figure's own "
    "scroll box will clip rather than reveal"
)

# ---- The status tag on each stage ------------------------------------------
#
# A plate, a bloom behind it, and two or three words. It rides the header rule at the
# right end of each card, which is the one band inside a card that carries nothing at
# any width: the eyebrow, the title and the sublabel are left-aligned and short, the
# rail's dashed stubs stop six units above the card, and the first row of content
# starts eighteen units below the rule.
#
# Every count in a tag is read off the figure rather than typed into it, because a tag
# that says three while four rows are drawn beside it is worse than no tag at all.
# The plate is sized from the label's length, because nothing here can measure a
# glyph. The advance below is the widest the tag's own type ramp gets, not the width it
# has at this column, so the plate is roomy on a desktop and still holds its words at
# the breakpoint where the label grows. The alternative, sizing it at the desktop
# width, puts the ink outside its plate on a tablet, and with a fallback face in play
# rather than the page's own it does it on a desktop too.
CHIP_H = 22
CHIP_R = 4
CHIP_PAD = 10           # ink to plate edge, each side
CHIP_ADV = 14           # one tracked capital at the tag's largest size
CHIP_TEXT_DY = 5        # cap height is not symmetrical about a baseline

# How far the light reaches past its plate, and the two numbers that were cut.
#
# Sideways, it stops two units inside the card rather than at the plate plus whatever
# looked good: twenty-two put an amber smudge across the card's own edge and onto the
# plate below it, on all four cards, which reads as a printing fault.
#
# Upwards it stops below the sublabel's descenders, and that one is not a taste
# decision. The contrast gate reads a run's colour against the nearest opaque HTML
# background, and every run in here is SVG, so what it measures is the figure's paper
# and never the amber sitting on top of it. A bloom reaching nine units into "one of
# them does not close" takes that label from 4.9 to about 4.0 against what a reader
# actually sees, and reports 4.9. There is no gate on this page that can catch it, so
# the geometry has to.
CHIP_GLOW_X = 18
CHIP_GLOW_Y = 5

# ---------------------------------------------------------------------------
# The route. One mark's journey, as offsets from where its group is placed.
#
# These are the numbers the keyframes in showcase.css translate by. They are derived
# from the geometry above rather than typed a second time, and a test asserts the
# stylesheet declares exactly these values.
# ---------------------------------------------------------------------------

RUN_START_X = CARD_A[0] + CARD_A[1]             # 256, the register's right edge
RUN_START_Y = MID

ESC_START_X = CARD_C[0] + CARD_C[1] // 2        # 744, above stage three
ESC_START_Y = RAIL_Y

ROUTE = {
    # A call: crawls the queue, holds a line, rides the bus bar, lands on its ending.
    "--cs-x-line-in": SLOT_X - RUN_START_X,
    "--cs-x-line-out": SLOT_X + SLOT_W - RUN_START_X,
    "--cs-x-bus": BUS_X - RUN_START_X,
    "--cs-x-end": GLYPH_X - RUN_START_X,
    "--cs-y-hop": TRACK[1] - TRACK[0],           # one track either way

    # The escalation: along the rail, down into the worklist, in through its edge.
    "--cs-x-rail": DROP_X - ESC_START_X,
    "--cs-x-rail-in": CARD_D[0] - ARROW - ESC_START_X,
    "--cs-y-drop": WL_IN_Y - ESC_START_Y,

    # Where everything rests when motion is off: three waiting, three on the lines,
    # three at the endings, and the escalation part way along its rail.
    "--cs-rest-q0": 0,
    "--cs-rest-q1": 26,
    "--cs-rest-q2": 52,
    "--cs-rest-s0": 100,
    "--cs-rest-s1": 166,
    "--cs-rest-s2": 232,
    "--cs-esc-rest-x": 110,

    # How far each card's plate is pushed out from under it. These are here for the
    # same reason every offset above is: the transform that moves them is a keyframe's
    # neighbour in showcase.css, a keyframe cannot read Python, and a depth that went
    # stale would go on parsing and go on painting at the wrong distance.
    "--cs-lift-a": LIFT["a"],
    "--cs-lift-b": LIFT["b"],
    "--cs-lift-c": LIFT["c"],
    "--cs-lift-d": LIFT["d"],
}


# ---------------------------------------------------------------------------
# Drawing helpers.
# ---------------------------------------------------------------------------

def _clip(key: str, x: int, y: int, w: int, h: int, r: int) -> str:
    """A rounded rect a stripe can be cut against.

    The alternative is arc arithmetic: a three-unit sliver following a six-unit corner
    starts part way round the curve, not at the top. Getting that wrong by a unit leaves
    a pale notch at two corners of every card, which is the kind of defect that reads as
    carelessness from across a room and cannot be found by looking at the code.
    """
    return (
        f'<clipPath id="cs-clip-{key}">'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"/></clipPath>'
    )


def _stripe(key: str, x: int, y: int, h: int) -> str:
    """The bar down a card's left edge.

    Cards only. A tinted row already states itself with a fill and a coloured border,
    and a stripe drawn over that border is a fourth edge nobody can see. It was there,
    it just landed exactly on top of the accent stroke it was meant to reinforce.
    """
    return (
        f'<rect class="cs-stripe" x="{x}" y="{y}" width="{STRIPE_W}" height="{h}" '
        f'clip-path="url(#cs-clip-{key})"/>'
    )


def _card(key: str, x: int, w: int) -> str:
    """One stage: a plate, a hairline, and a stripe down the left edge."""
    return (
        f'<rect class="cs-card" x="{x}" y="{CARD_TOP}" width="{w}" '
        f'height="{CARD_H}" rx="{CARD_R}"/>'
        + _stripe(key, x, CARD_TOP, CARD_H)
    )


def _riser(key: str, x: int, w: int) -> str:
    """The card's own silhouette, one layer down, and the depth the figure reads by.

    It is drawn at the card's rect, not at an offset, and `showcase.css` slides it out
    along the oblique. Two things follow from that and both of them matter. With
    transforms off it is exactly covered by an opaque card, so reduced motion, print
    and the pause control all get the flat figure back without a second drawing. And
    the card itself never moves, which is what keeps the nine travelling marks on the
    lines they are meant to be holding: lift a card and the queue it is wired to would
    have to lift with it.

    The same rounded rect rather than an extruded prism with proper side faces. A
    prism needs the two tangent lines where the corner arcs meet, and getting those
    wrong by a unit leaves a notch at the top right of every card. The offset copy is
    exact by construction, and at this radius the two are the same drawing.
    """
    return (
        f'<rect class="cs-riser cs-riser--{key}" x="{x}" y="{CARD_TOP}" width="{w}" '
        f'height="{CARD_H}" rx="{CARD_R}"/>'
    )


def _chip(x: int, w: int, label: str, lit: bool = False) -> str:
    """The stage's status, as a plate with light behind it.

    A bloom, a plate and a label, riding the right end of the header rule. The bloom
    is a radial gradient on one ellipse rather than a blur filter: a filter re-rasters
    its whole region on every frame it is touched, and this figure is measured for long
    tasks over ten loads. Drawn light costs one paint and never costs a second.

    Only one tag is lit. Amber in this figure means the case that does not close and
    the escalation that catches it, so the tag on stage three is amber and the other
    three glow in ink. An accent on four things is a palette, not an argument.
    """
    cw = 2 * CHIP_PAD + CHIP_ADV * len(label)
    left = x + w - PAD - cw
    cx = left + cw // 2
    cls = "cs-chip" + (" cs-chip--lit" if lit else "")
    return (
        f'<g class="{cls}">'
        f'<ellipse class="cs-chip__glow" cx="{cx}" cy="{HEAD_RULE_Y}" '
        f'rx="{cw // 2 + CHIP_GLOW_X}" ry="{CHIP_H // 2 + CHIP_GLOW_Y}"/>'
        f'<rect class="cs-chip__plate" x="{left}" y="{HEAD_RULE_Y - CHIP_H // 2}" '
        f'width="{cw}" height="{CHIP_H}" rx="{CHIP_R}"/>'
        f'<text class="cs-chip__label" x="{cx}" '
        f'y="{HEAD_RULE_Y + CHIP_TEXT_DY}">{label}</text>'
        "</g>"
    )


def _head(x: int, n: str, title: str, sub: str) -> str:
    """Eyebrow over title over sublabel.

    Three sizes and three weights in three lines of markup. The type ramp is most of the
    reason a card reads as designed rather than as a labelled box.
    """
    tx = x + PAD
    return (
        f'<text class="cs-eyebrow" x="{tx}" y="{EYEBROW_Y}">Stage {n}</text>'
        f'<text class="cs-title" x="{tx}" y="{TITLE_Y}">{title}</text>'
        f'<text class="cs-sub" x="{tx}" y="{SUB_Y}">{sub}</text>'
    )


def _head_rule(x: int, w: int) -> str:
    return (
        f'<line class="cs-rule" x1="{x + PAD}" y1="{HEAD_RULE_Y}" '
        f'x2="{x + w - PAD}" y2="{HEAD_RULE_Y}"/>'
    )


def _glyph(kind: str, cx: int, cy: int, r: int) -> str:
    """The endings, as shapes rather than as colours.

    Full, half, empty, diamond. The distinction survives greyscale, every kind of colour
    blindness and a forced-colours theme, because it is carried by the fill state and not
    by the hue. Colour is the second reading, never the only one.
    """
    core = round(r * 0.54)
    if kind == "resolved":
        # A ring closed round a core, and the core is the same radius as a travelling
        # mark. That is not a flourish: the mark lands on this point and becomes the
        # core, so the ring reads as the call being closed round it. It also stops the
        # legend drawing one filled disc for "reason given" and a second, identical
        # filled disc for "call in progress", which is what it did before.
        return (
            f'<g class="cs-glyph cs-glyph--resolved" transform="translate({cx} {cy})">'
            f'<circle class="cs-glyph__core" r="{core}"/>'
            f'<circle class="cs-glyph__ring" r="{r}"/></g>'
        )
    if kind == "undetermined":
        return (
            f'<g class="cs-glyph cs-glyph--undetermined" transform="translate({cx} {cy})">'
            f'<path class="cs-glyph__half" d="M 0 -{r} A {r} {r} 0 0 0 0 {r} Z"/>'
            f'<circle class="cs-glyph__ring" r="{r}"/></g>'
        )
    if kind == "no-answer":
        return f'<circle class="cs-glyph cs-glyph--no-answer" cx="{cx}" cy="{cy}" r="{r}"/>'
    if kind == "call":
        return f'<circle class="cs-glyph cs-glyph--call" cx="{cx}" cy="{cy}" r="{core}"/>'
    return (
        f'<g class="cs-glyph cs-glyph--safeguarding" transform="translate({cx} {cy})">'
        f'<rect x="-{r}" y="-{r}" width="{2 * r}" height="{2 * r}" rx="2" '
        'transform="rotate(45)"/></g>'
    )


def _arrow_right(x: int, y: int) -> str:
    """An arrowhead pointing right, its tip on x."""
    return (
        f'<path class="cs-arrow" d="M {x - 2 * ARROW} {y - ARROW} L {x} {y} '
        f'L {x - 2 * ARROW} {y + ARROW} Z"/>'
    )


# ---------------------------------------------------------------------------
# The four stages.
# ---------------------------------------------------------------------------

def _register() -> str:
    """Stage one, as a roll rather than as a bar chart.

    Twenty-one children, seven of them drawn. Each row is a square and a redacted bar,
    because the thing in a register is a name, and a name is what a screenshot of this
    page must never carry. Varying the bar widths is what stops seven identical rows from
    reading as a chart of something.
    """
    x, w = CARD_A
    out = [_card("a", x, w), _head(x, "01", "The register", "no reason given"),
           _head_rule(x, w), _chip(x, w, "logged")]
    for i in range(REG_ROWS):
        cy = REG_ROW_Y0 + i * REG_ROW_STEP
        half = REG_MARK // 2
        out.append(
            f'<rect class="cs-reg-mark" x="{REG_X}" y="{cy - half}" '
            f'width="{REG_MARK}" height="{REG_MARK}" rx="1"/>'
            f'<rect class="cs-reg-bar" x="{REG_BAR_X}" y="{cy - REG_BAR_H // 2}" '
            f'width="{REG_BAR_W[i]}" height="{REG_BAR_H}" rx="2"/>'
        )
        if i < REG_ROWS - 1:
            y = cy + REG_ROW_STEP // 2
            out.append(
                f'<line class="cs-hair" x1="{REG_X}" y1="{y}" x2="{REG_END}" y2="{y}"/>'
            )
    out.append(
        f'<line class="cs-rule" x1="{REG_X}" y1="{REG_RULE_Y}" '
        f'x2="{REG_END}" y2="{REG_RULE_Y}"/>'
        f'<text class="cs-figure" x="{REG_X}" y="{REG_COUNT_Y}">{REG_COUNT}'
        '<tspan class="cs-figure__unit" dx="8">unexplained</tspan></text>'
    )
    return "".join(out)


def _lines() -> str:
    """Stage two: three lines, and the queue that backs up behind them.

    The cap is not annotated on top of the picture, it is the picture: nine calls, each
    holding a line for a third of the loop, is three lines busy at every moment.
    """
    x, w = CARD_B
    out = [_card("b", x, w), _head(x, "02", "Calls placed", "three at once, rest wait"),
           _head_rule(x, w), _chip(x, w, f"{len(TRACK)} live")]
    for i, cy in enumerate(TRACK, start=1):
        out.append(
            f'<text class="cs-micro" x="{SLOT_X}" y="{cy - SLOT_LABEL_LIFT}">'
            f'Line {i:02d}</text>'
            f'<rect class="cs-slot" x="{SLOT_X}" y="{cy - SLOT_H // 2}" '
            f'width="{SLOT_W}" height="{SLOT_H}" rx="6"/>'
            f'<line class="cs-track" x1="{SLOT_X}" y1="{cy}" '
            f'x2="{SLOT_X + SLOT_W}" y2="{cy}"/>'
        )
    out.append(
        f'<text class="cs-micro cs-micro--strong" x="{SLOT_X}" y="{CAP_NOTE_Y}">'
        'Cap: 3 concurrent</text>'
    )
    return "".join(out)


def _endings() -> str:
    """Stage three: three rows, one of which does not close.

    The middle row is the only tinted row in the figure and the only one with a coloured
    stripe, because it is the ending a two-bucket pipeline files with the successes. Row
    one carries a tag saying it stops here. Rows two and three do not need one: the
    arrows leaving them say where they go.
    """
    x, w = CARD_C
    open_endings = sum(1 for row in END_ROWS if row[0] == FOCAL_ENDING)
    out = [_card("c", x, w),
           _head(x, "03", "Three endings", "one of them does not close"),
           _head_rule(x, w),
           _chip(x, w, f"{open_endings} open", lit=True)]
    for (kind, title, sub, tag), cy in zip(END_ROWS, TRACK):
        focal = kind == FOCAL_ENDING
        cls = "cs-end-row" + (" cs-end-row--focal" if focal else "")
        top = cy - END_H // 2
        out.append(
            f'<rect class="{cls}" x="{END_X}" y="{top}" width="{END_W}" '
            f'height="{END_H}" rx="4"/>'
        )
        out.append(
            _glyph(kind, GLYPH_X, cy, GLYPH_R)
            + f'<text class="cs-end-title" x="{END_TEXT_X}" y="{cy + END_TITLE_DY}">'
              f'{title}</text>'
            + f'<text class="cs-end-sub" x="{END_TEXT_X}" y="{cy + END_SUB_DY}">'
              f'{sub}</text>'
        )
        if tag:
            out.append(
                f'<text class="cs-tag" x="{END_TAG_X}" y="{cy + END_TITLE_DY}">'
                f'{tag}</text>'
            )
    return "".join(out)


def _worklist() -> str:
    """Stage four: the queue a person opens, worst at the top.

    Each row repeats the glyph of the ending that put it there, so the endings and the
    queue read as one picture rather than as two. The rank is set in the figure's
    smallest type, because the order is the argument and the numbers are only its index.
    """
    x, w = CARD_D
    out = [_card("d", x, w), _head(x, "04", "Worst first", "the queue a person opens"),
           _head_rule(x, w), _chip(x, w, f"{len(WL_ROWS)} queued")]
    for i, (kind, label) in enumerate(WL_ROWS):
        top = WL_Y0 + i * WL_STEP
        cy = top + WL_H // 2
        focal = kind == "safeguarding"
        cls = "cs-wl-row" + (" cs-wl-row--focal" if focal else "")
        out.append(
            f'<rect class="{cls}" x="{WL_X}" y="{top}" width="{WL_W}" '
            f'height="{WL_H}" rx="4"/>'
        )
        out.append(
            f'<text class="cs-rank" x="{WL_RANK_X}" y="{cy + 5}">{i + 1}</text>'
            + _glyph(kind, WL_GLYPH_X, cy, WL_GLYPH_R)
            + f'<text class="cs-wl-label" x="{WL_TEXT_X}" y="{cy + 5}">{label}</text>'
        )
    return "".join(out)


def _rail() -> str:
    """The safeguarding axis, above the stages rather than among them.

    Dashed where the route is merely available, solid where a case is taking it. It runs
    above the cards because escalation is a second question about the same call and not a
    fourth ending, and the one corner in the figure is here, where it turns down into the
    head of the queue.
    """
    stub_xs = [c[0] + c[1] // 2 for c in (CARD_A, CARD_B, CARD_C)]
    stubs = "".join(
        f'<line class="cs-stub" x1="{sx}" y1="{RAIL_Y}" x2="{sx}" y2="{STUB_END}"/>'
        for sx in stub_xs
    )
    return (
        f'<text class="cs-rail-label" x="{MARGIN}" y="{RAIL_LABEL_Y}">'
        'Safeguarding, at any point</text>'
        f'<line class="cs-rail" x1="{MARGIN}" y1="{RAIL_Y}" x2="{DROP_X}" y2="{RAIL_Y}"/>'
        + stubs
        + f'<path class="cs-rail cs-rail--live" d="M {DROP_X} {RAIL_Y} '
          f'V {WL_IN_Y - ELBOW_R} '
          f'A {ELBOW_R} {ELBOW_R} 0 0 0 {DROP_X + ELBOW_R} {WL_IN_Y} '
          f'H {CARD_D[0] - ARROW}"/>'
        + _arrow_right(CARD_D[0], WL_IN_Y)
    )


def _bus() -> str:
    """The bar between stage two and stage three.

    Three lines in, three endings out, one bar. Drawing all nine routes would have been
    honest and unreadable; a bus says the same thing in one stroke, and the marks riding
    it vertically are what make the crossover visible.
    """
    stubs = "".join(
        f'<line class="cs-track" x1="{SLOT_X + SLOT_W}" y1="{cy}" '
        f'x2="{END_X}" y2="{cy}"/>'
        f'<circle class="cs-tee" cx="{BUS_X}" cy="{cy}" r="2.5"/>'
        for cy in TRACK
    )
    return (
        f'<line class="cs-bus" x1="{BUS_X}" y1="{BUS_TOP}" x2="{BUS_X}" y2="{BUS_BOT}"/>'
        + stubs
    )


def _to_worklist() -> str:
    """The two endings that do not close, on their way to the queue.

    Straight, because both ends share a y. They enter the panel rather than a row: which
    row a case lands on is the worklist's own ordering, and pointing an arrow at row
    three would claim an ordering the figure has not earned.
    """
    out = []
    for cy in (TRACK[1], TRACK[2]):
        out.append(
            f'<line class="cs-feed" x1="{CARD_C[0] + CARD_C[1]}" y1="{cy}" '
            f'x2="{CARD_D[0] - ARROW}" y2="{cy}"/>'
            + _arrow_right(CARD_D[0], cy)
        )
    return "".join(out)


def _queue() -> str:
    """The track the waiting calls crawl along, from the register to line one."""
    return (
        f'<line class="cs-track" x1="{RUN_START_X}" y1="{MID}" '
        f'x2="{SLOT_X}" y2="{MID}"/>'
    )


def _legend() -> str:
    """A strip under the figure, outside every card.

    A key floating inside the diagram area collides with the thing it explains. This one
    sits below a rule with nothing above it, which is also why it can afford to name all
    five marks rather than only the ones that fit.
    """
    out = [f'<line class="cs-rule" x1="{MARGIN}" y1="{LEG_RULE_Y}" '
           f'x2="{VIEW_W - MARGIN}" y2="{LEG_RULE_Y}"/>']
    for x, kind, label in LEGEND:
        out.append(
            _glyph(kind, x + LEG_R, LEG_Y - 5, LEG_R)
            + f'<text class="cs-legend" x="{x + 2 * LEG_R + 10}" y="{LEG_Y}">'
              f'{label}</text>'
        )
    return "".join(out)


def _runner(n: int) -> str:
    """One call, on its way through.

    The outer group is placed by attribute and never moves. The two inner groups carry
    the animation: one translates along the route, the other steps down or up into a
    line and then, on the bus bar, into an ending. Both read their offsets from custom
    properties that `.cs-run--1` through `.cs-run--9` set, so there is one pair of
    keyframes for all nine and reassigning a call is one line in the stylesheet.
    """
    return (
        f'<g class="cs-run cs-run--{n}" '
        f'transform="translate({RUN_START_X} {RUN_START_Y})">'
        '<g class="cs-run__x"><g class="cs-run__y">'
        '<circle class="cs-run__mark" r="7"/>'
        "</g></g></g>"
    )


def _glow(key: str) -> str:
    """The light behind one kind of status tag.

    Three stops and no colour. Every stop carries a class and `showcase.css` sets its
    `stop-color` and `stop-opacity`, which is the same rule the rest of this file
    follows: a hex in here is a colour that cannot follow the page when the palette is
    re-cut, and this figure has been through that once already.

    The middle stop is at 0.62 rather than halfway. The plate covers the inner three
    quarters of its own bloom, so a falloff that starts at the midpoint leaves only the
    tail of the gradient showing and the tag reads as having no light behind it at all,
    which is what the first cut of this looked like.
    """
    return (
        f'<radialGradient id="cs-glow-{key}" class="cs-glow cs-glow--{key}">'
        '<stop class="cs-glow__core" offset="0"/>'
        '<stop class="cs-glow__mid" offset="0.62"/>'
        '<stop class="cs-glow__edge" offset="1"/>'
        "</radialGradient>"
    )


def _defs() -> str:
    """Every clip path the stripes are cut against, and the two blooms, in one block."""
    return (
        "<defs>"
        + "".join(
            _clip(key, x, CARD_TOP, w, CARD_H, CARD_R)
            for key, (x, w) in (("a", CARD_A), ("b", CARD_B),
                                ("c", CARD_C), ("d", CARD_D))
        )
        + _glow("lit") + _glow("quiet")
        + "</defs>"
    )


DESCRIPTION = (
    "A four-stage diagram of one morning's absence follow-up, drawn as four cards on a "
    "single row with a safeguarding rail running above them. "
    "Stage one, a register of twenty-one unexplained absences, drawn as redacted rows. "
    "Stage two, calls placed in a wave and held at three lines at once, so a queue of "
    "waiting calls backs up behind the three that are in progress. "
    "Stage three, three endings rather than two: a reason given, which closes; a call "
    "that connected and learned nothing, which does not close; and no answer, which is "
    "retried. The middle ending is the only tinted row in the figure, because a system "
    "with only two buckets files it with the successes and reports full coverage for a "
    "child nobody heard about. A vertical bar between stage two and stage three carries "
    "every line to every ending, because which line placed a call says nothing about how "
    "that call ends. "
    "Stage four, a worklist ordered worst first, holding every case that did not close, "
    "each row repeating the glyph of the ending that put it there. "
    "Each of the four cards stands on its own plate, offset down and to the right, so "
    "the four stand at four heights on one board. Each carries a status tag on its "
    "header rule: twenty-one logged, three live, one open, four queued. The tag on "
    "stage three is the only lit one, because one open is the figure's argument. "
    "Running above all four stages on its own rail is the safeguarding axis, with dashed "
    "stubs onto the first three cards and one solid segment turning down into the head "
    "of the worklist. It sits above the stages rather than among them because a case can "
    "be escalated whatever its ending, and escalation sends it to the head of the queue "
    "rather than to a fourth bucket."
)

TITLE = (
    "How one morning of unexplained absences is worked, from the register to the queue "
    "a person opens"
)


def showcase_markup() -> str:
    """Return the figure as one self-contained block of HTML.

    Every style it needs is in `showcase.css`, scoped under `.calle-showcase`. There is
    no script, no external reference and no identifier that a caller has to supply.
    """
    # Nine calls. Each takes the next line in turn, so line one holds calls one, four and
    # seven. A call holds its line for a third of the loop and the calls are spaced a
    # ninth apart, which is what keeps exactly three of them on the lines at any moment.
    runners = "".join(_runner(n) for n in range(1, 10))

    return (
        # Focusable and named, because under 34rem this box scrolls sideways rather than
        # shrinking the figure to the point where a label paints at seven pixels. A region
        # a pointer can pan and a keyboard cannot is a region half the readers cannot use,
        # and one with no name is one a screen reader announces as nothing.
        # `cs-deck` as well as `calle-showcase`, because the three-endings figure in act
        # 03 carries `calle-showcase` too and shares this whole stylesheet. The
        # perspective belongs to the four-stage board and to nothing else, so it hangs
        # off a class only this figure has rather than off a `:not()` naming the other.
        '<figure class="calle-showcase cs-deck" tabindex="0" role="group" '
        'aria-label="How one morning’s absence follow-up runs, in four stages. '
        'Scrolls sideways on a narrow screen; the caption underneath says the same in '
        'words.">'
        f'<svg class="calle-showcase__svg" viewBox="0 0 {VIEW_W} {VIEW_H}" '
        f'width="{VIEW_W}" height="{VIEW_H}" role="img" '
        'aria-labelledby="calle-showcase-title" '
        'aria-describedby="calle-showcase-desc" focusable="false">'
        f'<title id="calle-showcase-title">{TITLE}</title>'
        f'<desc id="calle-showcase-desc">{DESCRIPTION}</desc>'
        + _defs()

        # The four plates first, under everything. They are the bottom layer rather
        # than the layer immediately behind their own card because three connectors
        # leave a card's right edge, and a plate drawn over one of those would open a
        # gap between the card and the line that leaves it. A wire crossing the front
        # of a solid is what a wire crossing the front of a solid looks like; a route
        # that stops six units short of its own card is a defect.
        + "".join(_riser(key, x, w) for key, (x, w) in
                  (("a", CARD_A), ("b", CARD_B), ("c", CARD_C), ("d", CARD_D)))

        # Connectors before cards, so the route passes behind every plate and no line
        # crosses a label. The rail is the exception it looks like: it runs above the
        # cards and never over one.
        + _rail()
        + _queue()
        + _bus()
        + _to_worklist()

        + _register()
        + _lines()
        + _endings()
        + _worklist()
        + _legend()

        # The marks. Nine calls, and the one case that is escalated.
        + runners
        + f'<g class="cs-esc" transform="translate({ESC_START_X} {ESC_START_Y})">'
          '<g class="cs-esc__x"><g class="cs-esc__y">'
          '<rect class="cs-esc__mark" x="-8" y="-8" width="16" height="16" rx="2" '
          'transform="rotate(45)"/></g></g></g>'

        "</svg>"
        '<figcaption class="calle-showcase__caption">'
        "Twenty-one unexplained absences, calls held at three lines at once with the rest "
        "waiting, three endings rather than two, and the queue that is left. Safeguarding "
        "runs above all four and goes straight to the head of the queue."
        "</figcaption>"
        "</figure>"
    )
