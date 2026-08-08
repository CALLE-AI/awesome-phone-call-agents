"""One-command offline demo for the ParcelBridge reference app.

This example mirrors the ``python -m parcelbridge.cli demo --offline``
CLI flow in library form so that downstream code (e.g. CI smoke
tests, notebooks, or documentation tutorials) can invoke the
offline plan-call without going through :mod:`argparse`.

Run from the package root:

    python examples/run_offline_demo.py

The example prints a structured summary to stdout. No network is
contacted; no phone number is read; no secret is logged.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow running this example from the package root without
# installing the package. The script is intentionally
# self-bootstrapping so reviewers can copy-paste-run.
_PKG_ROOT = Path(__file__).resolve().parent.parent
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from parcelbridge import (  # noqa: E402  (sys.path bootstrap above)
    run_offline_demo,
    validate_workflow,
)


def main() -> int:
    # 1. Run the default offline demo and summarise the result.
    result = run_offline_demo(scenario="gate-code-failure")

    summary = {
        "bridge_mode": result.bridge_mode,
        "outcome": result.outcome,
        "scenario": result.sanitized_response.presence.get("scenario"),
        "ready_to_run": result.sanitized_response.presence.get("ready_to_run"),
        "confirm_token_length": result.sanitized_response.fingerprints.get(
            "confirm_token"
        ),
        "plan_id_length": result.sanitized_response.fingerprints.get("plan_id"),
        "opaque_field_count": len(result.sanitized_response.opaque),
        "shape_keys": list(result.sanitized_response.raw_response_shape_keys),
    }
    print("[parcelbridge] demo summary:")
    print(json.dumps(summary, indent=2, sort_keys=True))
    print()

    # 2. Run the workflow's self-audit and print a short pass/fail.
    report = validate_workflow()
    print("[parcelbridge] validate summary:")
    print(json.dumps(report, indent=2, sort_keys=True))
    print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())