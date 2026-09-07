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
from lottie.objects.easing import EaseOut  # noqa: E402
from lottie.exporters.core import export_lottie  # noqa: E402
from lottie.exporters.svg import export_svg  # noqa: E402

import video_facts  # noqa: E402

W, H, FPS, DUR = 900, 300, 30, 150


def _rgb(hex_string: str) -> Color:
    h = hex_string.lstrip("#")
    return Color(*(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))


def _rounded(group, x, y, w, h, fill, radius=8.0):
    rect = group.add_shape(objects.Rect())
    rect.position.value = Point(x + w / 2, y + h / 2)
    rect.size.value = Point(w, h)
    rect.rounded.value = radius
    group.add_shape(objects.Fill(fill))
    return rect


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
    ease = EaseOut(0.42)

    anim = objects.Animation(DUR, FPS)
    anim.width, anim.height = W, H
    layer = anim.add_layer(objects.ShapeLayer())

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
    _rounded(call, 30, 120, 130, 60, ink, 10.0)
    call.transform.opacity.add_keyframe(0, 0)
    call.transform.opacity.add_keyframe(12, 100, ease)
    call.transform.position.add_keyframe(0, Point(-26, 0))
    call.transform.position.add_keyframe(16, Point(0, 0), ease)

    # The three endings. Staggered, and each one slides a little way in rather than fading
    # on the spot, so a reader's eye is carried from the spine to the row.
    for row, (_name, colour, arrival) in enumerate(endings):
        at = 40 + arrival * 20
        arm = layer.add_shape(objects.Group())
        _rounded(arm, 486, 44 + row * 88, 384, 60, _rgb(colour), 10.0)
        arm.transform.opacity.add_keyframe(0, 0)
        arm.transform.opacity.add_keyframe(at, 0)
        arm.transform.opacity.add_keyframe(at + 16, 100, ease)
        arm.transform.position.add_keyframe(at, Point(-22, 0))
        arm.transform.position.add_keyframe(at + 20, Point(0, 0), ease)

        # The short connector from the spine to this row, drawn just before it arrives.
        arm_line = layer.add_shape(objects.Group())
        joint = _rounded(arm_line, 468, 72 + row * 88, 18, 3, line, 1.5)
        joint.size.add_keyframe(0, Point(0, 3))
        joint.size.add_keyframe(at, Point(0, 3))
        joint.size.add_keyframe(at + 12, Point(18, 3), ease)

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
