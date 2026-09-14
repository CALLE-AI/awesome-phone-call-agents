#!/usr/bin/env python3
"""Dry-run demonstration of the SmartRent maintenance workflow.

Runs the full 3-call workflow in dry-run mode (no real calls)
and prints structured results at each step.
"""

import asyncio
import json
import sys
import os
from pathlib import Path

# Add project/app root to path
current = Path(__file__).resolve()
candidate_roots = [
    current.parents[3] / "apps" / "python" / "smartrent-maintenance",  # Monorepo layout
    current.parents[3],  # Standalone layout
    current.parents[2],
]
for candidate in candidate_roots:
    if (candidate / "app").is_dir():
        if str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))
        break

from app.config import CalleConfig
from app.calle_client import CalleService
from app.models import MaintenanceRequest
from app.workflows import MaintenanceWorkflow


def print_section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")


async def main():
    # Force dry-run mode
    config = CalleConfig(dry_run=True)
    service = CalleService(config)
    workflow = MaintenanceWorkflow(service)

    # Create a sample request
    request = MaintenanceRequest(
        tenant_name="John Smith",
        tenant_phone="+15551234567",
        unit_number="4B",
        property_name="SmartRent Demo Property",
        initial_description="Kitchen sink is leaking under the cabinet",
    )

    print_section("SmartRent Maintenance Coordinator — Dry Run Demo")
    print(f"Request ID: {request.id}")
    print(f"Tenant: {request.tenant_name} ({request.tenant_phone})")
    print(f"Unit: {request.unit_number} @ {request.property_name}")
    print(f"Description: {request.initial_description}")

    # Step 1: Tenant Intake
    print_section("STEP 1: Tenant Intake Call")
    request = await workflow.step_tenant_intake(request)
    print(f"State: {request.state.value}")
    print(f"Issue Type: {request.issue_type.value}")
    print(f"Urgency: {request.urgency.value}")
    print(f"Location: {request.location_in_unit}")
    print(f"Access: {request.access_instructions}")

    call = request.calls[-1]
    print(f"\nCall Status: {call.status.value}")
    print(f"Confidence: {call.confidence_score} ({call.confidence_label})")
    print(f"\nEvidence:")
    for e in call.evidence:
        print(f"  ✓ {e}")

    print(f"\nTranscript ({len(call.transcript)} turns):")
    for turn in call.transcript:
        speaker = "🤖 AI" if turn["speaker"] == "bot" else "👤 Tenant"
        print(f"  {speaker}: {turn['text']}")

    # Step 2: Vendor Dispatch
    print_section("STEP 2: Vendor Dispatch Call")
    request = await workflow.step_vendor_dispatch(request)
    print(f"State: {request.state.value}")
    print(f"Vendor: {request.assigned_vendor.name}")
    print(f"ETA: {request.vendor_eta}")
    print(f"Cost: {request.vendor_cost_estimate}")

    call = request.calls[-1]
    print(f"\nEvidence:")
    for e in call.evidence:
        print(f"  ✓ {e}")

    # Step 3: Tenant Confirmation
    print_section("STEP 3: Tenant Confirmation Call")
    request = await workflow.step_tenant_confirm(request)
    print(f"State: {request.state.value}")
    print(f"Confirmed: {request.tenant_confirmed}")

    # Summary
    print_section("WORKFLOW COMPLETE")
    print(f"Final State: {request.state.value}")
    print(f"Total Calls: {len(request.calls)}")
    print(f"Timeline Events: {len(request.timeline)}")
    print(f"\nTimeline:")
    for evt in request.timeline:
        print(f"  [{evt['timestamp'][:19]}] {evt['event']}: {evt['details']}")

    print(f"\n{'='*60}")
    print("  ✅ Dry-run complete — no real calls were placed.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
