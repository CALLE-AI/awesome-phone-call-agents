"""
Safety, Governance & Recipient Verification Policies
"""
from __future__ import annotations
from typing import List, Dict, Any
from ..phone import validate_and_format_e164, mask_phone


class RecipientSecurityPolicy:
    """
    Guards live voice execution to prevent dialing unverified destinations.
    """

    def __init__(self, authorized_recipients: List[str], dry_run: bool = True):
        self.authorized_recipients = [validate_and_format_e164(r) for r in authorized_recipients]
        self.dry_run = dry_run

    def verify_call_permission(self, phone: str) -> str:
        """
        Validates phone format and enforces recipient allowlist gate in live mode.
        Returns cleaned E.164 phone.
        """
        valid_phone = validate_and_format_e164(phone)
        if not self.dry_run:
            if valid_phone not in self.authorized_recipients:
                raise PermissionError(
                    f"Recipient {mask_phone(valid_phone)} not authorized for live execution. Add to AUTHORIZED_RECIPIENTS."
                )
        return valid_phone

    def check_fail_closed_disposition(self, confidence_score: float) -> bool:
        """
        Fail-closed rule: If model completion confidence is < 0.70, require human operator review.
        """
        return confidence_score < 0.70
