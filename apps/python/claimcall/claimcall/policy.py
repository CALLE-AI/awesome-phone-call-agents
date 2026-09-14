"""Safety boundaries enforced in code, not just in prompt text."""
from __future__ import annotations

import re
from typing import Dict, List, Optional

E164_PATTERN = re.compile(r"\+[1-9][0-9]{7,14}")

# Regions the app can dial. An unknown region is refused rather than guessed.
REGIONS: Dict[str, str] = {
    "US": "1", "CA": "1",
    "GB": "44", "FR": "33", "DE": "49", "IE": "353",
    "IN": "91", "SG": "65", "AU": "61",
}

# What the agent may ask for. Shown to the traveller before approval and
# restated at the end of every call task.
CALL_CONSTRAINTS = [
    "Do not purchase anything",
    "Do not provide payment information",
    "Do not accept additional charges",
    "Do not cancel unrelated flights",
    "Do not modify unrelated bookings",
    "Do not accept compensation offers on the traveller's behalf",
]

# Hard boundaries spoken into every task prompt. The agent reports; the human decides.
HARD_BOUNDARIES = [
    "You are an AI assistant calling on behalf of the traveller; say so if asked, and never claim to be the traveller.",
    "Never give, confirm, or read back payment card numbers, bank details, passwords, one-time codes, or government ID numbers.",
    "Never buy anything, never accept additional charges, and never provide payment information.",
    "Never accept or reject a compensation offer on the traveller's behalf. If one is made, record the exact wording and say the traveller will respond.",
    "Never cancel, change, or modify any flight or booking outside the objectives listed above.",
    "Never threaten, insult, or mention lawyers, regulators, or legal action.",
]


def region_for_number(hotline: str) -> Optional[str]:
    """Derive the dialling region from the number's country code (longest prefix wins).

    Used when the operator types a live destination into the dashboard: the typed
    number carries its own region instead of inheriting the case region. Returns
    None when the country code is not in the supported table.
    """
    if not isinstance(hotline, str) or not hotline.startswith("+"):
        return None
    digits = hotline[1:]
    for region, cc in sorted(REGIONS.items(), key=lambda kv: -len(kv[1])):
        if digits.startswith(cc):
            return region
    return None


def destination_problems(hotline: str, region: str) -> List[str]:
    """Every reason a destination is not a valid, dialable, region-consistent E.164 number."""
    if not isinstance(hotline, str) or not E164_PATTERN.fullmatch(hotline):
        return ["Hotline must be a full E.164 number: '+', country code, subscriber number, 8 to 15 digits, no spaces."]
    if region not in REGIONS:
        return [f"Region {region!r} is not supported; refusing rather than guessing."]
    if not hotline[1:].startswith(REGIONS[region]):
        return [f"Hotline country code does not match region {region} (+{REGIONS[region]})."]
    return []


def live_gate(
    hotline: str,
    region: str,
    approved: bool,
    api_key_present: bool,
    allowlist: Optional[str] = None,
) -> List[str]:
    """All reasons a live call must not be placed. Empty list means permitted.

    Enforced in code on every live path: no approval, no call; no key, no call;
    bad destination, no call; destination outside the configured allowlist, no call.
    """
    problems = list(destination_problems(hotline, region))
    if not approved:
        problems.append("Live calls require explicit human approval (Approve & Call). Loading or analysing a case never dials.")
    if not api_key_present:
        problems.append("CALLE_API_KEY is not set. Use preview or fixture mode for a no-call run.")
    allowed = [n.strip() for n in (allowlist or "").split(",") if n.strip()]
    if allowed and hotline not in allowed:
        problems.append("Destination is not on CLAIMCALL_ALLOWLIST; add it explicitly to authorise this number.")
    return problems
