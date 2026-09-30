"""The three endings, drawn as one call and the only three ways it comes back.

This replaces a Lottie. The old figure exported a still from `tools/make_figure.py`, and
what it drew was two grey rounded rectangles and a hairline in three hundred pixels of
empty page. It was not a stylised diagram that needed reading twice, it was broken: the
words that made it mean anything sat in a separate HTML list beside it, so the drawing
carried no content at all and the list carried all of it.

`make_figure.py` stays. The film still takes its Lottie, which is what that generator was
written for. The page takes this instead, and the page is better off for three reasons
that have nothing to do with taste: it drops the 45.6 KB player and its CDN, the figure is
identical in every renderer because there is only one renderer, and the definitions are
inside the drawing rather than beside it, so there is one thing to read instead of two.

It is drawn in the same system as `showcase.py` and shares its stylesheet, its glyphs and
its type ramp. That is the point of the rename to `.calle-showcase` on this figure's root:
a closed ring, a half ring and a dashed ring mean the same three things in both figures, so
a reader learns the language once. Two figures on one page inventing two visual languages
is how a deck looks when three people made it.

    one call            a dot on a spine
      -> resolved       a ring closed round a core: the office has an answer
      -> undetermined   the same ring, half filled: the accent, and the argument
      -> failed         the ring alone, dashed: nobody answered

Geometry is in user units inside viewBox "0 0 900 352", which renders at very close to 1:1
in the column this figure sits in, so a size here is a pixel on screen.
"""

from __future__ import annotations

# Authored at the width of the column this figure is given, so a size here is close to a
# pixel on screen. It was 620 first, with a max-width holding it there, which left 284px of
# dead page to its right and, once that was removed, scaled every label up by 1.46 so the
# definitions came out larger than the body copy beside them.
VIEW_W = 900
VIEW_H = 352

# The header, and the dot the whole figure leaves from.
EYEBROW_Y = 14
HEAD_RULE_Y = 26
SOURCE = (16, 50)
SOURCE_R = 6

# The spine, and the three cards hanging off it.
SPINE_X = 16
CARD_X = 44
CARD_W = VIEW_W - CARD_X          # 576, out to the right edge
CARD_H = 84
CARD_R = 4
STRIPE_W = 4
ROW_Y0 = 62
ROW_STEP = 98                     # 84 tall, 14 apart
ROWS = 3

GLYPH_X = 78
GLYPH_R = 13
TEXT_X = 108
# Two rows carry one line and one carries two, so a single pair of offsets leaves the
# short rows sitting high in their card with the space all at the bottom. The block is
# centred on the card instead, which costs one branch and is the difference between three
# cards and three cards that were laid out.
NAME_DY = (-12, -22)              # one line, two lines
SAY_DY = (14, 4)
SAY_STEP = 20

ROW_CY = tuple(ROW_Y0 + i * ROW_STEP + CARD_H // 2 for i in range(ROWS))

# What a mark travels to get from the dot to an ending. Derived, not typed twice.
ROUTE = {
    "--en-x-in": GLYPH_X - SOURCE[0],
    "--en-y-1": ROW_CY[0] - SOURCE[1],
    "--en-y-2": ROW_CY[1] - SOURCE[1],
    "--en-y-3": ROW_CY[2] - SOURCE[1],
}

# The three endings, their glyph, and what each one means. The sentences are the ones the
# page already published in the list beside the old drawing, split only where a line has to
# break. Nothing was reworded to fit.
ENDINGS = (
    ("resolved", "resolved",
     ("The office has an answer it can act on. The case closes.",)),
    ("undetermined", "undetermined",
     ("The call happened and produced nothing usable.",
      "A person has to pick it up, and the software says so rather than closing it.")),
    ("no-answer", "failed",
     ("Nobody answered on any number. Nothing happened, and nothing is owed.",)),
)

DESCRIPTION = (
    "One call and the only three states it can come back in, drawn as three cards hanging "
    "off a single spine. Resolved is a ring closed round a solid core: the office has an "
    "answer it can act on and the case closes. Undetermined is the same ring half filled "
    "and is the only tinted card: the call happened and produced nothing usable, so a "
    "person has to pick it up and the software says so rather than closing it. Failed is "
    "the ring alone and dashed: nobody answered on any number, nothing happened and "
    "nothing is owed. A mark travels the spine into each ending in turn. The three glyphs "
    "are the same three used in the four-stage figure further down the page."
)


def _glyph(kind: str, cx: int, cy: int, r: int) -> str:
    """The same three marks the four-stage figure uses, drawn by the same rules."""
    core = round(r * 0.54)
    if kind == "resolved":
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
    return f'<circle class="cs-glyph cs-glyph--no-answer" cx="{cx}" cy="{cy}" r="{r}"/>'


def endings_markup() -> str:
    """The figure, as one self-contained block of HTML with no script and no asset.

    The root carries `calle-showcase` as well as its own class on purpose: that is the
    scope every colour, glyph and type rule in `showcase.css` is written under, and sharing
    it is what stops this figure growing a second palette. The one figure on this page that
    had its own tokens spent three palette re-cuts drawing the old ones.
    """
    rows = []
    for i, (kind, name, lines) in enumerate(ENDINGS):
        top = ROW_Y0 + i * ROW_STEP
        cy = ROW_CY[i]
        focal = kind == "undetermined"
        cls = "cs-end-row" + (" cs-end-row--focal" if focal else "")
        rows.append(
            f'<line class="cs-track" x1="{SPINE_X}" y1="{cy}" x2="{CARD_X}" y2="{cy}"/>'
            f'<rect class="{cls}" x="{CARD_X}" y="{top}" width="{CARD_W}" '
            f'height="{CARD_H}" rx="{CARD_R}"/>'
        )
        if focal:
            rows.append(
                f'<rect class="cs-stripe cs-stripe--focal" x="{CARD_X}" y="{top}" '
                f'width="{STRIPE_W}" height="{CARD_H}" clip-path="url(#en-clip)"/>'
            )
        two = len(lines) > 1
        says = "".join(
            f'<tspan x="{TEXT_X}" y="{cy + SAY_DY[two] + n * SAY_STEP}">{line}</tspan>'
            for n, line in enumerate(lines)
        )
        rows.append(
            _glyph(kind, GLYPH_X, cy, GLYPH_R)
            + f'<text class="cs-end-title en-name" x="{TEXT_X}" y="{cy + NAME_DY[two]}">'
              f'{name}</text>'
            + f'<text class="cs-end-sub" x="{TEXT_X}">{says}</text>'
        )

    marks = "".join(
        f'<g class="en-run en-run--{n}" transform="translate({SOURCE[0]} {SOURCE[1]})">'
        '<g class="en-run__x"><g class="en-run__y">'
        '<circle class="cs-run__mark" r="6"/>'
        "</g></g></g>"
        for n in range(1, ROWS + 1)
    )

    return (
        '<figure class="calle-showcase endings-fig">'
        f'<svg class="calle-showcase__svg endings-fig__svg" '
        f'viewBox="0 0 {VIEW_W} {VIEW_H}" width="{VIEW_W}" height="{VIEW_H}" role="img" '
        'aria-labelledby="calle-endings-title" aria-describedby="calle-endings-desc" '
        'focusable="false">'
        '<title id="calle-endings-title">One call, and the only three states it can come '
        'back in</title>'
        f'<desc id="calle-endings-desc">{DESCRIPTION}</desc>'
        '<defs><clipPath id="en-clip">'
        f'<rect x="{CARD_X}" y="{ROW_Y0 + ROW_STEP}" width="{CARD_W}" height="{CARD_H}" '
        f'rx="{CARD_R}"/></clipPath></defs>'

        f'<text class="cs-eyebrow" x="0" y="{EYEBROW_Y}">One call, three endings</text>'
        f'<line class="cs-rule" x1="0" y1="{HEAD_RULE_Y}" x2="{VIEW_W}" '
        f'y2="{HEAD_RULE_Y}"/>'

        # The spine is drawn before the cards so the route passes behind every plate.
        f'<line class="cs-bus" x1="{SPINE_X}" y1="{SOURCE[1]}" x2="{SPINE_X}" '
        f'y2="{ROW_CY[-1]}"/>'
        + "".join(rows)
        + f'<circle class="cs-glyph--call" cx="{SOURCE[0]}" cy="{SOURCE[1]}" '
          f'r="{SOURCE_R}"/>'
        + marks
        + "</svg>"
        '<figcaption class="calle-showcase__caption">'
        "Every call this software places comes back as exactly one of these three. The "
        "third one is the whole argument: a system with two buckets has to file it with "
        "the successes."
        "</figcaption>"
        "</figure>"
    )
