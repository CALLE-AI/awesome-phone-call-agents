"""Builds a natural-language CALL-E task string from an incident payload.

CALL-E is goal/task-oriented: we hand it one plain-language description of
the situation and the decision we need, and it handles the conversation. No
scripted multi-turn dialogue tree lives here on purpose.
"""
from __future__ import annotations

from datetime import datetime, timezone


def compose_task(incident: dict, risk_score: float) -> str:
    signals = incident.get("signals", {}) or {}
    proposed_action = incident.get("proposed_action") or "an automated containment action"
    timestamp = incident.get("timestamp") or datetime.now(timezone.utc).strftime("%H:%M UTC")

    signal_bits = []
    if "rfid_zone" in signals:
        signal_bits.append(f"RFID access to {signals['rfid_zone']} at {timestamp}")
    if "gas_ppm" in signals:
        signal_bits.append(f"a gas reading of {signals['gas_ppm']}ppm")
    if "temp_c" in signals:
        signal_bits.append(f"a temperature of {signals['temp_c']} degrees Celsius")
    if "src_ip" in signals:
        attempts_str = f" with {signals['attempts']} attempts" if "attempts" in signals else ""
        signal_bits.append(f"suspicious traffic from {signals['src_ip']}{attempts_str}")
    if "coolant_psi" in signals:
        zone_str = f" in {signals['zone']}" if "zone" in signals else ""
        signal_bits.append(f"coolant pressure drop to {signals['coolant_psi']}psi{zone_str}")
    if "door" in signals:
        body_str = f" ({signals.get('body_count', 'multiple')} people on {signals.get('badge_count', 1)} badge)" if "badge_count" in signals else ""
        signal_bits.append(f"tailgate alert at {signals['door']}{body_str}")

    if not signal_bits and incident.get("description"):
        signal_summary = incident["description"]
    elif signal_bits:
        signal_summary = " combined with ".join(signal_bits)
    else:
        signal_summary = "an anomalous sensor pattern"

    return (
        f"Call the on-call security lead and describe: {signal_summary}, "
        f"risk score {round(risk_score * 100)}%. The proposed automated action is "
        f"{proposed_action}. Ask the recipient to say clearly: approve, hold, or escalate. "
        f"If they say hold or escalate, ask why, and capture that reason."
    )
