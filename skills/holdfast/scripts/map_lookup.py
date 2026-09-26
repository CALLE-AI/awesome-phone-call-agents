#!/usr/bin/env python3
"""Look up a saved IVR map by phone number or organization slug.

Stdlib-only. Prints a JSON summary on stdout.

Usage:
    python3 map_lookup.py --number "+12025550123"
    python3 map_lookup.py --company "example-airlines"
    python3 map_lookup.py --maps-dir references/ivr-maps --company example-airlines
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_MAPS_DIR = Path(__file__).resolve().parents[1] / "references" / "ivr-maps"


def load_maps(maps_dir: Path) -> list[dict]:
    maps: list[dict] = []
    if not maps_dir.is_dir():
        return maps
    for path in sorted(maps_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            maps.append(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"warning: skipping unreadable map {path.name}: {exc}", file=sys.stderr)
    return maps


def find_map(maps: list[dict], number: str | None, company: str | None) -> dict | None:
    if company:
        needle = company.strip().lower()
        for m in maps:
            org = str(m.get("organization", "")).lower()
            name = str(m.get("display_name", "")).lower()
            if needle == org or (needle and (needle in org or needle in name)):
                return m
    if number:
        digits = "".join(c for c in number if c.isdigit())
        for m in maps:
            for n in m.get("numbers", []):
                if "".join(c for c in str(n) if c.isdigit()) == digits:
                    return m
    return None


def summarize(m: dict) -> dict:
    return {
        "found": True,
        "organization": m.get("organization"),
        "display_name": m.get("display_name"),
        "locale": m.get("locale"),
        "languages": m.get("languages", []),
        "known_paths": m.get("known_paths", []),
        "hold_profile": m.get("hold_profile", {}),
        "operator_fallback": m.get("operator_fallback", {}),
        "last_verified": m.get("last_verified"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--number", help="E.164 callee number")
    parser.add_argument("--company", help="organization slug or display name")
    parser.add_argument("--maps-dir", type=Path, default=DEFAULT_MAPS_DIR)
    args = parser.parse_args()

    if not args.number and not args.company:
        parser.error("provide --number or --company")

    m = find_map(load_maps(args.maps_dir), args.number, args.company)
    print(json.dumps(summarize(m) if m else {"found": False}, indent=2))


if __name__ == "__main__":
    main()
