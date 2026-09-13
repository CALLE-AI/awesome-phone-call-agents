#!/usr/bin/env python3
"""Merge one call's IVR observations into an IVR map file.

Stdlib-only. Maps describe phone trees, never callers: any observation key
outside the allowlist is rejected so transcripts and personal data cannot
leak into the library.

Usage:
    python3 map_update.py --company example-airlines --observation obs.json
    cat obs.json | python3 map_update.py --company example-airlines --observation -

Observation JSON shape:
    {
      "goal": "claim status",                       optional
      "observed_path": [                            optional
        {"prompt_summary": "main menu", "keypress": "2", "meaning": "existing claim"}
      ],
      "hold_seconds": 210,                          optional, int >= 0
      "reached": "human",                           optional: human|automated|none
      "number": "+12025550123",                     optional, adds to known numbers
      "date": "2026-09-11"                          optional, defaults to today (UTC)
    }
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

DEFAULT_MAPS_DIR = Path(__file__).resolve().parents[1] / "references" / "ivr-maps"

ALLOWED_OBSERVATION_KEYS = {"goal", "observed_path", "hold_seconds", "reached", "number", "date"}
ALLOWED_STEP_KEYS = {"prompt_summary", "keypress", "meaning"}
ALLOWED_REACHED = {"human", "automated", "none"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def new_map(company: str) -> dict:
    return {
        "schema_version": "1.0",
        "organization": company,
        "display_name": company.replace("-", " ").title(),
        "numbers": [],
        "locale": None,
        "languages": [],
        "known_paths": [],
        "hold_profile": {"typical_seconds": None, "max_observed_seconds": None, "best_time_local": None},
        "operator_fallback": {"keypress": "0", "authorized": False},
        "notes": [],
        "last_verified": None,
        "contributions": [],
    }


def load_observation(source: str) -> dict:
    raw = sys.stdin.read() if source == "-" else Path(source).read_text(encoding="utf-8")
    try:
        obs = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"observation is not valid JSON: {exc}")
    if not isinstance(obs, dict):
        fail("observation must be a JSON object")
    extra = set(obs) - ALLOWED_OBSERVATION_KEYS
    if extra:
        fail(f"observation contains disallowed keys {sorted(extra)}; maps never store caller data")
    for step in obs.get("observed_path", []):
        if not isinstance(step, dict) or not set(step) <= ALLOWED_STEP_KEYS:
            fail("each observed_path step may only use prompt_summary, keypress, meaning")
    if "hold_seconds" in obs and (not isinstance(obs["hold_seconds"], int) or obs["hold_seconds"] < 0):
        fail("hold_seconds must be a non-negative integer")
    if "reached" in obs and obs["reached"] not in ALLOWED_REACHED:
        fail(f"reached must be one of {sorted(ALLOWED_REACHED)}")
    return obs


def update_path(m: dict, obs: dict) -> str:
    path = obs.get("observed_path")
    if not path:
        return "no path observed"
    goal = obs.get("goal") or "general"
    today = obs.get("date") or date.today().isoformat()
    for entry in m["known_paths"]:
        if entry.get("goal") == goal:
            if entry.get("path") == path:
                entry["observations"] = entry.get("observations", 1) + 1
                entry["last_observed"] = today
                entry["confidence"] = "observed"
                return "path confirmed"
            entry["confidence"] = "stale"
    m["known_paths"].append(
        {"goal": goal, "path": path, "confidence": "observed", "observations": 1, "last_observed": today}
    )
    return "path recorded"


def update_hold(m: dict, obs: dict) -> None:
    hold = obs.get("hold_seconds")
    if hold is None:
        return
    profile = m["hold_profile"]
    current_n = sum(p.get("observations", 1) for p in m["known_paths"]) or 1
    if profile["typical_seconds"] is None:
        profile["typical_seconds"] = hold
    else:
        profile["typical_seconds"] = round((profile["typical_seconds"] * (current_n - 1) + hold) / current_n)
    if profile["max_observed_seconds"] is None or hold > profile["max_observed_seconds"]:
        profile["max_observed_seconds"] = hold


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--company", required=True, help="organization slug (map file name)")
    parser.add_argument("--observation", required=True, help="observation JSON file, or - for stdin")
    parser.add_argument("--maps-dir", type=Path, default=DEFAULT_MAPS_DIR)
    args = parser.parse_args()

    if not args.company.replace("-", "").isalnum() or args.company != args.company.lower():
        fail("--company must be a lowercase slug such as example-airlines")

    obs = load_observation(args.observation)
    today = obs.get("date") or date.today().isoformat()

    args.maps_dir.mkdir(parents=True, exist_ok=True)
    map_path = args.maps_dir / f"{args.company}.json"
    if map_path.exists():
        m = json.loads(map_path.read_text(encoding="utf-8"))
    else:
        m = new_map(args.company)

    if obs.get("number") and obs["number"] not in m["numbers"]:
        m["numbers"].append(obs["number"])

    path_result = update_path(m, obs)
    update_hold(m, obs)
    m["last_verified"] = today
    if not any(c.get("date") == today for c in m["contributions"]):
        m["contributions"].append({"date": today, "source": "holdfast-skill"})

    map_path.write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"map": str(map_path), "result": path_result, "last_verified": today}, indent=2))


if __name__ == "__main__":
    main()
