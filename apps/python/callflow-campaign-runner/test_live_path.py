"""End-to-end verification of the live path with an injected fake client.

Places no real calls and needs no credentials. Unit tests cover each guard in
isolation; this exercises the whole loop, which is where the interactions live —
a duplicate CSV row slipped past isolated reservation tests because the first
call had already resolved by the time the second row was read.

Run:  python test_live_path.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import runner

FAILURES: list[str] = []


def check(label: str, condition: bool) -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        FAILURES.append(label)


class FakeCalls:
    """Stands in for `client.calls`, recording what would have been sent."""

    def __init__(self, outcome: str) -> None:
        self.outcome = outcome
        self.created: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> dict[str, Any]:
        self.created.append(kwargs)
        if self.outcome == "raise":
            # Shaped like a real provider error: echoes the destination and a
            # credential, which is exactly what must not be stored.
            raise RuntimeError(
                "422 for +1 555-555-0100 Authorization: Bearer sk_live_abcdefghijklmnop"
            )
        return {"id": "call_fake_1", "status": "queued"}

    def get(self, call_id: str) -> dict[str, Any]:
        if self.outcome == "clean":
            return {
                "id": call_id,
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {"score": 0.91},
                "structured_result": {
                    "outcome": "interested",
                    "sentiment": "positive",
                    # Quotes a number back, as a real summary can.
                    "summary": "Wants Bali; asked us to call 555-555-0100.",
                    "frustration_signals": False,
                    "wants_human_callback": False,
                    "do_not_call": False,
                    "callback_agreed": False,
                    "destination": "Bali",
                    "travel_date": "2026-12-18",
                    "party_size": 2,
                },
            }
        if self.outcome == "dnc":
            return {
                "id": call_id,
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {"score": 0.95},
                "structured_result": {
                    "outcome": "not_interested",
                    "sentiment": "negative",
                    "summary": "Asked never to be contacted again.",
                    "frustration_signals": False,
                    "wants_human_callback": False,
                    "do_not_call": True,
                    "callback_agreed": False,
                },
            }
        return {"id": call_id, "status": "failed"}


class FakeClient:
    def __init__(self, outcome: str) -> None:
        self.calls = FakeCalls(outcome)


def run_case(
    label: str, outcome: str, csv_text: str, tmp: str, **overrides: Any
) -> tuple[list[dict[str, Any]], argparse.Namespace, FakeClient]:
    csv_path = Path(tmp) / f"{label}.csv"
    csv_path.write_text(csv_text, encoding="utf-8")

    args = argparse.Namespace(
        campaign="travel",
        contacts=str(csv_path),
        live=True,
        allow="+15555550100,+15555550101",
        i_know_what_im_doing=False,
        max_calls=9,
        country_code="",
        poll_interval=0.01,
        timeout=5,
        out=str(Path(tmp) / f"{label}_out.jsonl"),
        batch_id="b1",
        suppression_file=str(Path(tmp) / "dnc.txt"),
        dispatch_file=str(Path(tmp) / "ledger.txt"),
        region="",
        locale="",
        list_campaigns=False,
    )
    for key, value in overrides.items():
        setattr(args, key, value)

    fake = FakeClient(outcome)
    original = runner.CalleClient
    runner.CalleClient = lambda **_: fake  # type: ignore[assignment]
    os.environ["CALLE_API_KEY"] = "fake-key-never-used"
    try:
        runner.run(args)
    finally:
        runner.CalleClient = original  # type: ignore[assignment]

    lines = [
        json.loads(line)
        for line in Path(args.out).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return lines, args, fake


ONE_ROW = "name,phone,note\nAditi,+15555550100,Bali\n"
DUPLICATE_ROWS = (
    "name,phone,note\n"
    "Aditi,+15555550100,Bali\n"
    "Aditi Sharma,+15555550100,a different note entirely\n"
)


print("\nA completed call, start to finish")
with tempfile.TemporaryDirectory() as tmp:
    lines, args, fake = run_case("clean", "clean", ONE_ROW, tmp)
    check("exactly one call created", len(fake.calls.created) == 1)
    check("auto-closed", lines[0]["disposition"] == "auto_closed")
    check("provider call id recorded", lines[0]["call_id"] == "call_fake_1")
    check(
        "the number the contact spoke is redacted from the stored summary",
        "5555550100" not in json.dumps(lines[0]).replace("-", ""),
    )
    ledger = runner.load_reservations(args.dispatch_file)
    check(
        "reservation closed with the provider status",
        ledger[runner._hash_phone("+15555550100")]["state"] == "resolved:completed",
    )

print("\nThe same number twice in one file")
with tempfile.TemporaryDirectory() as tmp:
    lines, args, fake = run_case("dup", "clean", DUPLICATE_ROWS, tmp)
    # The rows differ in name and note, so they produce different content keys.
    # The person is the same, so only one call may be placed.
    check(
        f"only one call placed for the duplicate number (got {len(fake.calls.created)})",
        len(fake.calls.created) == 1,
    )
    check("the duplicate row is skipped", lines[1]["disposition"] == "skipped")
    check("the reason names the duplication", "already appears" in lines[1]["reason"])

print("\nAn opt-out mid-run")
with tempfile.TemporaryDirectory() as tmp:
    lines, args, fake = run_case("dnc", "dnc", DUPLICATE_ROWS, tmp)
    check("opt-out written to disk", len(runner.load_suppressions(args.suppression_file)) == 1)
    check("the opting-out call escalates", lines[0]["disposition"] == "needs_human")
    check(
        f"the later row for that number is not called (got {len(fake.calls.created)})",
        len(fake.calls.created) == 1,
    )

print("\nA provider error")
with tempfile.TemporaryDirectory() as tmp:
    lines, args, fake = run_case("err", "raise", ONE_ROW, tmp)
    stored = json.dumps(lines[0])
    check("escalated rather than marked unreachable", lines[0]["disposition"] == "needs_human")
    check("destination number stripped", "5555550100" not in stored.replace("-", ""))
    check("credential stripped", "sk_live_abcdefghijklmnop" not in stored)
    ledger = runner.load_reservations(args.dispatch_file)
    check(
        "the reservation stays open, so the number is not silently re-dialled",
        not ledger[runner._hash_phone("+15555550100")]["state"].startswith("resolved"),
    )

print("\nRegion and locale are never invented")
with tempfile.TemporaryDirectory() as tmp:
    _, _, fake = run_case("noloc", "clean", ONE_ROW, tmp)
    recipient = fake.calls.created[0]["recipient"]
    check("region omitted when not stated", "region" not in recipient)
    check("locale omitted when not stated", "locale" not in recipient)

    _, _, fake = run_case("withloc", "clean", ONE_ROW, tmp, region="US", locale="en")
    recipient = fake.calls.created[0]["recipient"]
    check("region sent when stated", recipient.get("region") == "US")
    check("locale sent when stated", recipient.get("locale") == "en")

print()
if FAILURES:
    print(f"{len(FAILURES)} check(s) failed:")
    for failure in FAILURES:
        print(f"  - {failure}")
    sys.exit(1)

print("Live path verified. No calls were placed.")
