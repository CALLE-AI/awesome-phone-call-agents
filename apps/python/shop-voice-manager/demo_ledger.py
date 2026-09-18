#!/usr/bin/env python3
"""Build a ledger from the demo fixtures, using the real store and ingest path.

This file only supplies the *input* — it loads fixture call results instead of
calling CALL-E. Every row it writes goes through `ingest.ingest_call`, the same
function the live client will use, so the demo cannot drift away from
production behaviour.

    python3 demo_ledger.py --out shop.db

Refs #28.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import ingest
import store

APP_ROOT = Path(__file__).resolve().parent
FIXTURES = APP_ROOT / "fixtures"

# Re-exported so tests and callers have one name for the gate.
CONFIDENCE_THRESHOLD = ingest.CONFIDENCE_THRESHOLD

PROFILES = ("shop-profile.json", "shop-profile-india.json")


def fixture_paths(include_edge_cases: bool = False) -> list[Path]:
    paths = sorted((FIXTURES / "calls").glob("*.json"))
    if include_edge_cases:
        paths += sorted((FIXTURES / "edge-cases").glob("*.json"))
    return paths


def build(out_path: Path, include_edge_cases: bool = False) -> Path:
    out_path = Path(out_path)
    if out_path.exists():
        out_path.unlink()

    conn = store.connect(out_path)
    store.initialize(conn)
    try:
        with conn:
            for name in PROFILES:
                path = FIXTURES / name
                if not path.is_file():
                    continue
                profile = json.loads(path.read_text(encoding="utf-8"))
                store.upsert_shop(conn, profile)
                store.seed_products(conn, profile)

        ingest.ingest_files(conn, fixture_paths(include_edge_cases))
    finally:
        conn.close()
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a SQLite ledger from the demo fixtures")
    parser.add_argument("--out", type=Path, default=Path("shop-fixture.db"))
    parser.add_argument("--include-edge-cases", action="store_true")
    parser.add_argument("--verbose", action="store_true", help="Show the verdict for each call")
    args = parser.parse_args()

    if args.verbose:
        path = Path(args.out)
        if path.exists():
            path.unlink()
        conn = store.connect(path)
        store.initialize(conn)
        with conn:
            for name in PROFILES:
                p = FIXTURES / name
                if p.is_file():
                    profile = json.loads(p.read_text(encoding="utf-8"))
                    store.upsert_shop(conn, profile)
                    store.seed_products(conn, profile)
        for result in ingest.ingest_files(conn, fixture_paths(args.include_edge_cases)):
            print(" ", result)
        conn.close()
    else:
        build(args.out, args.include_edge_cases)

    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
