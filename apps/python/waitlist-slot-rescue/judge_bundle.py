"""Generate deterministic, no-call evidence directly from the workflow engine."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import rescue


APP_ROOT = Path(__file__).resolve().parent
FIXED_NOW = datetime(2029, 1, 1, tzinfo=timezone.utc)


def generate_bundle() -> dict[str, Any]:
    request = rescue.parse_request(
        json.loads((APP_ROOT / "example_request.json").read_text(encoding="utf-8")),
        now=FIXED_NOW,
    )
    golden_fixtures = json.loads(
        (APP_ROOT / "example_results.json").read_text(encoding="utf-8")
    )
    safe_halt_fixtures = {
        "candidate-a": {
            "outcome": "unknown",
            "evidence_summary": "The response was not reliable enough to classify.",
            "classification_reason": "ambiguous-structured-result",
        }
    }

    def run(fixtures: dict[str, Any]) -> dict[str, Any]:
        return rescue.run_rescue(
            request,
            rescue.FixtureTransport(fixtures),
            simulated=True,
            now=lambda: FIXED_NOW,
        )

    return {
        "artifact": "waitlist-slot-rescue-judge-bundle",
        "schema_version": 1,
        "generated_by": "judge_bundle.py -> rescue.run_rescue",
        "fixture_data": True,
        "creates_phone_calls": False,
        "scenarios": {
            "golden": run(golden_fixtures),
            "safe_halt": run(safe_halt_fixtures),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate deterministic judge evidence without placing calls."
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    rendered = json.dumps(generate_bundle(), indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
