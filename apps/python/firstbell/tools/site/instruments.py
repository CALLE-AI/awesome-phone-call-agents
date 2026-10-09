"""Two more drawings over the same evidence: what a call costs at scale, and whether the
two languages agree.

Same rules as `callscope.py`, and they are the rules for every figure on this page.

  1. Every mark comes out of the receipts. Nothing is placed by eye, nothing is
     illustrative, and a quantity the receipts do not carry is not drawn.
  2. Build-time SVG. No client JavaScript, no canvas, no WebGL. The figure that a
     browser with scripting disabled draws is the figure everybody gets.
  3. Motion is `transform` alone, so a frame costs a composite and no layout, no paint
     and no path re-raster. One shared duration per figure, declared once.
  4. `prefers-reduced-motion: reduce` rests every mark in its final state. The evidence
     is the frame and not the sweep, so nothing is withheld.
  5. A figure that could be read as claiming more than it measures says what it is not,
     in the caption, in the same size as the rest of it.

Rule 5 is why the parity matrix is laid out by field rather than by scenario. Read by
scenario it is "9 of 12 fields agree", and 75 per cent of anything reads as a mediocre
score to somebody skimming. Read by field it is the actual finding: the one field that
decides whether a child is escalated agrees in both languages on all four scenarios, and
the two descriptive fields do not always. Those are the same twelve comparisons. The
second arrangement is the one that says which of them matter, and act 07 carries the
ceiling either way.
"""

VB_W = 1000


def _keyframes(name: str, stops: list) -> str:
    body = "".join(f"{pct:.3f}%{{transform:{tf}}}" for pct, tf in stops)
    return f"@keyframes {name}{{{body}}}"


# ---- what a call costs, against what a school day of attendance is worth ----------------

SCALE_L = 8
SCALE_R = 992
BAR_H = 30
GROUP = 10          # calls per mark on the long bar
SCALE_SWEEP = 11.0  # seconds for the marker to cross the bar


def scale_markup(per_absence: float, per_call: float, desk_saved: float,
                 allotment: str, days: int, source: str) -> str:
    """One student-day of funding, drawn against the price of one call.

    The ratio is the whole figure and it is a division of two published numbers: what a
    state funds per student per day of attendance, and what CALL-E billed this account
    per call. Neither is this page's estimate.

    Why the small bar is a hairline. At the scale that fits the large one, one call is
    1.4 units of 984, and that is what it is drawn as. Rescaling it to something visible
    would be drawing a different ratio than the one the caption states, which on a page
    about numbers coming from somewhere is the worst thing a figure could do. The caption
    says the width is 1.4 units, so a reader can check the drawing against the arithmetic.
    """
    ratio = per_absence / per_call
    groups = int(ratio // GROUP)              # whole marks only; the remainder is stated
    width = SCALE_R - SCALE_L
    slice_w = width / groups
    call_w = width / ratio                    # one call, at the same scale
    desk_w = call_w * (desk_saved / per_call)

    rows = []
    css = []

    # ---- the long bar: one student-day -------------------------------------------------
    y = 54
    rows.append(f'<text class=in-lab x="{SCALE_L}" y="{y - 12}">'
                f'${per_absence:,.2f} &#183; one student, one day, where funding follows '
                f'attendance</text>')
    rows.append(f'<rect class=in-bar x="{SCALE_L}" y="{y}" width="{width}" '
                f'height="{BAR_H}"/>')
    ticks = "".join(f'<line class=in-tick x1="{SCALE_L + i * slice_w:.2f}" y1="{y}" '
                    f'x2="{SCALE_L + i * slice_w:.2f}" y2="{y + BAR_H}"/>'
                    for i in range(1, groups))
    rows.append(ticks)
    # The marker steps one mark at a time rather than gliding, because the bar is counted
    # and not continuous: a marker between two marks would be a price nothing was billed
    # at. `steps(groups - 1, jump-none)` lands on every mark including both ends.
    css.append(_keyframes("inscale", [(0.0, "translateX(0)"),
                                      (100.0, f"translateX({slice_w * (groups - 1):.3f}px)")]))
    css.append(f".in-step{{animation:inscale {SCALE_SWEEP}s "
               f"steps({groups - 1}, jump-none) infinite both}}")
    rows.append(f'<g class=in-step><rect class=in-mark x="{SCALE_L}" y="{y}" '
                f'width="{slice_w:.2f}" height="{BAR_H}"/></g>')
    rows.append(f'<text class=in-note x="{SCALE_L}" y="{y + BAR_H + 18}">'
                f'each mark is {GROUP} calls, ${per_call * GROUP:,.2f}. '
                f'{groups} marks across.</text>')

    # ---- the same scale, one call and the desk time it removes -------------------------
    y2 = 138
    rows.append(f'<text class=in-lab x="{SCALE_L}" y="{y2 - 12}">'
                f'${per_call:,.2f} &#183; one call, billed, at the same scale</text>')
    rows.append(f'<rect class=in-bar-lit x="{SCALE_L}" y="{y2}" width="{max(call_w, 1.0):.2f}" '
                f'height="{BAR_H}"/>')
    rows.append(f'<text class=in-note x="{SCALE_L + 14}" y="{y2 + 20}">'
                f'{call_w:.1f} units wide of {width}. It is a hairline because that is what '
                f'the arithmetic makes it.</text>')

    y3 = 196
    rows.append(f'<text class=in-lab x="{SCALE_L}" y="{y3 - 12}">'
                f'${desk_saved:,.2f} &#183; the desk time one call removes, at the same '
                f'scale</text>')
    rows.append(f'<rect class=in-bar-lit x="{SCALE_L}" y="{y3}" width="{desk_w:.2f}" '
                f'height="{BAR_H}"/>')
    rows.append(f'<text class=in-note x="{SCALE_L + desk_w + 10:.1f}" y="{y3 + 20}">'
                f'{desk_saved / per_call:.0f} calls wide. A ceiling, not a saving: act 04 '
                f'says what it is bounded by.</text>')

    css.append("@media (prefers-reduced-motion:reduce){.in-step{animation:none}}")
    height = 244
    caption = (
        f'${per_absence:,.2f} is {allotment} per student in average daily attendance '
        f'divided by a {days}-day year, from {source}. ${per_call:,.2f} is what CALL-E '
        f'billed this account per call; CALL-E publishes no price, so it is a measurement '
        f'of one account and not a rate anybody is offered. The two divide to '
        f'{ratio:.0f} calls per student-day, and the bar is marked in tens of calls with '
        f'the remainder left off rather than rounded up. Explaining an absence does not '
        f'make a student present, so this figure claims none of that funding: it is what '
        f'one day of it is worth, beside what one call costs.')
    return (
        '<figure class=instrument>'
        f'<style>{"".join(css)}</style>'
        f'<p class=in-headline>One school day of one child&#8217;s attendance funding pays '
        f'for {ratio:.0f} calls.</p>'
        '<div class=in-scroll tabindex=0 role=region '
        'aria-label="One student-day of funding against the price of one call, scrollable">'
        f'<svg class=in-svg viewBox="0 0 {VB_W} {height}" role=img '
        f'aria-label="{caption}">{"".join(rows)}</svg></div>'
        f'<figcaption>{caption}</figcaption>'
        '</figure>')


# ---- whether the two languages agree, field by field ------------------------------------

P_LAB_R = 196       # scenario labels end here
P_ROW_H = 56
P_HEAD = 52
P_SWEEP = 9.0


def parity_markup(pairs: list, calls: dict, fields: list) -> str:
    """The same four scenarios in English and in Tamil, compared field by field.

    Laid out by field, for the reason in the module docstring: the twelve comparisons
    read as a percentage tell a reader nothing about which of them matter, and the one
    that matters is the field a safeguarding escalation is decided on.

    Agreement is string equality on the value CALL-E returned, `unknown` included. Two
    calls that both came back with no answer for a field agree about that field, and
    saying otherwise would score this page's own honest empties as disagreements.
    """
    cols = len(fields)
    col_w = (VB_W - 8 - P_LAB_R) / cols
    rows = []
    css = []
    agree_by_field = [0] * cols

    for r, pair in enumerate(pairs):
        y = P_HEAD + r * P_ROW_H
        en = calls[pair["en"]]["structured"]
        ta = calls[pair["ta"]]["structured"]
        rows.append(f'<text class=in-row-lab x="0" y="{y + 20}">{pair["label"]}</text>')
        rows.append(f'<text class=in-row-ids x="0" y="{y + 36}">'
                    f'{pair["en"]} &#183; {pair["ta"]}</text>')
        rows.append(f'<line class=in-hair x1="0" y1="{y - 8}" x2="{VB_W - 8}" '
                    f'y2="{y - 8}"/>')
        for c, field in enumerate(fields):
            x = P_LAB_R + c * col_w
            ev = (en.get(field) or "unknown").strip()
            tv = (ta.get(field) or "unknown").strip()
            same = ev == tv
            if same:
                agree_by_field[c] += 1
            rows.append(f'<text class="in-v in-v-{"same" if same else "diff"}" '
                        f'x="{x:.1f}" y="{y + 15}">en {ev}</text>')
            rows.append(f'<text class="in-v in-v-{"same" if same else "diff"}" '
                        f'x="{x:.1f}" y="{y + 33}">ta {tv}</text>')
            # One mark per comparison, brought up on a shared twelve-step schedule so the
            # matrix fills in reading order rather than all at once.
            n = r * cols + c
            name = f"inp{n}"
            at = (n / (len(pairs) * cols)) * 100.0
            css.append(_keyframes(name, [(0.0, "scale(0)"), (at, "scale(0)"),
                                         (min(100.0, at + 5.0), "scale(1)"),
                                         (100.0, "scale(1)")]))
            mx, my = x + col_w - 26, y + 22
            css.append(f".{name}{{animation-name:{name};"
                       f"transform-origin:{mx:.1f}px {my:.1f}px}}")
            glyph = "=" if same else "≠"
            rows.append(f'<text class="in-eq in-mark {name} '
                        f'in-eq-{"same" if same else "diff"}" x="{mx:.1f}" '
                        f'y="{my + 5:.1f}">{glyph}</text>')

    # ---- column heads, and each field's own score --------------------------------------
    for c, field in enumerate(fields):
        x = P_LAB_R + c * col_w
        rows.append(f'<text class=in-col-lab x="{x:.1f}" y="20">{field}</text>')
        score = f'{agree_by_field[c]} of {len(pairs)} agree'
        cls = "in-col-all" if agree_by_field[c] == len(pairs) else "in-col-some"
        rows.append(f'<text class="in-col-score {cls}" x="{x:.1f}" y="38">{score}</text>')

    foot = P_HEAD + len(pairs) * P_ROW_H
    rows.append(f'<line class=in-hair x1="0" y1="{foot - 8}" x2="{VB_W - 8}" '
                f'y2="{foot - 8}"/>')
    css.append(f".in-mark{{animation-duration:{P_SWEEP}s;animation-timing-function:linear;"
               "animation-iteration-count:infinite;animation-fill-mode:both}")
    css.append("@media (prefers-reduced-motion:reduce){.in-mark{animation:none;"
               "transform:none}}")

    lead = fields[0]
    total = sum(agree_by_field)
    caption = (
        f'The four committed scenarios, each performed once in English and once in Tamil, '
        f'compared on the value CALL-E returned for every field. Agreement is string '
        f'equality and counts <code>unknown</code> on both sides as agreement, because two '
        f'calls that both came back with no answer for a field do agree about that field. '
        f'<code>{lead}</code> is the field a safeguarding escalation is decided on and it '
        f'agrees on {agree_by_field[0]} of {len(pairs)}. The descriptive fields do not '
        f'always, and {total} of {len(pairs) * len(fields)} comparisons agree in total. '
        f'What this is not: a claim about Tamil beyond these four pairs, or about any '
        f'language CALL-E does not offer for the number dialled. Act 07 holds that ceiling '
        f'and the run that shows it.')
    return (
        '<figure class=instrument>'
        f'<style>{"".join(css)}</style>'
        f'<p class=in-headline>The field that decides whether a child is escalated agrees '
        f'in both languages, {agree_by_field[0]} of {len(pairs)}.</p>'
        '<div class=in-scroll tabindex=0 role=region '
        'aria-label="English against Tamil, field by field, scrollable">'
        f'<svg class=in-svg viewBox="0 0 {VB_W} {foot + 8}" role=img '
        f'aria-label="{caption}">{"".join(rows)}</svg></div>'
        f'<figcaption>{caption}</figcaption>'
        '</figure>')
