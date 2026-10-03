"""Two real calls on one time axis, and what each one actually learned.

Why it exists. The first screen of this page was a masthead, four counters and four
cards of prose, and a reader who gave it thirty seconds left with the counters and none
of the argument. The argument is not a number. It is that a call can connect, run
longer than the one beside it, and come back with nothing the office can act on, and
that a system with two buckets files that as a success. That is a comparison, and a
comparison is a drawing.

What it draws, and where every mark comes from. Two calls this software placed, taken
out of `transcripts.json`: their turn-taking, their waveforms, the instant each
structured field was answered, and the value that came back. Nothing is placed by eye
and nothing is illustrative. The time axis is real seconds. The waveform is the peak
envelope the transcriber published, downsampled by taking the maximum of each bucket
rather than the mean, because a mean of an envelope is not an envelope and would draw a
quieter call than the one that happened. A field's node sits at the turn `commit_turns`
resolves it to, which is the page's own reading of the transcript and says so in the
caption, and a field whose value came back `unknown` gets no node at all: its rail
stays dashed to the end of the call, which is what having no answer looks like.

The pair is the whole point. S-4105 is the call the first screen quotes. It runs longer
than S-4101 and comes back with two of its three fields empty. Set one above the other
on a shared axis, three solid rails against one solid and two dashed, and a reader who
has read no prose at all has the argument.

How it moves. Build-time SVG and generated keyframes, no client JavaScript and no
canvas. Every animation is `transform` alone, so a frame costs a composite and no
layout, no paint and no path re-raster. The read-head and the rail fills share one
schedule and one duration declared once: a rail reaching its node at the instant the
head passes it is true by construction rather than by two numbers agreeing in a
stylesheet. That is why the fills are `scaleX` on an overlay sized to the commit rather
than an `offset-path` each, which would advance on arc length and drift.

The waveform does not reveal. A reveal is a clip, a clip is not a transform, and a
figure that repaints a 170-bar envelope every frame to look busy would cost more than
it says. The swept region is a gradient that travels with the head.

Under `prefers-reduced-motion: reduce` the head parks at the end of the span and every
node and fill rests in its final state, because the evidence here is the comparison and
not the sweep. Nothing is withheld from a reader who asked for less movement.
"""

# The frame. A 1000-unit box, and the plot inset far enough on the left for a field name
# set in mono at 11px and on the right for the value that came back.
VB_W = 1000
PLOT_L = 160         # t = 0
PLOT_R = 840         # t = the shared span
VALUE_L = 12         # a value chip sits this far past the end of its rail

SWEEP_S = 14.0       # one pass of the read-head, in wall-clock seconds
BARS = 168           # waveform bars across the full span

LANE_H = 196
COMPACT_H = 52       # a control lane: one row, no envelope and no rails
TOP = 34
WAVE_H = 34
RAIL_GAP = 22


def _fmt(n: float) -> str:
    return f"{n:.2f}".rstrip("0").rstrip(".")


def _span(*calls: dict) -> float:
    """The shared axis, rounded up to a 10-second tick.

    Both lanes are drawn against one span so that a length on one is the same number of
    seconds as a length on the other. Scaling each lane to its own duration would draw
    the 59-second call and the 34-second call the same width, which is the one reading
    this figure exists to prevent.
    """
    longest = max(c["seconds"] for c in calls)
    return 10.0 * (int(longest / 10.0) + 1)


def _x(t: float, span: float) -> float:
    return PLOT_L + (t / span) * (PLOT_R - PLOT_L)


def _envelope(peaks: list, seconds: float, span: float) -> list:
    """The peak envelope, downsampled to one value per bar, by maximum.

    Bars are laid out on the shared span, so a call shorter than the span simply stops
    where it stopped. The published envelope covers the call's own duration, so the bar
    count is the call's share of the span.
    """
    n = max(1, int(round(BARS * seconds / span)))
    out = []
    for i in range(n):
        lo = int(i * len(peaks) / n)
        hi = max(lo + 1, int((i + 1) * len(peaks) / n))
        window = peaks[lo:hi] or [0.0]
        t = (i + 0.5) / n * seconds
        out.append((t, max(window)))
    return out


def _commit_seconds(call: dict, fields: list, commits: list) -> list:
    """One instant per field, or None where the field came back with no answer.

    `commit_turns` answers a different question: which turn each field was answered at,
    given that it was answered. A field whose value is `unknown` was not, and marking it
    at a turn anyway would draw a call learning something it did not learn. That is the
    one place this figure could tell a lie, so it is the one place with a guard.
    """
    out = []
    for i, field in enumerate(fields):
        value = (call["structured"].get(field) or "unknown").strip()
        if value == "unknown" or i >= len(commits):
            out.append(None)
            continue
        turn = call["turns"][commits[i]]
        out.append(float(turn["offset_seconds"]))
    return out


def _keyframes(name: str, stops: list) -> str:
    body = "".join(f"{pct:.3f}%{{transform:{tf}}}" for pct, tf in stops)
    return f"@keyframes {name}{{{body}}}"


def _ticks(span: float, bottom: float) -> str:
    step = 10 if span <= 80 else 20
    out = []
    t = 0
    while t <= span + 0.1:
        x = _x(t, span)
        out.append(f'<line class=csc-tick x1="{x:.1f}" y1="{TOP - 16:.1f}" '
                   f'x2="{x:.1f}" y2="{bottom:.1f}"/>'
                   f'<text class=csc-tick-t x="{x:.1f}" y="{TOP - 22:.1f}">{t}s</text>')
        t += step
    return "".join(out)


def _bars(peaks: list, n: int = 56) -> str:
    """The recording's own loudness, downsampled to a row of bars.

    Not a waveform in the audio-editing sense and not labelled as one. It is the smallest
    mark that says "this is a recording and it can be played", which is the only job the
    graphic on the first screen has. The values are the peaks CALL-E's own transcript
    carries, so a quiet call draws quiet.
    """
    if not peaks:
        return ""
    step = max(1, len(peaks) // n)
    buckets = [max(peaks[k:k + step]) for k in range(0, len(peaks), step)][:n]
    top = max(buckets) or 1.0
    return "".join(
        f'<span style="height:{max(8, round(v / top * 100)):d}%"></span>'
        for v in buckets)


def callscope_markup(calls: dict, fields: list, commit_turns, lanes: list,
                     headline: str) -> str:
    """Two calls, side by side, as two cards a reader can play.

    This replaced a drawn instrument: both calls on one axis of real seconds, with an
    envelope, tick marks, field commit markers and a read-head that tracked the audio. It
    was accurate and it was the first thing on the page, and it read as noise. Twenty-six
    labels and two hundred and thirty marks is a diagram somebody studies, and nobody
    studies the first screen; they decide about it.

    What the drawing was for survives, all of it, in a form that can be read at a glance:
    the two calls are still side by side, the fields each one came back with are still
    named and still show which came back empty, and the two verdicts are still the point
    of the whole figure. What is gone is the axis, and with it every way two labels can
    land on each other at a width nobody tested.

    `commit_turns` is no longer read. The signature keeps it because the caller passes it
    and because the same argument is what a returning axis would need.
    """
    del commit_turns
    picked = [calls[lane["id"]] for lane in lanes]
    cards = []
    for lane, call in zip(lanes, picked):
        cid = lane["id"]
        mins, secs = divmod(int(round(call["seconds"])), 60)
        struct = call.get("structured") or {}
        rows = "".join(
            '<div class=csc-f>'
            f'<dt>{f}</dt>'
            + (f'<dd class=csc-on>{struct.get(f)}</dd>'
               if struct.get(f) and struct.get(f) != "unknown"
               else '<dd class=csc-off>unknown</dd>')
            + '</div>'
            for f in fields)
        # The disagreement is the product, so the card that carries one says so in its
        # own class rather than leaving a reader to compare two words.
        splits = lane["two_bucket"] != lane["ours"]
        verdicts = (
            '<li class=csc-v>'
            '<span class=csc-v-who>a two-bucket system</span>'
            f'<span class="csc-v-say{" csc-struck" if splits else ""}">'
            f'{lane["two_bucket"]}</span>'
            f'<span class=csc-v-note>{lane["two_bucket_note"]}</span></li>'
            '<li class="csc-v csc-v-ours">'
            '<span class=csc-v-who>firstbell</span>'
            f'<span class=csc-v-say>{lane["ours"]}</span>'
            f'<span class=csc-v-note>{lane["ours_note"]}</span></li>')
        cards.append(
            f'<div class="csc-card{" csc-card--splits" if splits else ""}" '
            f'data-csc-lane="{cid}">'
            '<div class=csc-top>'
            f'<span class=csc-id>{cid}</span>'
            f'<span class=csc-len>{mins}:{secs:02d}</span>'
            f'<button class="hear csc-hear" type=button data-csc-play="{cid}" '
            f'data-csc-seconds="{call["seconds"]:.2f}" '
            f'data-words-play="Hear {cid}" data-words-pause="Pause {cid}" '
            f'aria-label="Hear the recording of {cid}, {lane["label"]}" '
            'aria-pressed=false>'
            '<svg class=i-play viewBox="0 0 12 14" aria-hidden=true>'
            '<path d="M0 0l12 7-12 7z"/></svg>'
            '<svg class=i-pause viewBox="0 0 12 14" aria-hidden=true>'
            '<path d="M0 0h4v14H0zM8 0h4v14H8z"/></svg>'
            f'<span data-play-label>Hear {cid}</span></button>'
            '</div>'
            f'<div class=csc-wave aria-hidden=true>{_bars(call.get("peaks") or [])}'
            '<span class=csc-played></span></div>'
            f'<p class=csc-said>{lane["label"]}</p>'
            f'<dl class=csc-fields>{rows}</dl>'
            f'<ul class=csc-verdicts>{verdicts}</ul>'
            '</div>')

    # The dates come off the calls. This sentence said "on 2026-09-04" for both lanes, and
    # on 2026-09-11 the second lane became a call placed a week later, so the caption was
    # dating a call to a day it was not placed on. A caption that gets the date of its own
    # evidence wrong is the kind of small false thing this page is an argument against.
    placed = []
    for call in picked:
        day = call.get("placed_on")
        if day and day not in placed:
            placed.append(day)
    when = ("on " + " and ".join(placed)) if placed else "against the production API"

    caption = (
        f'{lanes[0]["id"]} and {lanes[1]["id"]} are two calls this software placed '
        f'through CALL-E {when}, to a consented line, on a scripted scenario with '
        'an invented pupil name. Both came back with a structured result the schema '
        'accepts. The fields are what CALL-E returned, verbatim, and the durations are '
        'the recordings’ own. The two-bucket row is a counterfactual and is '
        'labelled as one: it is the rule act 03 states, applied to these receipts, and '
        'not a measurement of another product.')

    return (
        '<figure class=callscope>'
        + (f'<p class=csc-headline>{headline}</p>' if headline else '')
        + f'<div class=csc-cards>{"".join(cards)}</div>'
        '<details class="fold csc-fold"><summary>What these two calls are, and what the '
        'two-bucket row is not</summary>'
        f'<figcaption>{caption}</figcaption>'
        '</details>'
        '</figure>')
