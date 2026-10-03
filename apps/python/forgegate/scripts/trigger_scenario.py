"""Demo convenience: POST a scenario JSON file to a running ForgeGate server.

Usage:
    python scripts/trigger_scenario.py high_risk
    python scripts/trigger_scenario.py low_risk
    python scripts/trigger_scenario.py scenarios/high_risk.json --url http://localhost:8000
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

SCENARIOS_DIR = Path(__file__).resolve().parents[1] / "scenarios"


def resolve_scenario_path(name: str) -> Path:
    candidate = Path(name)
    if candidate.exists():
        return candidate
    candidate = SCENARIOS_DIR / f"{name}.json"
    if candidate.exists():
        return candidate
    candidate = SCENARIOS_DIR / name
    if candidate.exists():
        return candidate
    raise FileNotFoundError(f"Could not find scenario '{name}' in {SCENARIOS_DIR}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", help="scenario name (high_risk / low_risk) or path to a JSON file")
    parser.add_argument("--url", default="http://localhost:8000", help="ForgeGate base URL")
    args = parser.parse_args()

    path = resolve_scenario_path(args.scenario)
    payload = json.loads(path.read_text(encoding="utf-8"))

    print(f"POST {args.url}/incident  <-  {path}")
    response = requests.post(f"{args.url}/incident", json=payload, timeout=200)
    print(f"status: {response.status_code}")
    print(json.dumps(response.json(), indent=2))
    return 0 if response.ok else 1


if __name__ == "__main__":
    sys.exit(main())
