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


def callscope_markup(calls: dict, fields: list, commit_turns, lanes: list,
                     headline: str) -> str:
    """One dict per lane: id, label, two_bucket, two_bucket_note, ours, ours_note."""
    picked = [calls[lane["id"]] for lane in lanes]
    span = _span(*picked)
    css = []
    rows = []

    # Measured on the built page: 361 marks in this one figure, and 13 of its 37 labels
    # were duplicates. Both lanes carried the same three field names, the same two system
    # names and the word `resolved` three times, because both were drawn at full weight.
    # No two rects overlapped and nothing was clipped, which is why the geometry probes
    # all came back clean; what the eye reads as clutter here is repetition, not
    # collision, and a probe that only looks for collisions will never find it.
    #
    # The call where the systems agree is a control. Its job is one sentence, that this
    # software does not simply mark everything undetermined, and it was spending half the
    # frame to say it. It is now a single row, and the call where they disagree keeps the
    # whole instrument. Honesty is unchanged and the argument is louder.
    y = TOP
    for n, (lane, call) in enumerate(zip(lanes, picked)):
        compact = bool(lane.get("compact"))
        y0 = y
        y += COMPACT_H if compact else LANE_H
        wave_mid = y0 + 22 + WAVE_H / 2
        end_x = _x(call["seconds"], span)
        commits = _commit_seconds(call, fields, commit_turns(call, fields))
        answered = sum(1 for c in commits if c is not None)
        key = lane["id"].lower().replace("-", "")

        # One group per lane, so the control above can name the half of the frame its
        # recording belongs to without the script having to know the geometry.
        rows.append(f'<g class=csc-lane data-csc-lane="{lane["id"]}">')

        # The scenario in words before the identifier, because `S-4105` tells a reader
        # who has been on this page for ten seconds nothing at all, and the label is not
        # written here: it is the one the evidence file registered the pair under.
        rows.append(
            f'<text class=csc-lane-label x="0" y="{y0 - 8:.1f}">{lane["label"]}</text>'
            f'<text class=csc-lane-id x="0" y="{y0 + 10:.1f}">{lane["id"]}</text>'
            f'<text class=csc-lane-meta x="62" y="{y0 + 10:.1f}">'
            f'{call["locale"]} &#183; {_fmt(call["seconds"])}s &#183; '
            f'{answered} of {len(fields)} fields answered</text>')

        if compact:
            # One row: who the call was, and that both systems closed it. The verdicts
            # are spelled rather than drawn, because with no rails under them there is
            # no geometry left for them to line up with.
            both = lane["two_bucket"] if lane["two_bucket"] == lane["ours"] else None
            # The label, the id and the meta were already appended above this, for
            # every lane, so only the verdict is added here. Re-emitting them was the
            # first version of this branch and it printed the control's name, id and
            # meta twice: removing a duplication by adding one.
            rows.append(
                # Its own line rather than beside the meta. Set at PLOT_L on the same
                # baseline it measured 99px into `en-IN . 34.58s . 3 of 3 fields
                # answered`, because that string is as long as the inset and a lane
                # label is not a fixed width.
                f'<text class=csc-agree x="{PLOT_L}" y="{y0 + 30:.1f}">'
                + (f'both systems say {both}. {lane["ours_note"]}'
                   if both else f'{lane["two_bucket"]} / {lane["ours"]}')
                + '</text>')
            rows.append('</g>')
            continue

        bars = []
        for bt, amp in _envelope(call["peaks"], call["seconds"], span):
            h = max(1.2, amp * WAVE_H)
            bx = _x(bt, span)
            bars.append(f'<rect x="{bx:.2f}" y="{wave_mid - h / 2:.2f}" '
                        f'width="1.9" height="{h:.2f}"/>')
        rows.append(f'<g class=csc-wave>{"".join(bars)}</g>')

        # Turn-taking. A tick above the envelope for the agent, below it for the family,
        # which is the one thing about a call a reader can check against the transcript
        # in act 02 without reading a word of this figure.
        marks = []
        for turn in call["turns"]:
            tx = _x(float(turn["offset_seconds"]), span)
            if turn["speaker"] == "bot":
                marks.append(f'<line class="csc-turn csc-turn-bot" x1="{tx:.1f}" '
                             f'y1="{wave_mid - WAVE_H / 2 - 7:.1f}" x2="{tx:.1f}" '
                             f'y2="{wave_mid - WAVE_H / 2 - 2:.1f}"/>')
            else:
                marks.append(f'<line class="csc-turn csc-turn-you" x1="{tx:.1f}" '
                             f'y1="{wave_mid + WAVE_H / 2 + 2:.1f}" x2="{tx:.1f}" '
                             f'y2="{wave_mid + WAVE_H / 2 + 7:.1f}"/>')
        rows.append("".join(marks))

        # The call's own end, marked on the shared axis. Without it the shorter call
        # reads as a rail that was cut off rather than a call that finished.
        rail_foot = y0 + 22 + WAVE_H + RAIL_GAP * len(fields) + 4
        rows.append(f'<line class=csc-end x1="{end_x:.1f}" y1="{y0 + 14:.1f}" '
                    f'x2="{end_x:.1f}" y2="{rail_foot:.1f}"/>')

        for i, field in enumerate(fields):
            ry = y0 + 22 + WAVE_H + 14 + i * RAIL_GAP
            at = commits[i]
            value = (call["structured"].get(field) or "unknown").strip()
            rows.append(f'<text class=csc-field x="0" y="{ry + 3.5:.1f}">{field}</text>')
            rows.append(f'<line class=csc-rail x1="{PLOT_L}" y1="{ry:.1f}" '
                        f'x2="{end_x:.1f}" y2="{ry:.1f}"/>')
            if at is None:
                rows.append(f'<line class="csc-rail csc-rail-none" x1="{PLOT_L}" '
                            f'y1="{ry:.1f}" x2="{end_x:.1f}" y2="{ry:.1f}"/>')
                rows.append(f'<circle class=csc-node-none cx="{end_x:.1f}" '
                            f'cy="{ry:.1f}" r="4.2"/>')
                rows.append(f'<text class="csc-val csc-val-none" x="{end_x + VALUE_L:.1f}" '
                            f'y="{ry + 3.5:.1f}">unknown</text>')
                continue
            cx = _x(at, span)
            pct = (at / span) * 100.0
            fill = f"csf{key}{i}"
            node = f"csn{key}{i}"
            # The fill is an overlay sized to the commit and scaled from zero, so its
            # leading edge is at the head's x at every instant of the sweep. See the
            # module docstring: this is why it is not an offset-path.
            css.append(_keyframes(fill, [(0.0, "scaleX(0)"), (pct, "scaleX(1)"),
                                         (100.0, "scaleX(1)")]))
            css.append(_keyframes(node, [(0.0, "scale(0)"),
                                         (max(0.0, pct - 0.35), "scale(0)"),
                                         (min(100.0, pct + 1.6), "scale(1)"),
                                         (100.0, "scale(1)")]))
            css.append(f".{fill}{{animation-name:{fill};"
                       f"transform-origin:{PLOT_L}px {ry:.1f}px}}")
            css.append(f".{node}{{animation-name:{node};"
                       f"transform-origin:{cx:.1f}px {ry:.1f}px}}")
            rows.append(f'<line class="csc-rail-on csc-mark {fill}" x1="{PLOT_L}" '
                        f'y1="{ry:.1f}" x2="{cx:.1f}" y2="{ry:.1f}"/>')
            rows.append(f'<circle class="csc-node csc-mark {node}" cx="{cx:.1f}" '
                        f'cy="{ry:.1f}" r="4.6"/>')
            rows.append(f'<text class=csc-val x="{end_x + VALUE_L:.1f}" '
                        f'y="{ry + 3.5:.1f}">{value}</text>')

        # What each system does with this call. Two rows, and the disagreement is the
        # whole figure: identical input, and one of them closes a case on a child nobody
        # reached. The verdicts are passed in rather than derived here, because deciding
        # what a call is belongs to the software and not to a drawing of it.
        oy = y0 + 22 + WAVE_H + 14 + len(fields) * RAIL_GAP + 8
        diverges = lane["two_bucket"] != lane["ours"]
        if diverges:
            # The one plate of brand ground in the frame, under the two rows that are the
            # product. Painted first because SVG has no z-index: a plate appended after
            # the text it grounds covers it.
            rows.append(f'<rect class=csc-flag-plate x="{PLOT_L - 10}" '
                        f'y="{oy - 14:.1f}" width="{PLOT_R - PLOT_L + 170}" '
                        f'height="{2 * 19 + 10}" opacity="0.28" rx="2"/>')
        for k, (system, verdict, note) in enumerate((
                ("a two-bucket system", lane["two_bucket"], lane["two_bucket_note"]),
                ("firstbell", lane["ours"], lane["ours_note"]))):
            vy = oy + k * 19
            cls = "csc-out-wrong" if (diverges and k == 0) else "csc-out-ours"
            rows.append(f'<text class=csc-sys x="0" y="{vy:.1f}">{system}</text>'
                        f'<text class="csc-out {cls}" x="{PLOT_L}" y="{vy:.1f}">'
                        f'{verdict}</text>'
                        f'<text class=csc-out-note x="{PLOT_L + 128}" y="{vy:.1f}">'
                        f'{note}</text>')

        rows.append('</g>')

    # From the running y, because lanes are no longer all the same height. A
    # count times LANE_H would leave a compact lane's share of empty frame below
    # the figure and put the tick rules through it.
    height = y + 4
    travel = PLOT_R - PLOT_L

    # One schedule for every moving mark in the frame, declared once.
    css.append(_keyframes("cshead", [(0.0, "translateX(0)"),
                                     (100.0, f"translateX({travel}px)")]))
    css.append(f".csc-mark,.csc-head{{animation-duration:{SWEEP_S}s;"
               "animation-timing-function:linear;animation-iteration-count:infinite;"
               "animation-fill-mode:both}")
    css.append(".csc-head{animation-name:cshead}")
    # The resting frame: the head at the end of the span, every rail filled to its node
    # and every node up. `scale(1)` and `scaleX(1)` are the final stop of every schedule
    # above, so rest and the last frame of the sweep are the same picture.
    # The closing brace on the query itself was missing and had been since this figure was
    # written. It cost nothing while this was the last rule in the sheet, because a parser
    # closes an open block at the end of a stylesheet, so the query worked and no gate
    # could see it. The first rule appended after it landed *inside* the query instead:
    # correct CSS, parsed without complaint, and live only for a reader who asked for
    # reduced motion. Nothing is wrong with the rule that disappears, which is what makes
    # this shape worth the comment.
    css.append("@media (prefers-reduced-motion:reduce){.csc-mark{animation:none;"
               "transform:none}.csc-head{animation:none;"
               f"transform:translateX({travel}px)}}}}")
    # While a recording is playing the ambient loop stops and the head is driven from the
    # audio element's own clock instead. `transform:none` is the last stop of every mark's
    # schedule, so the frame under a live head is the settled frame: every rail drawn to
    # its node. The lane that is not playing dims, which is the only way two lanes on one
    # axis can say which of them you are listening to.
    css.append(".callscope.csc-live .csc-mark{animation:none;transform:none}"
               ".callscope.csc-live .csc-head{animation:none}"
               ".callscope.csc-live .csc-lane{opacity:0.32;transition:opacity 180ms ease}"
               ".callscope.csc-live .csc-lane[data-csc-on]{opacity:1}")

    a, b = picked[0], picked[1]
    longer = (b["seconds"] / a["seconds"] - 1.0) * 100.0
    # The caption leads with what the two systems do differently, because that is what the
    # drawing shows. An earlier version led with the two durations, which described the
    # picture accurately and left the reader to work out why it mattered.
    caption = (
        f'Two calls this software placed, on one axis of real seconds. '
        f'{lanes[0]["id"]} is the control and is drawn as one row, because both systems '
        f'close it and there is nothing in it to compare. {lanes[1]["id"]} gets the '
        f'instrument: it ran {longer:.0f} per cent longer than {lanes[0]["id"]}, came '
        f'back schema-valid like it, and came back with two of its three fields empty. '
        f'It reached a parent and left the office knowing nothing it can act on. '
        f'The envelope and the turn marks are the transcriber&#8217;s; the instant a '
        f'field is marked answered is this page&#8217;s own reading of the transcript, '
        f'taken as the first family turn after the question that asks for it, and the '
        f'structured result itself arrives once, at the end. The two-bucket row is a '
        f'counterfactual and is labelled as one: it is the rule act 03 states, applied to '
        f'these receipts, not a measurement of another product. '
        f'Swept at {span / SWEEP_S:.1f} times real time.')

    # The recordings were nine screens below the drawing of them. A reader met an argument
    # about what a call did and could not hear the call, on an entry whose whole subject is
    # what a voice on a phone gives you and what it withholds. These two buttons put the
    # real audio under the instrument that reads it: pressing one stops the ambient sweep,
    # drops the head to the recording's own speed, and runs it across the same axis. The
    # figure is complete and legible with the script dead, with audio absent from the build
    # and with reduced motion asked for; this only ever adds the sound.
    controls = "".join(
        f'<button class="hear csc-hear" type=button data-csc-play="{lane["id"]}" '
        f'data-csc-seconds="{picked[n]["seconds"]:.2f}" '
        f'data-words-play="Hear {lane["id"]}" data-words-pause="Pause {lane["id"]}" '
        f'aria-label="Hear the recording of {lane["id"]}, {lane["label"]}" '
        'aria-pressed=false>'
        '<svg class=i-play viewBox="0 0 12 14" aria-hidden=true>'
        '<path d="M0 0l12 7-12 7z"/></svg>'
        '<svg class=i-pause viewBox="0 0 12 14" aria-hidden=true>'
        '<path d="M0 0h4v14H0zM8 0h4v14H8z"/></svg>'
        f'<span data-play-label>Hear {lane["id"]}</span></button>'
        for n, lane in enumerate(lanes))

    return (
        f'<figure class=callscope data-csc-span="{span:.2f}" '
        f'data-csc-plot-l="{PLOT_L:.1f}" data-csc-travel="{travel:.1f}">'
        f'<style>{"".join(css)}</style>'
        f'<p class=csc-headline>{headline}</p>'
        f'<div class=csc-controls>{controls}</div>'
        '<div class=csc-scroll tabindex=0 role=region '
        'aria-label="Two calls compared on one time axis, scrollable">'
        f'<svg class=csc-svg viewBox="0 0 {VB_W} {height:.0f}" role=img '
        f'aria-label="{caption}">'
        # The swept region travels with the head rather than revealing the envelope,
        # because a reveal is a clip and a clip is not a transform.
        '<defs><linearGradient id=csc-swept x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0%" stop-color="currentColor" stop-opacity="0"/>'
        '<stop offset="100%" stop-color="currentColor" stop-opacity="0.05"/>'
        '</linearGradient></defs>'
        f'<g class=csc-ticks>{_ticks(span, height - 26)}</g>'
        f'{"".join(rows)}'
        '<g class=csc-head>'
        f'<rect class=csc-swept x="{PLOT_L - travel}" y="{TOP + 4}" '
        f'width="{travel}" height="{height - TOP - 26:.0f}"/>'
        f'<line x1="{PLOT_L}" y1="{TOP - 14}" x2="{PLOT_L}" y2="{height - 20:.0f}"/>'
        '</g>'
        '</svg></div>'
        f'<figcaption>{caption}</figcaption>'
        '</figure>')
