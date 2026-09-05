#!/usr/bin/env python3
"""Standalone validator script for CALL-E hotel negotiation results."""

import json
import sys
from typing import Any


def validate_offer(payload: dict[str, Any], budget_cap: float = 50000.0) -> bool:
    """Validates raw output from CALL-E against business constraints."""
    if not isinstance(payload, dict):
        print("Error: Payload must be a dictionary.")
        return False

    availability = payload.get("availability")
    if availability not in ("available", "unavailable", "unknown"):
        print(f"Error: Invalid availability '{availability}'")
        return False

    if availability == "available":
        total_price = payload.get("total_price")
        nego_price = payload.get("negotiated_total") or total_price

        if nego_price is not None and nego_price > budget_cap:
            print(f"Warning: Negotiated price ({nego_price}) exceeds budget cap ({budget_cap})")

        orig_price = payload.get("original_total")
        if orig_price is not None and nego_price is not None and nego_price > orig_price:
            print("Error: Negotiated price cannot be greater than original price.")
            return False

    print("Offer structure successfully validated!")
    return True


if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            data = json.load(f)
        valid = validate_offer(data)
        sys.exit(0 if valid else 1)
    else:
        sample = {
            "availability": "available",
            "original_total": 45000.0,
            "negotiated_total": 41000.0,
            "currency": "INR",
            "breakfast_included": True,
            "free_cancellation": True,
        }
        valid = validate_offer(sample)
        sys.exit(0 if valid else 1)
