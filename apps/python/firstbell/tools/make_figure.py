"""The three endings, drawn as an animation, from one source that feeds three surfaces.

A blind seat reading this entry as a school district administrator scored the page 16 of 25
and rated its reading fatigue 9 out of 10. Among the things they could not follow were the
three words the whole product turns on, `resolved`, `undetermined` and `failed`, which the
page states as a table column and never shows.

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
    """One call leaving, and the only three states it can come back in."""
    palette = video_facts.palette()
    ink = _rgb(palette["ink"])
    line = _rgb(palette["line-strong"])
    endings = [
        ("resolved", palette["resolved"]),
        ("undetermined", palette["undetermined"]),
        ("failed", palette["failed"]),
    ]

    anim = objects.Animation(DUR, FPS)
    anim.width, anim.height = W, H
    layer = anim.add_layer(objects.ShapeLayer())

    # The spine. Drawn first so everything else sits on it.
    spine = layer.add_shape(objects.Group())
    _rounded(spine, 150, 148, 300, 4, line, 2.0)

    # The call leaving, one plate on the left.
    call = layer.add_shape(objects.Group())
    _rounded(call, 30, 120, 120, 60, ink, 10.0)

    # The three endings, stacked, each in the ink the page uses for that word and nowhere
    # else. A reader who meets the word later has already been shown which one it is.
    for i, (_name, colour) in enumerate(endings):
        arm = layer.add_shape(objects.Group())
        _rounded(arm, 470, 44 + i * 88, 380, 60, _rgb(colour), 10.0)
        arm.transform.opacity.add_keyframe(0, 0)
        arm.transform.opacity.add_keyframe(40 + i * 18, 0)
        arm.transform.opacity.add_keyframe(58 + i * 18, 100)

    return anim


def write(out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    anim = build()
    paths = {}
    paths["lottie"] = out_dir / "three-endings.json"
    export_lottie(anim, str(paths["lottie"]))
    paths["svg"] = out_dir / "three-endings.svg"
    export_svg(anim, str(paths["svg"]), frame=DUR - 1)
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
