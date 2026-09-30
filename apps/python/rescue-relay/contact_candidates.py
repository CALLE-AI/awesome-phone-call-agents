"""One auditable candidate policy for discovery, comparison and UI availability.

Capabilities are routing hints, never verified offers. Telephone fingerprints remain
server-side. A directory edit cannot make a previously called number uncalled.
"""
from __future__ import annotations
import hashlib
from coordinator import contact_supports


def phone_fingerprint(phone: str) -> str:
    return hashlib.sha256(phone.encode()).hexdigest()


def candidate_inventory(contacts: list[dict], calls: list[dict], requirements: list[dict],
                        mode: str, *, is_fictional) -> list[dict]:
    called_ids = {c["business_id"] for c in calls}
    fingerprints = set()
    # Old pre-fingerprint records conservatively use the current saved number too.
    legacy_ids = {c["business_id"] for c in calls if not (c.get("recipient_fingerprint") and c.get("business_name_snapshot"))}
    fingerprints.update(phone_fingerprint(c["phone"]) for c in contacts if c["id"] in legacy_ids)
    seen = set()
    result = []
    # Put approved matches first so legacy duplicate rows cannot hide a better match.
    ordered = sorted(contacts, key=lambda c: (
        not bool(c.get("active", True)), not bool(c.get("consent_to_contact")),
        mode == "live" and bool(c.get("simulated_only") or is_fictional(c["phone"])),
        -sum(contact_supports(c, n) for n in requirements), c.get("created_at", ""), c["name"], c["id"]))
    for contact in ordered:
        matches = [n for n in requirements if contact_supports(contact, n)]
        fp = phone_fingerprint(contact["phone"])
        # v5 already saved SHA256(name-at-call + NUL + phone). Reconstruct with
        # each historical name rather than the mutable directory name/number.
        historical_match = any(
            c.get("recipient_fingerprint") and c.get("business_name_snapshot")
            and hashlib.sha256((c["business_name_snapshot"] + "\0" + contact["phone"]).encode()).hexdigest() == c["recipient_fingerprint"]
            for c in calls)
        if contact["id"] in called_ids or fp in fingerprints or historical_match:
            code, reason = "already_contacted", "Already contacted in this run. No automatic redial."
        elif not contact.get("active", True):
            code, reason = "inactive", "Archived contact."
        elif not contact.get("consent_to_contact"):
            code, reason = "not_approved", "Not approved to receive rescue calls."
        elif mode == "live" and (contact.get("simulated_only") or is_fictional(contact["phone"])):
            code, reason = "mock_only", "Example number; cannot receive live calls."
        elif fp in seen:
            code, reason = "duplicate_number", "Same telephone number as another available contact. One inquiry per number."
        else:
            seen.add(fp)
            if matches:
                code, reason = "eligible", "Saved capabilities may cover: " + "; ".join(n["label"] for n in matches) + "."
            else:
                code, reason = "no_capability_match", "No saved capability matches the required help. Review their abilities or explicitly ask about suitability."
        result.append({"contact_id": contact["id"], "name": contact["name"], "status": code,
                       "reason": reason, "matching_requirements": [n["id"] for n in matches],
                       "contact": contact})
    return result
