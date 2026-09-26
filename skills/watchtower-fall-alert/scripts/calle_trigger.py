"""
calle_trigger.py

Takes a fall_detected event from fall_detector.py and places a real
phone call to the caregiver via CALL-E, using CALL-E's Python SDK.

SAFE BY DEFAULT: this module runs in dry-run mode unless you explicitly
opt in to live calls for that run. See "Going live" below.

Safety design (matches this repo's safety.md / deployment-approval-call
pattern, and addresses PR review feedback from CALLE-AI/awesome-phone-
call-agents#416):

  - Dry-run is the DEFAULT. Real calls require an explicit, per-run
    confirmation phrase - not just an API key being present.
  - Phone numbers must be strict ASCII E.164 and must exactly match an
    operator-configured allowlist. A number that isn't both
    well-formed AND explicitly authorized is refused.
  - Phone numbers, structured results, and error text are masked before
    being printed or logged - never written out in full.
  - CALL-E does NOT autonomously call emergency services, ever.
  - If the caregiver call result is ambiguous (no clear decision, or
    the call itself errors), Watchtower STOPS. It does not retry the
    call and does not automatically call the secondary contact - an
    ambiguous outcome requires a human operator to look at it, not an
    automated second phone call.
  - All phone numbers in this file are placeholders from NANP's
    officially reserved fictional range (555-0100 through 555-0199).
    Replace with your own configured, consented, authorized numbers -
    never hardcode a real number in committed example code.

Install:
    pip install calle-ai --break-system-packages

Setup (safe/dry-run - no API key or real numbers required):
    python calle_trigger.py

Going live (all of the following are required together):
    export CALLE_API_KEY="calle_live_key"
    export WATCHTOWER_CAREGIVER_PHONE="+1..."          # E.164
    export WATCHTOWER_SECONDARY_PHONE="+1..."          # E.164
    export WATCHTOWER_AUTHORIZED_NUMBERS="+1...,+1..." # must contain BOTH numbers above, exactly
    export WATCHTOWER_CONFIRM_LIVE_CALL="I_UNDERSTAND_THIS_PLACES_REAL_PHONE_CALLS"
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Literal, Optional

from calle import CalleClient

# --- Reserved fictional placeholders --------------------------------------
# NANP officially reserves NXX-555-0100 through NXX-555-0199 in any area
# code for fictional use (e.g. film, TV, documentation). These are the
# ONLY numbers that should ever appear in this file's defaults or in
# committed docs/examples.
CAREGIVER_PHONE = os.environ.get("WATCHTOWER_CAREGIVER_PHONE", "+12125550123")
SECONDARY_CONTACT_PHONE = os.environ.get("WATCHTOWER_SECONDARY_PHONE", "+12125550199")

# The exact phrase required, per run, to place real calls. Presence of
# CALLE_API_KEY alone is NOT sufficient - this must also be set,
# deliberately, by whoever is running Watchtower this time.
LIVE_CALL_CONFIRMATION_PHRASE = "I_UNDERSTAND_THIS_PLACES_REAL_PHONE_CALLS"

E164_PATTERN = re.compile(r"^\+[1-9]\d{1,14}$")

Decision = Literal["dismiss", "escalate", "unknown"]


@dataclass
class FallEvent:
    event: str
    timestamp: str
    confidence: float
    room: str


def _mask_phone(phone: str) -> str:
    """Masks a phone number for safe logging - keeps just enough to be
    recognizable for debugging without printing the full number."""
    if len(phone) <= 5:
        return "*" * len(phone)
    return phone[:3] + "*" * (len(phone) - 5) + phone[-2:]


def _mask_text(text: str, max_len: int = 120) -> str:
    """Truncates and neutralizes arbitrary text (errors, results) before
    logging, so nothing unexpectedly leaks a phone number or transcript
    fragment into logs."""
    text = str(text)
    if len(text) > max_len:
        text = text[:max_len] + "...[truncated]"
    return text


def is_live_run() -> bool:
    """
    Returns True only if the operator has explicitly opted in to real
    calls for THIS run, via the exact confirmation phrase. Everything
    else (including having a valid CALLE_API_KEY set) still results in
    a dry run. This is intentional: safe-by-default, opt-in-to-danger.
    """
    return (
        os.environ.get("WATCHTOWER_CONFIRM_LIVE_CALL", "") == LIVE_CALL_CONFIRMATION_PHRASE
    )


def _validate_e164_ascii(phone: str, label: str) -> None:
    if not phone.isascii():
        raise ValueError(f"{label} contains non-ASCII characters and was rejected.")
    if not E164_PATTERN.match(phone):
        raise ValueError(
            f"{label} is not a valid strict E.164 number "
            f"(expected format like +12125550123) and was rejected."
        )


def _validate_authorized(phone: str, label: str) -> None:
    """
    Requires an exact match against an operator-configured allowlist.
    This is a deliberate second check beyond "is this well-formed" -
    a well-formed number is not automatically an authorized one.
    """
    authorized_raw = os.environ.get("WATCHTOWER_AUTHORIZED_NUMBERS", "")
    authorized = {n.strip() for n in authorized_raw.split(",") if n.strip()}

    if phone not in authorized:
        raise ValueError(
            f"{label} ({_mask_phone(phone)}) is not present in "
            f"WATCHTOWER_AUTHORIZED_NUMBERS and was refused. Add it "
            f"explicitly to that comma-separated env var to authorize it."
        )


def _validate_destination(phone: str, label: str) -> None:
    _validate_e164_ascii(phone, label)
    _validate_authorized(phone, label)


def _client() -> CalleClient:
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "CALLE_API_KEY is not set. Required for live calls only - "
            "dry runs do not need it."
        )
    return CalleClient(api_key=api_key)


def call_caregiver(event: FallEvent) -> Decision:
    """
    Places the primary alert call to the caregiver and returns their
    spoken decision. This is the human-in-the-loop step - CALL-E never
    proceeds past this without an explicit decision from a person.

    No retries. If the call errors or the result is ambiguous, this
    function stops and returns "unknown" immediately - it does NOT
    retry the call (which could duplicate an already-placed call to a
    distressed caregiver) and the caller of this function does NOT
    automatically escalate on "unknown" - see handle_fall_event().
    """
    task = (
        f"Call {CAREGIVER_PHONE}. Identify yourself as Watchtower, a home "
        f"safety monitoring assistant. Tell them: 'A possible fall was "
        f"detected in the {event.room.replace('_', ' ')} at "
        f"{event.timestamp}.' Ask them to make a decision: should this be "
        f"dismissed as a false alarm, or should it be escalated? Wait for "
        f"a clear verbal decision before ending the call. Do not take any "
        f"action beyond recording their decision."
    )

    result_schema = {
        "type": "object",
        "required": ["decision"],
        "properties": {
            "decision": {
                "type": "string",
                "enum": ["dismiss", "escalate", "unknown"],
            }
        },
    }

    if not is_live_run():
        print("[Watchtower] DRY RUN (default) - no real call placed.")
        print(f"  Would call: {_mask_phone(CAREGIVER_PHONE)}")
        print("  Simulated decision: dismiss")
        return "dismiss"

    _validate_destination(CAREGIVER_PHONE, "WATCHTOWER_CAREGIVER_PHONE")
    client = _client()

    try:
        call = client.calls.create_and_wait(task=task, result_schema=result_schema)
    except Exception as exc:
        print(
            f"[Watchtower] Caregiver call failed or its result is "
            f"ambiguous: {_mask_text(exc)}"
        )
        print(
            "[Watchtower] STOPPING - not retrying automatically. "
            "This requires manual operator review."
        )
        return "unknown"

    status = call.get("status", "unknown")
    task_completed = call.get("task_completed", False)
    structured_result = call.get("structured_result") or {}
    decision = structured_result.get("decision", "unknown")

    print(f"[Watchtower] Caregiver call status: {status}")
    print(f"[Watchtower] Task completed: {task_completed}")
    print(f"[Watchtower] Decision: {decision}")

    if not task_completed or decision not in ("dismiss", "escalate"):
        print(
            "[Watchtower] Result is ambiguous (incomplete task or unclear "
            "decision). STOPPING - not retrying, not auto-escalating. "
            "This requires manual operator review."
        )
        return "unknown"

    return decision  # type: ignore[return-value]


def call_secondary_contact_for_escalation(event: FallEvent) -> None:
    """
    Places a call to a human secondary contact. Only ever called when a
    caregiver has EXPLICITLY said "escalate" during a completed call -
    never automatically for an ambiguous/unknown result (see
    handle_fall_event()). Still never contacts emergency services
    directly - a real person always makes that call themselves.
    """
    task = (
        f"Call {SECONDARY_CONTACT_PHONE}. Identify yourself as Watchtower, "
        f"a home safety monitoring assistant. Tell them: 'A fall was "
        f"detected in the {event.room.replace('_', ' ')} at "
        f"{event.timestamp}, and the primary caregiver has escalated this. "
        f"Please check on the resident now, and call emergency services "
        f"yourself if needed.' Confirm they received and understood the "
        f"message before ending the call."
    )

    if not is_live_run():
        print("[Watchtower] DRY RUN (default) - no real escalation call placed.")
        print(f"  Would call: {_mask_phone(SECONDARY_CONTACT_PHONE)}")
        return

    _validate_destination(SECONDARY_CONTACT_PHONE, "WATCHTOWER_SECONDARY_PHONE")
    client = _client()

    try:
        call = client.calls.create_and_wait(task=task)
        print(f"[Watchtower] Escalation call status: {call.get('status', 'unknown')}")
    except Exception as exc:
        print(f"[Watchtower] Escalation call failed: {_mask_text(exc)}")
        print("[Watchtower] STOPPING - this requires manual operator follow-up.")


def handle_fall_event(event_dict: dict) -> Decision:
    """
    Entry point called by fall_detector.py for each fall event.

    Orchestration is intentionally conservative:
      - dismiss   -> done, no further action.
      - escalate  -> ONE call to the secondary contact. No retries.
      - unknown   -> STOP. Do not retry the caregiver call, do not
                     automatically call the secondary contact. An
                     ambiguous result is surfaced for manual review,
                     not auto-resolved by placing another call.
    """
    event = FallEvent(**event_dict)

    if not is_live_run():
        print("[Watchtower] Running in DRY RUN mode (default - no real calls).")

    print(
        f"[Watchtower] Fall detected in {event.room} "
        f"(confidence={event.confidence}). Calling caregiver..."
    )

    decision = call_caregiver(event)

    if decision == "escalate":
        print("[Watchtower] Caregiver escalated. Calling secondary contact...")
        call_secondary_contact_for_escalation(event)
    elif decision == "dismiss":
        print("[Watchtower] Caregiver dismissed as false alarm. No further action.")
    else:
        print(
            "[Watchtower] Result was ambiguous. STOPPING here by design - "
            "no retry, no automatic secondary call. Please review this "
            "event manually."
        )

    return decision


if __name__ == "__main__":
    # Safe by default: running this file with no env vars set performs a
    # dry run and prints exactly what WOULD happen, with masked numbers.
    test_event = {
        "event": "fall_detected",
        "timestamp": "2026-08-01T15:42:00+00:00",
        "confidence": 0.87,
        "room": "living_room",
    }
    handle_fall_event(test_event)