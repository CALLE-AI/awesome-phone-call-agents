"""
calle_trigger.py

Takes a fall_detected event from fall_detector.py and places a real
phone call to the caregiver via CALL-E, using CALL-E's Python SDK.

Safety design (matches this repo's safety.md / deployment-approval-call
pattern):

  - CALL-E does NOT autonomously call emergency services.
  - CALL-E calls the caregiver, describes what was detected, and asks
    for a spoken decision: dismiss (false alarm) or escalate.
  - If the caregiver says "escalate," Watchtower places a SECOND call -
    still to a human (the caregiver or a configured secondary contact),
    never directly to 911/emergency services - so a real person always
    makes the final call to emergency services themselves.
  - All phone numbers below are placeholders. Replace with your own
    configured, consented numbers - never hardcode a real number in
    committed example code.

Install:
    pip install calle-ai --break-system-packages

Setup:
    export CALLE_API_KEY="calle_live_key"
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Literal, Optional

from calle import CalleClient

# Placeholder / fictional numbers only - see CONTRIBUTING.md safety rules.
CAREGIVER_PHONE = os.environ.get("CAREGIVER_PHONE", "")
SECONDARY_CONTACT_PHONE = os.environ.get("SECONDARY_CONTACT_PHONE", "")

Decision = Literal["dismiss", "escalate", "unknown"]


@dataclass
class FallEvent:
    event: str
    timestamp: str
    confidence: float
    room: str


def _client() -> CalleClient:
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "CALLE_API_KEY is not set. Run `export CALLE_API_KEY=your_key` first."
        )
    return CalleClient(api_key=api_key)


def call_caregiver(event: FallEvent, max_retries: int = 3) -> Decision:
    """
    Places the primary alert call to the caregiver and returns their
    spoken decision. This is the human-in-the-loop step - CALL-E never
    proceeds past this without an explicit decision from a person.

    Wrapped with retries: CALL-E places the call immediately, then
    polls its API for the final result. A transient network hiccup
    during that polling step (CalleTimeoutError) does NOT mean the call
    failed - the call itself may have completed fine on CALL-E's side.
    We retry fetching the result rather than treating this as a hard
    failure, and only fall back to "unknown" (safe default: escalate)
    if every retry is exhausted.
    """
    client = _client()

    task = (
        f"Call {CAREGIVER_PHONE}. Identify yourself as Watchtower, a home "
        f"safety monitoring assistant. Tell them: 'A possible fall was "
        f"detected in the {event.room.replace('_', ' ')} at "
        f"{event.timestamp}.' Ask them to make a decision: should this be "
        f"dismissed as a false alarm, or should it be escalated? Wait for "
        f"a clear verbal decision before ending the call. Do not take any "
        f"action beyond recording their decision."
    )

    last_error: Optional[Exception] = None

    for attempt in range(1, max_retries + 1):
        try:
            call = client.calls.create_and_wait(
                task=task,
                result_schema={
                    "type": "object",
                    "required": ["decision"],
                    "properties": {
                        "decision": {
                            "type": "string",
                            "enum": ["dismiss", "escalate", "unknown"],
                        }
                    },
                },
            )

            print("Caregiver call status:", call["status"])
            print("Task completed:", call["task_completed"])
            print("Structured result:", call["structured_result"])

            decision = call["structured_result"].get("decision", "unknown")
            return decision  # type: ignore[return-value]

        except Exception as exc:  # calle.errors.CalleTimeoutError and friends
            last_error = exc
            print(
                f"[Watchtower] CALL-E request failed on attempt "
                f"{attempt}/{max_retries}: {exc}"
            )
            time.sleep(2 * attempt)  # simple backoff before retrying

    print(
        f"[Watchtower] All {max_retries} attempts failed "
        f"({last_error}). Treating as 'unknown' - will escalate as a "
        f"safe default."
    )
    return "unknown"


def call_secondary_contact_for_escalation(event: FallEvent) -> None:
    """
    Places a SECOND call - still to a human, not to emergency services
    directly. This surfaces the escalation to a person who can then make
    the real emergency call themselves, per this repo's safety rules
    around treating emergency workflows as logistics-only and requiring
    explicit human approval before anything irreversible happens.
    """
    client = _client()

    task = (
        f"Call {SECONDARY_CONTACT_PHONE}. Identify yourself as Watchtower, "
        f"a home safety monitoring assistant. Tell them: 'A fall was "
        f"detected in the {event.room.replace('_', ' ')} at "
        f"{event.timestamp}, and the primary caregiver has escalated this. "
        f"Please check on the resident now, and call emergency services "
        f"yourself if needed.' Confirm they received and understood the "
        f"message before ending the call."
    )

    call = client.calls.create_and_wait(task=task)

    print("Escalation call status:", call["status"])
    print("Task completed:", call["task_completed"])


def handle_fall_event(event_dict: dict) -> Decision:
    """
    Entry point called by watchtower_main.py for each fall event.
    Orchestrates: alert call -> decision -> optional escalation call.
    """
    event = FallEvent(**event_dict)

    print(f"\n[Watchtower] Fall detected in {event.room} at {event.timestamp} "
          f"(confidence={event.confidence}). Calling caregiver...")

    decision = call_caregiver(event)

    if decision == "escalate":
        print("[Watchtower] Caregiver escalated. Calling secondary contact...")
        call_secondary_contact_for_escalation(event)
    elif decision == "dismiss":
        print("[Watchtower] Caregiver dismissed as false alarm. No further action.")
    else:
        print("[Watchtower] Decision unclear - treating as escalation for safety.")
        call_secondary_contact_for_escalation(event)

    return decision


if __name__ == "__main__":
    # Manual test without needing the CV pipeline running - simulates
    # a fall event so you can verify the CALL-E integration on its own.
    test_event = {
        "event": "fall_detected",
        "timestamp": "2026-08-01T15:42:00+00:00",
        "confidence": 0.87,
        "room": "living_room",
    }
    handle_fall_event(test_event)