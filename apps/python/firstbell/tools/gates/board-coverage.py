"""How much of its own canvas the board's ink actually occupies, per shot.

Reads the PNGs `frame-sweep.mjs` writes. Coverage is the ink bounding box against the
canvas box, which is the number that answers "the board looks small": a board framed for a
pose it is not in fills a fraction of the frame at rest. Tolerance 30 so the contact
shadow, which is meant to bleed, is not counted as board.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

TOL = 30


def coverage(path: Path) -> tuple[int, int, int, int]:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    ground = px[0, 0]
    lo_x, hi_x, lo_y, hi_y = w, -1, h, -1
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if max(abs(p[i] - ground[i]) for i in range(3)) > TOL:
                lo_x = min(lo_x, x); hi_x = max(hi_x, x)
                lo_y = min(lo_y, y); hi_y = max(hi_y, y)
    if hi_x < 0:
        return w, h, 0, 0
    return w, h, hi_x - lo_x + 1, hi_y - lo_y + 1


def main() -> int:
    for shot in sorted(Path(sys.argv[1]).glob(sys.argv[2] if len(sys.argv) > 2 else "*.png")):
        cw, ch, iw, ih = coverage(shot)
        print(f"{shot.stem:34} canvas {cw}x{ch}  ink {iw}x{ih}  "
              f"fills {iw / cw * 100:4.1f}% wide, {ih / ch * 100:4.1f}% tall")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
