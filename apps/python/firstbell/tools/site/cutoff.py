"""Whether the morning finishes before the register closes, as an object you can turn.

The morning board above this one is a picture of the problem. This is a picture of the
decision, and it is the one an attendance office actually has to make.

Nothing here is modelled. `tools/throughput.py` measures how long a call takes out of the
turn offsets CALL-E returned on eleven real calls, adds one poll interval a call, and
divides. This module imports that same function rather than restating its arithmetic, so
the board cannot drift from the tool: change the measurement and the drawing moves with
it. The only premises are the ones the tool already takes on its command line and which
are printed under the drawing: how many pupils, and how long the window is.

The reason it is worth three dimensions rather than a bar chart is the plane. A cutoff is
not a number on an axis to an attendance clerk, it is a wall: the register closes and
whatever has not finished has not finished. Bars that go through a surface say that in a
way a horizontal dashed line does not, and the two that go through it are the default
setting and the one above it.
"""

from __future__ import annotations

from pathlib import Path

# The setting a district would actually be choosing between. 1 and 2 are left out on
# purpose: at 441.7 and 220.8 minutes they are six and three times the whole window, and
# putting them in forces a scale on which every bar that matters is a stub. The range that
# is drawn is the range where the answer changes.
LADDER = (3, 4, 6, 8, 10, 12, 16, 20, 25)


def curve(receipts: Path, pupils: int = 500, cutoff_minutes: int = 75) -> dict:
    """The real numbers, from the tool that measures them, never from this file."""
    import importlib.util
    import sys

    tools = Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location("throughput", tools / "throughput.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("throughput", module)
    spec.loader.exec_module(module)

    lengths = module.call_lengths(receipts)
    if not lengths:
        # A clone with no receipts gets no board rather than a board of zeroes. A drawing
        # of an unmeasured quantity is the failure this whole entry is about.
        return {}
    mean = sum(lengths) / len(lengths)
    per_call = mean + module.POLL_SECONDS
    rows = [{"concurrency": c,
             "minutes": round(module.minutes(pupils, c, per_call), 1)}
            for c in LADDER]
    fits = [r for r in rows if r["minutes"] <= cutoff_minutes]
    return {
        "calls_measured": len(lengths),
        "mean_call_seconds": round(mean, 1),
        "poll_seconds": module.POLL_SECONDS,
        "per_call_seconds": round(per_call, 1),
        "pupils": pupils,
        "cutoff_minutes": cutoff_minutes,
        "rows": rows,
        "lowest_that_fits": fits[0]["concurrency"] if fits else None,
    }


def _bars_svg(data: dict) -> str:
    """The same figure flat, in the markup, for every reader the scene never reaches."""
    rows = data["rows"]
    cutoff = data["cutoff_minutes"]
    top = max(r["minutes"] for r in rows)
    W, H, PAD = 600.0, 260.0, 34.0
    step = (W - PAD * 2) / len(rows)
    scale = (H - PAD * 2) / top
    out = []
    y_cut = H - PAD - cutoff * scale
    out.append(f'<line class=cut-plane x1="{PAD - 8}" y1="{y_cut:.1f}" '
               f'x2="{W - PAD + 8}" y2="{y_cut:.1f}"/>')
    out.append(f'<text class=cut-plane-t x="{PAD - 8}" y="{y_cut - 6:.1f}">'
               f'the register closes, {cutoff} minutes</text>')
    # The setting the sentence above the drawing recommends. Marked in the flat figure as
    # well as in the scene, because a reader with no WebGL was previously given nine bars
    # of which two were different and no indication of which one to choose.
    low = data.get("lowest_that_fits")
    for i, r in enumerate(rows):
        h = r["minutes"] * scale
        x = PAD + i * step + step * 0.18
        w = step * 0.64
        if r["minutes"] > cutoff:
            cls = "cut-bar cut-miss"
        elif r["concurrency"] == low:
            cls = "cut-bar cut-fits"
        else:
            cls = "cut-bar"
        out.append(f'<rect class="{cls}" x="{x:.1f}" y="{H - PAD - h:.1f}" '
                   f'width="{w:.1f}" height="{h:.1f}"/>')
        if r["concurrency"] == low:
            out.append(f'<line class=cut-fits-rule x1="{x - 3:.1f}" y1="{H - PAD + 3:.1f}" '
                       f'x2="{x + w + 3:.1f}" y2="{H - PAD + 3:.1f}"/>')
        out.append(f'<text class=cut-x x="{x + w / 2:.1f}" y="{H - PAD + 14:.1f}">'
                   f'{r["concurrency"]}</text>')
    return (f'<svg class=cut-flat viewBox="0 0 {W:.0f} {H:.0f}" role=img '
            f'aria-label="Minutes to finish {data["pupils"]} calls at each concurrency '
            f'setting, against a {cutoff} minute cutoff">{"".join(out)}</svg>')


def cutoff_markup(data: dict) -> str:
    """The board, the sentence it makes, and the arithmetic behind both."""
    if not data:
        return ""
    low = data["lowest_that_fits"]
    rows = {r["concurrency"]: r["minutes"] for r in data["rows"]}
    default_over = rows[3] - data["cutoff_minutes"]
    return (
        '<section class=cutoff '
        f'data-cut-rows="{",".join(f"{r['concurrency']}:{r['minutes']}" for r in data["rows"])}" '
        f'data-cut-line="{data["cutoff_minutes"]}" '
        # The one bar the page is recommending. Derived here, beside the sentence that
        # names it, rather than in the scene: two places deciding which setting fits is
        # two places that can disagree, and the prose and the drawing would then be
        # pointing at different bars with nothing to catch it. `curve()` already computes
        # it; this just carries it across.
        f'data-cut-fits="{low if low else ""}" '
        # The window, so a marker can sit at the exact height the bars are cut at without
        # the scene recomputing the scale from the row list.
        f'data-cut-pupils="{data["pupils"]}">'
        '<p class=eyebrow>Whether the morning finishes before the register closes</p>'
        f'<h2>At the default setting, it does not.</h2>'
        '<p class=mrn-lede>A cutoff is a wall, not a target. Every bar that goes through '
        f'the plane is a morning that ended with families still unreached. The default '
        f'cap of three misses by {default_over:.0f} minutes. '
        f'{"Concurrency " + str(low) + " is the first that fits" if low else "Nothing here fits"}'
        ', and it is one flag.</p>'
        f'<div class=cut-stage data-cut-stage>{_bars_svg(data)}</div>'
        # Worded so it stays true after the board has been turned. "Left to right" is a
        # caption for a drawing that cannot move, and this one can.
        '<p class=cut-key>One bar a concurrency setting, from '
        f'{LADDER[0]} at the tall end to {LADDER[-1]} at the short end. The plane is the '
        f'{data["cutoff_minutes"]} minute cutoff; the two that go through it are '
        f'{LADDER[0]} and {LADDER[1]}.</p>'
        '<p class=mrn-note>'
        f'<b>Measured, not modelled.</b> {data["calls_measured"]} real calls, timed from '
        'the turn offsets CALL-E itself returned, give a mean of '
        f'{data["mean_call_seconds"]} seconds. One {data["poll_seconds"]:.0f} second poll '
        f'interval a call makes {data["per_call_seconds"]} seconds a worker a call, and '
        f'the rest is division: {data["pupils"]} absences against a '
        f'{data["cutoff_minutes"]} minute window. This drawing calls '
        '<code>tools/throughput.py</code> at build time rather than repeating its '
        'arithmetic, so it cannot disagree with the tool.'
        '</p>'
        '<p class=mrn-note>'
        '<b>What the flag costs.</b> The cap is the only brake there is, because a call '
        'that has been accepted cannot be recalled. Raising it to '
        f'{low if low else "a higher setting"} means that many families dialled at once '
        'with no way to stop any of them. That belongs in a decision a district makes on '
        'purpose, which is why it is drawn here instead of left in a default.'
        '</p>'
        '</section>')


CUTOFF_CSS = """
.cutoff { max-width: 58rem; margin: var(--space-6) auto 0; padding: 0 var(--space-4); }
.cutoff .eyebrow, .cutoff h2, .cutoff .mrn-lede, .cutoff .mrn-note,
.cut-key { max-width: 62ch; }
.cutoff h2 { margin: var(--space-2) 0 var(--space-4); }
.cut-stage { position: relative; margin: 0 0 var(--space-2); touch-action: pan-y; }
/* The boards are drawings, not prose, and a drawing held to a reading measure is a
 * drawing made small for no reason. So the section is wide and the prose inside it is
 * held to its own measure, rather than the stage breaking out of a narrow section.
 *
 * The breakout was tried first, `margin-left:50%` with a translate against a 62ch
 * parent, and it overflowed: a child wider than its parent widens the document, and
 * every `margin:auto` on the page then centres against the new width. Two sections
 * ended up centred on different axes. Widen the container, never the child. */
.cut-stage, .mrn-stage { width: 100%; }
.cut-key { font-family: var(--ui); font-size: var(--size-2); color: var(--ink-3);
  margin: 0 0 var(--space-4); }
.cut-stage canvas { display: block; width: 100%; height: auto; }
.cut-flat { display: block; width: 100%; height: auto; }
.cut-bar { fill: var(--ink); opacity: 0.22; }
/* --live-mark, not --brand: page.css defines no --brand, and an undefined custom property
 * makes the declaration invalid at computed-value time rather than falling back, so
 * `fill` inherited and these bars painted rgb(0, 0, 0). Measured with JavaScript off on
 * 2026-09-10. The bars that miss the cutoff were separated from the ones that fit by
 * opacity alone, which is the one distinction this figure cannot afford to lose. */
.cut-miss { fill: var(--live-mark); opacity: 1; }
/* The bar the sentence recommends, in the flat drawing as well as in the scene. A reader
 * with no WebGL should be able to find the answer in the picture, not only in the prose. */
.cut-fits { fill: var(--ink); opacity: 0.55; }
.cut-fits-rule { stroke: var(--live-mark); stroke-width: 1.5; opacity: 0.9; }
.cut-plane { stroke: var(--ink); stroke-width: 1; stroke-dasharray: 4 3; opacity: 0.5; }
.cut-plane-t, .cut-x { font-family: var(--mono); font-size: 10px; fill: var(--ink-3); }
.cut-x { text-anchor: middle; }
"""
