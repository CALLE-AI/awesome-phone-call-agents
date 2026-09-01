"""Command line entry point. Dry run is the default and live needs three keys turned.

    python3 -m warrantyops --scenario case_a_success
    python3 -m warrantyops --list

Nothing in this module can place a call: it only ever constructs the fake
provider. Live calling is deliberately not wired to a flag, because a flag is
the wrong place for a decision that dials a stranger. See
``docs/warranty-recovery/README.md`` for how a live run is authorized.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .authorization import AuthorizationBasis, CallAuthorization
from .providers.fake import FIXTURE_DIR, FakeCallProvider
from .workflow import CaseInput, masked_report, run_case

PURPOSE = "warranty exception resolution"


def _synthetic_authorization(recipient_e164: str, now: datetime) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=recipient_e164,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="synthetic-fixture-owner",
        granted_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )


def _synthetic_case(scenario: str) -> CaseInput:
    return CaseInput(
        case_reference=f"CASE-{scenario.upper().replace('_', '-')}",
        asset_description="rooftop packaged unit, synthetic fixture asset",
        failure_description="compressor will not start, synthetic fixture failure",
        prior_channel_outcome="the online portal has no record of this serial",
        caller_organization="Example Field Services",
    )


def _scenarios(fixture_dir: Path) -> list[str]:
    return sorted(path.stem for path in fixture_dir.glob("*.json"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="warrantyops", description=__doc__)
    parser.add_argument("--scenario", help="synthetic scenario to replay")
    parser.add_argument(
        "--fixture-dir", type=Path, default=FIXTURE_DIR, help="where fixtures live"
    )
    parser.add_argument("--list", action="store_true", help="list scenarios and exit")
    args = parser.parse_args(argv)

    if args.list or not args.scenario:
        for name in _scenarios(args.fixture_dir):
            print(name)
        return 0

    provider = FakeCallProvider(scenario=args.scenario, fixture_dir=args.fixture_dir)
    fixture = provider.load()
    now = datetime.now(timezone.utc)
    authorization = _synthetic_authorization(fixture["recipient_e164"], now)
    outcome = run_case(
        _synthetic_case(args.scenario),
        authorization,
        provider,
        now=now,
        allowlist=frozenset({fixture["recipient_e164"]}),
    )
    report = masked_report(outcome, authorization.recipient_e164)
    report["provider"] = provider.name
    report["real_calls_placed"] = provider.calls_placed
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
