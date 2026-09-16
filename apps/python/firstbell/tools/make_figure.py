"""The three endings, drawn as an animation, from one source that feeds three surfaces.

Somebody coming to this entry as a school district administrator found the page tiring
and stopped partway. Among the things they could not follow were the three words the whole
product turns on, `resolved`, `undetermined` and `failed`, which the page states as a table
column and never shows.

A sentence explaining three outcomes is a paragraph. Three outcomes drawn once is a glance.

The figure is authored here rather than in a design tool because a design tool's output is a
file somebody exported by hand, and this repository does not publish those. Running this
script twice gives the same bytes, the colours are read out of `page.css` through
`video_facts`, and the counts under each ending are counted off the receipts rather than
typed. If the palette is re-cut or a call is added, the figure moves with them.

Three outputs from the one description:

    --lottie   Lottie JSON, which is what `@remotion/lottie` puts in the video
    --svg      a still, for the page, so no player and no script ships to a reader
    --check    rebuild both and report whether either would change

The page takes the SVG on purpose. The evidence page holds a 120 KB gzipped weight ceiling
and a 50 ms long-task ceiling, and it currently sits at 52.8 KB with a longest task of 0 ms
across five loads. A Lottie player is around 50 KB gzipped for one figure that never needs
to respond to anything, which is most of the remaining budget spent on a decoration. The
video has no such ceiling, so it takes the Lottie.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP / "tools"))

from lottie import objects, Color, Point  # noqa: E402
from lottie.objects.easing import EaseOut, Sigmoid  # noqa: E402
from lottie.exporters.core import export_lottie  # noqa: E402
from lottie.exporters.svg import export_svg  # noqa: E402

import video_facts  # noqa: E402

W, H, FPS, DUR = 900, 300, 30, 240


def _rgb(hex_string: str) -> Color:
    h = hex_string.lstrip("#")
    return Color(*(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))


def _lift(colour: Color, amount: float) -> Color:
    """The same ink with a light on it, for the top of a surface.

    A premium surface is not a flat swatch: it carries the light it is under. Both stops are
    computed from the one palette colour rather than typed as a second hex, so re-cutting the
    palette moves the highlight with it and the two can never disagree.
    """
    def shift(c: float) -> float:
        # Toward white by a share of the headroom above, toward black by a share of the ink
        # already there. Doing it the first way in both directions drives a dark colour
        # negative, which python-lottie writes out as an invalid stop.
        return c + (1.0 - c) * amount if amount >= 0 else c * (1.0 + amount)

    return Color(*(shift(c) for c in (colour.r, colour.g, colour.b)))


def _rounded(group, x, y, w, h, fill, radius=8.0, lit=0.0):
    rect = group.add_shape(objects.Rect())
    rect.position.value = Point(x + w / 2, y + h / 2)
    rect.size.value = Point(w, h)
    rect.rounded.value = radius
    if lit:
        # A vertical two-stop gradient, lighter at the top, because every surface in this
        # drawing is lying on paper under a light. Gradients are used rather than the drop
        # shadow the effect panel offers: the page renders this with lottie-web, which drops
        # native effects silently, so a shadow would look right in the editor and be absent
        # for every reader. A gradient fill is drawn by every player there is.
        grad = group.add_shape(objects.GradientFill())
        grad.gradient_type = objects.GradientType.Linear
        grad.start_point.value = Point(x + w / 2, y)
        grad.end_point.value = Point(x + w / 2, y + h)
        grad.colors.set_stops([(0.0, _lift(fill, lit)), (1.0, _lift(fill, -lit * 0.5))])
    else:
        group.add_shape(objects.Fill(fill))
    return rect


def _stroke_path(group, points, colour, width, cx, cy):
    """An open stroked path, drawn in scene coordinates around a centre.

    Round caps and round joins, because every corner in this drawing is round and a mark with
    mitred ends is a mark from a different set.
    """
    path = group.add_shape(objects.Path())
    bez = path.shape.value
    for dx, dy in points:
        bez.add_point(Point(cx + dx, cy + dy))
    stroke = group.add_shape(objects.Stroke(colour, width))
    stroke.line_cap = objects.LineCap.Round
    stroke.line_join = objects.LineJoin.Round
    return path


def _dot(group, cx, cy, diameter, fill):
    circle = group.add_shape(objects.Ellipse())
    circle.position.value = Point(cx, cy)
    circle.size.value = Point(diameter, diameter)
    group.add_shape(objects.Fill(fill))
    return circle


def build() -> objects.Animation:
    """One call leaving, and the only three states it can come back in.

    The motion carries the idea rather than decorating it. The call travels once, left to
    right, and then the three endings arrive one after another instead of together, because
    arriving together would say they are alternatives of equal weight and they are not: the
    order is the order the office cares about. `undetermined` lands last and holds longest,
    which is the one the whole product turns on.

    Easing is `EaseOut` on everything that arrives. Nothing here bounces or overshoots. This
    is a diagram about children who are not at school.
    """
    palette = video_facts.palette()
    ink = _rgb(palette["ink"])
    line = _rgb(palette["line-strong"])
    # Two orders, and they are not the same order.
    #
    # Down the page, the three read `resolved`, `undetermined`, `failed`, because that is
    # the order of the labels beside the drawing, the order of the table in the README and
    # the order the CLI prints. They were drawn in arrival order instead, so the middle bar
    # was `failed` while the middle label said `undetermined`, and a reader mapping the top
    # bar to the top label got the second one wrong. The labels are HTML beside an SVG that
    # carries no text of its own, which is what makes position the only thing connecting
    # them.
    #
    # In time they still arrive `resolved`, `failed`, `undetermined`. That stagger is the
    # point of animating this at all: arriving together would say the three are alternatives
    # of equal weight, and `undetermined` lands last and holds longest because it is the one
    # the whole product turns on. Position is where a reader looks; timing is what the motion
    # says. Decoupling them costs one number per row.
    endings = [
        ("resolved", palette["resolved"], 0),
        ("undetermined", palette["undetermined"], 2),
        ("failed", palette["failed"], 1),
    ]
    live = _rgb(palette["live"])
    paper = _rgb(palette["paper"])
    ease = EaseOut(0.42)
    # The breath is the only easing here that is symmetric, because it is the only motion
    # that is not an arrival. Everything else lands once and stops.
    breath = Sigmoid(0.5)

    # Two beats after the last ending lands. `SETTLED` is when the route that carried the
    # call stops competing for attention; `OPEN` is when the one unfinished ending starts
    # saying so. They overlap by ten frames so the figure never fully rests.
    SETTLED, OPEN = 100, 110

    # Three 60px rows on an 88px pitch, centred in the 300px box: 32 above, 32 below,
    # and the middle row's centre on the spine the connectors leave from.
    ROW_TOP, ROW_PITCH = 32, 88
    ROW_MID = ROW_TOP + 30
    # Where a row's mark sits: far enough in from the rounded corner to look placed.
    MARK_X = 514

    anim = objects.Animation(DUR, FPS)
    anim.width, anim.height = W, H
    layer = anim.add_layer(objects.ShapeLayer())

    # Declared first and animated last. A Lottie shape list draws its FIRST entry on top, so
    # a group appended at the end of the build sits underneath everything: the open-case
    # light was authored correctly, keyframed correctly, and painted behind the very bar it
    # marks. Nothing reported it, because a dot that never draws still exports.
    open_case = layer.add_shape(objects.Group())

    # One mark per ending, knocked out of the bar in the paper colour.
    #
    # The three bars used to differ only by hue, which made the drawing depend entirely on
    # the HTML labels sitting beside it. That is fine on the page and useless everywhere
    # else: the same figure goes into the video, where nothing is beside it, and a reader
    # with a colour vision deficiency got three slabs in three greys. A tick, a light and a
    # rule say which is which without a word, and they are the marks this product already
    # uses: the office has its answer, somebody still has to act, nothing happened.
    marks = [layer.add_shape(objects.Group()) for _ in range(3)]

    # The tick, at the head of the row the office can close.
    _stroke_path(marks[0], [(-7, 0), (-2, 5.5), (7.5, -6)], paper, 3.0, MARK_X, ROW_MID)
    # Nothing at the head of `undetermined`: the open-case light below stands in its place,
    # and two marks on one row would be the figure hedging about which one matters.
    # The rule, at the head of the row where nothing happened.
    _stroke_path(marks[2], [(-7, 0), (7, 0)], paper, 3.0, MARK_X, ROW_MID + 2 * ROW_PITCH)

    # The spine, drawn first so everything sits on it. It grows from the call rather than
    # being there already: the path is made by the call, not waiting for it.
    spine = layer.add_shape(objects.Group())
    bar = _rounded(spine, 168, 148, 300, 4, line, 2.0)
    bar.size.add_keyframe(0, Point(0, 4))
    bar.size.add_keyframe(34, Point(300, 4), ease)
    bar.position.add_keyframe(0, Point(168, 150))
    bar.position.add_keyframe(34, Point(318, 150), ease)

    # The call itself. One plate, and it settles before the spine starts.
    call = layer.add_shape(objects.Group())
    _rounded(call, 30, 120, 130, 60, ink, 10.0, lit=0.05)
    call.transform.opacity.add_keyframe(0, 0)
    call.transform.opacity.add_keyframe(12, 100, ease)
    call.transform.position.add_keyframe(0, Point(-26, 0))
    call.transform.position.add_keyframe(16, Point(0, 0), ease)

    # The path the call travelled, as opposed to the call itself or where it ended up.
    # The plate is deliberately not in here: it is the subject the drawing opens on, and
    # fading it left the exported still showing near-black ink as mid grey.
    route = [spine]

    # The three endings. Staggered, and each one slides a little way in rather than fading
    # on the spot, so a reader's eye is carried from the spine to the row.
    for row, (_name, colour, arrival) in enumerate(endings):
        at = 40 + arrival * 20
        arm = layer.add_shape(objects.Group())
        _rounded(arm, 486, ROW_TOP + row * ROW_PITCH, 384, 60, _rgb(colour), 10.0, lit=0.05)
        arm.transform.opacity.add_keyframe(0, 0)
        arm.transform.opacity.add_keyframe(at, 0)
        arm.transform.opacity.add_keyframe(at + 16, 100, ease)
        arm.transform.position.add_keyframe(at, Point(-22, 0))
        arm.transform.position.add_keyframe(at + 20, Point(0, 0), ease)

        # The short connector from the spine to this row, drawn just before it arrives. It
        # grows outward from the spine rather than outward from its own centre: the route is
        # made by the call travelling it, and a connector that appears from the middle of
        # nowhere says the opposite.
        arm_line = layer.add_shape(objects.Group())
        joint = _rounded(arm_line, 468, ROW_MID + row * ROW_PITCH - 1.5, 18, 3, line, 1.5)
        joint.size.add_keyframe(0, Point(0, 3))
        joint.size.add_keyframe(at, Point(0, 3))
        joint.size.add_keyframe(at + 12, Point(18, 3), ease)
        joint.position.add_keyframe(0, Point(468, ROW_MID + row * ROW_PITCH))
        joint.position.add_keyframe(at, Point(468, ROW_MID + row * ROW_PITCH))
        joint.position.add_keyframe(at + 12, Point(477, ROW_MID + row * ROW_PITCH), ease)
        route.append(arm_line)

        mark = marks[row]
        mark.transform.opacity.add_keyframe(0, 0)
        mark.transform.opacity.add_keyframe(at + 10, 0)
        mark.transform.opacity.add_keyframe(at + 22, 100, ease)

    # The route recedes once all three endings exist.
    #
    # Until this beat the drawing has two subjects competing for the same eye: the path the
    # call took, and where it ended up. Only the second one is what the three words beside
    # the figure mean. So the call plate, the spine and the three connectors ease back to
    # 45% and the endings hold, which is the difference between a diagram that is still
    # explaining itself and one that has finished.
    for group in route:
        group.transform.opacity.add_keyframe(SETTLED, 100)
        group.transform.opacity.add_keyframe(SETTLED + 30, 62, breath)

    # The one ending that is not over.
    #
    # `resolved` and `failed` are finished: the office has an answer, or there was nobody to
    # get one from and nothing is owed. `undetermined` is a call that reached a person and
    # came back with nothing usable, and this software will not close it. Something is still
    # owed to a child, by a named human being, and the figure said none of that: three bars
    # arrived and three bars sat there, all equally done.
    #
    # So the middle one keeps a light on. It is the same yellow the register uses for a call
    # that is still running, at the left edge of the row, breathing three times and then
    # holding. It is the last thing moving and the last thing drawn, which is the whole
    # argument of the product stated in the one place a reader is still looking.
    _dot(open_case, MARK_X, ROW_MID + ROW_PITCH, 13, live)
    open_case.transform.opacity.add_keyframe(0, 0)
    open_case.transform.opacity.add_keyframe(OPEN, 0)
    open_case.transform.opacity.add_keyframe(OPEN + 12, 100, ease)
    # Three breaths, then rest. Not an infinite loop: a figure that never stops moving is a
    # figure a reader has to look away from, and this page holds a reduced-motion promise it
    # would rather keep by not needing it.
    for beat in range(3):
        start = OPEN + 12 + beat * 36
        open_case.transform.opacity.add_keyframe(start + 18, 40, breath)
        open_case.transform.opacity.add_keyframe(start + 36, 100, breath)

    return anim


def write(out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    anim = build()
    paths = {}
    paths["lottie"] = out_dir / "three-endings.json"
    export_lottie(anim, str(paths["lottie"]))
    paths["svg"] = out_dir / "three-endings.svg"
    export_svg(anim, str(paths["svg"]), frame=DUR - 1)

    # Both exporters open in text mode, so on Windows every newline goes out as CRLF while
    # git stores and checks out LF. `--check` compares bytes, so the gate would pass on the
    # machine that generated the file and fail on every clone of it, which is a gate that
    # reports on the developer rather than on the artifact.
    for path in paths.values():
        path.write_bytes(path.read_bytes().replace(bytes([13, 10]), bytes([10])))
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(APP / "tools" / "site" / "figures"))
    parser.add_argument("--check", action="store_true",
                        help="rebuild and report drift instead of writing")
    args = parser.parse_args()

    out_dir = Path(args.out)
    if args.check:
        before = {p.name: p.read_bytes() for p in out_dir.glob("three-endings.*")}
        paths = write(out_dir)

        # Absent is not the same as changed, and this used to say it was.
        #
        # The figure is generated rather than committed, so on any checkout that has not
        # built the page there is nothing to compare against. `before` was empty, every
        # name mismatched, and this printed "changed: three-endings.json,
        # three-endings.svg" and exited 1. That is a could-not-measure published as a
        # failure, which is the one mistake this whole project is built around not making,
        # made by its own tooling. It also meant the second run of the suite on a fresh
        # clone passed where the first failed, because the first run wrote the figure as a
        # side effect of checking for it.
        #
        # Exit 3 for could-not-measure, matching `tools/double_conformance.py`.
        missing = sorted(p.name for p in paths.values() if p.name not in before)
        if missing:
            print("cannot be measured: " + ", ".join(missing)
                  + " did not exist before this run, so there was nothing to compare "
                    "against. The figure is generated, not committed. It has been written "
                    "now, so running this again compares two real builds.")
            return 3

        moved = [p.name for p in paths.values()
                 if before.get(p.name) != p.read_bytes()]
        if moved:
            print("changed: " + ", ".join(sorted(moved)))
            return 1
        print("figure is current")
        return 0

    paths = write(out_dir)
    for kind, path in paths.items():
        print(f"{kind:8s} {path.relative_to(APP)}  {path.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
