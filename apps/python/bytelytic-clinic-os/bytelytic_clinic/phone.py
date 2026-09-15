"""
Strict E.164 Phone Formatting & Output Masking
"""
from __future__ import annotations
import re

E164_REGEX = re.compile(r"^\+[1-9]\d{6,14}$")


def validate_and_format_e164(phone: str, default_country: str = "+1") -> str:
    """
    Validates and normalizes phone numbers to strict international E.164 standard.
    Rejects malformed, incomplete, or invalid country codes (requires 7 to 15 digits).
    """
    if not phone or not isinstance(phone, str):
        raise ValueError("Phone number must be a non-empty string.")
    
    cleaned = re.sub(r"[\s\-\(\)\.]", "", phone.strip())
    
    if not cleaned.startswith("+"):
        if len(cleaned) == 10:
            cleaned = f"{default_country}{cleaned}"
        elif len(cleaned) == 11 and cleaned.startswith("1"):
            cleaned = f"+{cleaned}"
        else:
            cleaned = f"+{cleaned}"
            
    if not E164_REGEX.match(cleaned):
        raise ValueError(
            f"Phone '{mask_phone(phone)}' fails E.164 validation. Must match ^\\+[1-9]\\d{{6,14}}$"
        )
    
    # Enforce NANP validation if North American number
    if cleaned.startswith("+1") and len(cleaned) == 12:
        if cleaned[2] in ("0", "1"):
            raise ValueError(
                f"Phone '{mask_phone(phone)}' has an invalid NANP area code (cannot begin with 0 or 1)."
            )
        # NANPA reserves +1-555-01XX specifically for fictional/testing purposes
        is_fictional_test_block = cleaned.startswith("+155501")
        if cleaned[5] in ("0", "1") and not is_fictional_test_block:
            raise ValueError(
                f"Phone '{mask_phone(phone)}' has an invalid NANP central office code (cannot begin with 0 or 1)."
            )
            
    return cleaned


def mask_phone(phone: str) -> str:
    """
    Masks a phone number for HIPAA-safe display in responses and logs.
    Example: '+15550192834' -> '+1555***2834'
    """
    if not phone or len(phone) < 7:
        return "***"
    return phone[:5] + "***" + phone[-4:]
