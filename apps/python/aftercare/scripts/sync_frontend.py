"""Copy frontend/out into static/frontend for FastAPI to serve."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_OUT = BACKEND_ROOT.parent / "frontend" / "out"
DEST = BACKEND_ROOT / "static" / "frontend"


def main() -> int:
    if not FRONTEND_OUT.is_dir():
        print(
            "Missing frontend/out. From the frontend folder run: npm run build:embed",
            file=sys.stderr,
        )
        return 1

    index = FRONTEND_OUT / "index.html"
    if not index.is_file():
        print(
            "frontend/out/index.html is missing. Rebuild with: npm run build:embed",
            file=sys.stderr,
        )
        return 1

    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.exists():
        shutil.rmtree(DEST)
    shutil.copytree(FRONTEND_OUT, DEST)
    print(f"Copied {FRONTEND_OUT} -> {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
