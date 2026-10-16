"""
Shared safety checks for anything that can place a real call.

- Strict, region-bound ASCII E.164 validation (no invented "+" prefix, no
  digit-count-only acceptance, no non-ASCII digits).
- The operator recipient-authorization attestation that live dispatch requires.
  Finding a business in a public directory is NOT recipient authorization; only
  an explicit operator attestation recorded on the campaign (or passed for a
  one-off call) unlocks a live call.
- Phone masking / redaction for anything printed, logged or streamed.
"""
import re

# consent_basis value stored on a campaign once the operator has explicitly
# attested that every recipient authorized the calls. Any other value (including
# the legacy "client-reviewed-and-approved") is not sufficient for a live call.
ATTESTED_BASIS = "operator-attested-recipient-authorization"

ATTESTATION_TEXT = (
    "I attest that every recipient in this campaign has authorized me to call them "
    "(for example, an existing supplier relationship or a prior opt-in). A public "
    "directory listing or a business purpose alone is not authorization."
)

# Country calling codes for the regions this app supports. CALL-E itself only dials
# a subset of these; anything outside the map is rejected for live calls.
REGION_CALLING_CODES = {
    "US": "1", "CA": "1",
    "IN": "91",
    "SG": "65",
    "AU": "61",
    "GB": "44", "UK": "44",
    "DE": "49",
    "FR": "33",
    "AE": "971",
}

# ASCII only: Python's \d also matches non-ASCII digits, which must be rejected.
_E164_RE = re.compile(r"\+[1-9][0-9]{7,14}")


def validate_e164(phone, region=None):
    """Return (ok, reason). `reason` never contains the phone number itself.

    The number must already be in exact ASCII E.164 form ("+<country><number>",
    8-15 digits, no spaces or punctuation). If `region` is given, the country
    calling code must match it.
    """
    if not isinstance(phone, str) or not phone:
        return False, "missing destination"
    if not phone.isascii():
        return False, "destination contains non-ASCII characters"
    if not _E164_RE.fullmatch(phone):
        return False, "destination is not exact E.164 (+<country code><number>)"
    if region:
        code = REGION_CALLING_CODES.get(str(region).strip().upper())
        if code is None:
            return False, f"unsupported region '{region}'"
        if not phone.startswith("+" + code):
            return False, f"destination does not belong to region {str(region).upper()}"
    return True, "ok"


def mask_phone(phone) -> str:
    """'+919812345678' -> '+91****678'. Never returns the full number."""
    s = "".join(c for c in str(phone or "") if c.isdigit() or c == "+")
    if len(s) >= 6:
        return s[:3] + "****" + s[-3:]
    return "***"


# Anything that looks like a phone number inside free text (transcripts, summaries,
# provider messages): optional +, then 7+ digits possibly separated by spaces,
# dots, dashes or parentheses.
_PHONE_IN_TEXT_RE = re.compile(r"\+?[0-9][0-9 ().-]{5,}[0-9]")


def redact_phones(text) -> str:
    """Mask every phone-like sequence in free text before it is shown or logged."""
    if not isinstance(text, str) or not text:
        return text if isinstance(text, str) else ""

    def _sub(m):
        digits = re.sub(r"[^0-9]", "", m.group(0))
        if len(digits) < 7:
            return m.group(0)  # short numbers (prices, times) are left alone
        return mask_phone(m.group(0))

    return _PHONE_IN_TEXT_RE.sub(_sub, text)


def safe_plan(plan) -> dict:
    """A plan summary that is safe to return/log: no destination, no confirm token."""
    if not isinstance(plan, dict):
        return {}
    return {
        "plan_id": plan.get("plan_id"),
        "has_confirm_token": bool(plan.get("confirm_token")),
    }
