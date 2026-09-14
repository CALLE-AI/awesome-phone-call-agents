"""Count edge pixels in every pose `frame-sweep.mjs` photographed.

The ground is read off the corner of each shot rather than assumed, because the canvas is
transparent and what sits behind it is the page's own paper. A pose with any ink in the
outer band is a pose a reader can drag the board out of the frame in.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

BAND = 3
TOL = 8


def edge_ink(path: Path) -> dict[str, int]:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    ground = px[0, 0]

    def ink(x: int, y: int) -> bool:
        p = px[x, y]
        return max(abs(p[i] - ground[i]) for i in range(3)) > TOL

    return {
        "top": sum(ink(x, b) for b in range(BAND) for x in range(w)),
        "bottom": sum(ink(x, h - 1 - b) for b in range(BAND) for x in range(w)),
        "left": sum(ink(b, y) for b in range(BAND) for y in range(h)),
        "right": sum(ink(w - 1 - b, y) for b in range(BAND) for y in range(h)),
    }


def main() -> int:
    shots = sorted(Path(sys.argv[1]).glob("*.png"))
    if not shots:
        print("no shots to read")
        return 1
    bad = []
    for shot in shots:
        hit = edge_ink(shot)
        if any(hit.values()):
            bad.append((shot.stem, hit))
    print(f"{len(shots)} poses read")
    for stem, hit in bad[:25]:
        print(f"  CLIPS  {stem}  t/b/l/r {hit['top']}/{hit['bottom']}/{hit['left']}/{hit['right']}")
    if len(bad) > 25:
        print(f"  ... and {len(bad) - 25} more")
    print(f"{len(bad)} of {len(shots)} poses put ink on the canvas edge")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
