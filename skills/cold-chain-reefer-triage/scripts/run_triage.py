#!/usr/bin/env python3
"""
CLI runner for Cold Chain Reefer Triage Agent Skill.

Usage:
  # Default: Dry-run preview (no live call, no credentials required)
  python scripts/run_triage.py --phone +12065550198

  # Authorized live call (requires CALLE_API_KEY)
  python scripts/run_triage.py --phone +12065550198 --live
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Ensure local module directory is in sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))

from triage import (
    initiate_reefer_triage,
    mask_phone,
    validate_calle_base_url,
    validate_e164_phone,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("run_triage")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Cold Chain Reefer Triage — Standalone Telephony Skill Runner"
    )
    parser.add_argument(
        "--phone",
        type=str,
        default="+12065550198",
        help="Driver phone number in strict E.164 format (e.g. +12065550198)",
    )
    parser.add_argument(
        "--driver-name",
        type=str,
        default="Marcus Vance",
        help="Commercial driver full name",
    )
    parser.add_argument(
        "--truck-id",
        type=str,
        default="TRK-902",
        help="Commercial tractor/truck ID",
    )
    parser.add_argument(
        "--trailer-id",
        type=str,
        default="TRL-8841",
        help="Refrigerated trailer ID",
    )
    parser.add_argument(
        "--current-temp",
        type=float,
        default=39.5,
        help="Current sensor temperature in Fahrenheit",
    )
    parser.add_argument(
        "--setpoint-temp",
        type=float,
        default=34.0,
        help="Reefer setpoint temperature in Fahrenheit",
    )
    parser.add_argument(
        "--cold-hub",
        type=str,
        default="Lincoln Cold Logistics",
        help="Nearest emergency cold storage facility name",
    )
    parser.add_argument(
        "--cold-hub-eta",
        type=int,
        default=18,
        help="Driving ETA to cold hub in minutes",
    )
    parser.add_argument(
        "--commodity",
        type=str,
        default="Produce",
        help="Cargo commodity description",
    )
    parser.add_argument(
        "--live",
        "--authorize-live-call",
        dest="live",
        action="store_true",
        default=False,
        help="Explicitly authorize a live outbound telephone call via CALL-E API (default: dry-run)",
    )

    args = parser.parse_args()

    # Pre-flight E.164 validation
    if not validate_e164_phone(args.phone):
        masked = mask_phone(args.phone)
        logger.error("Invalid E.164 destination number: %s. Telephony aborted.", masked)
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": f"Invalid E.164 phone number format: {masked}",
                },
                indent=2,
            )
        )
        return 1

    client = None
    if args.live:
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            logger.error("CALLE_API_KEY environment variable is required for live authorized calls.")
            return 1
        base_url = validate_calle_base_url(os.environ.get("CALLE_BASE_URL"))
        try:
            from calle import CalleClient
            client = CalleClient(api_key=api_key, base_url=base_url)
        except ImportError:
            logger.error("calle-ai package is not installed. Install with: pip install calle-ai")
            return 1
    else:
        logger.info("[DRY-RUN] Executing simulated triage without outbound network calls.")

    # Execute triage
    result = initiate_reefer_triage(
        driver_phone=args.phone,
        driver_name=args.driver_name,
        truck_id=args.truck_id,
        trailer_id=args.trailer_id,
        current_temp_f=args.current_temp,
        setpoint_temp_f=args.setpoint_temp,
        nearest_cold_hub_name=args.cold_hub,
        nearest_cold_hub_eta_minutes=args.cold_hub_eta,
        commodity_type=args.commodity,
        client=client,
        live=args.live,
    )

    # Print structured result as clean JSON with masked logging
    print("\n=== TRIAGE RESULT ===")
    print(json.dumps(result.model_dump(), indent=2))

    return 0 if result.status in ("completed", "simulated") else 1


if __name__ == "__main__":
    sys.exit(main())
