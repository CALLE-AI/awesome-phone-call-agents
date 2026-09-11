"""The checks that must fail closed before a phone rings.

Three separate jobs live here because they share one property: every one of them
refuses by default and has to be argued into permitting something.

  1. Phone numbers are validated as strict ASCII E.164, and masked everywhere.
  2. The CALL-E origin is parsed and allowlisted before the bearer token is attached.
  3. A destination must be explicitly authorized for this run, not merely not-forbidden.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# ASCII digits only. Python's `\d` also matches Arabic-Indic (U+0660) and fullwidth
# (U+FF10) digits, so a number that merely looks like "+1202..." on screen would pass a
# `\d`-based check and then be dialled as something else entirely. We reject confusables
# rather than transliterating them, because a number nobody can read back is not a number
# anybody authorized.
E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")

# Inside +1, E.164's general 8-to-15 digit range is too loose: every North American
# number is exactly the country code plus ten digits. A "+1" number of any other length
# is a typo, and dialling it would reach someone who did not agree to be called.
NANP_TOTAL_DIGITS = 11

# Sending the API key anywhere else would leak it. Parsed, never prefix-matched, because
# "https://api.heycall-e.com.evil.example" starts with the right string.
TRUSTED_CALLE_HOSTS = frozenset({"api.heycall-e.com"})

# NANP numbers reserved for fiction (555-0100 through 555-0199). Fixtures may only use
# these, so no real counter can ever be dialled by a test.
_FICTIONAL = re.compile(r"^\+1[0-9]{3}555 ?01[0-9]{2}$")


class SafetyError(RuntimeError):
    """A refusal. Never downgrade one of these to a warning."""


def validate_e164(number: str) -> str:
    """Return `number` if it is strict ASCII E.164, else refuse."""
    if not isinstance(number, str) or not E164.match(number):
        raise SafetyError(
            f"Not a strict ASCII E.164 number: {mask(str(number))!r}. "
            "Expected a leading + and 8 to 15 ASCII digits."
        )
    if number.startswith("+1") and len(number) - 1 != NANP_TOTAL_DIGITS:
        raise SafetyError(
            f"A +1 number must have exactly {NANP_TOTAL_DIGITS} digits, "
            f"and {mask(number)!r} has {len(number) - 1}."
        )
    return number


def is_fictional(number: str) -> bool:
    """True for NANP numbers reserved for drama and documentation."""
    return bool(_FICTIONAL.match(number.replace(" ", "")))


def mask(number: str) -> str:
    """Render a phone number for logs, reports, HTML and error text.

    Keeps the last four digits, which is enough for a human to recognise a row they are
    looking at, and not enough to redial it from a screenshot. A leading `+` is preserved
    only when the input had one, so masking a locally formatted number does not invent a
    country code it never carried.
    """
    raw = (number or "").strip()
    digits = re.sub(r"[^0-9]", "", raw)
    if len(digits) < 4:
        return "*" * len(digits)
    last = digits[-4:]
    if raw.startswith("+"):
        if len(digits) == NANP_TOTAL_DIGITS and digits.startswith("1"):
            return f"+1{'*' * (len(digits) - 5)}{last}"
        return f"+{'*' * (len(digits) - 4)}{last}"
    return f"{'*' * (len(digits) - 4)}{last}"


# Provider payloads and transcripts carry numbers in whatever shape the far end typed
# them, so redaction has to recognise more than E.164. A pharmacist reading a number back
# over the phone produces a local seven or ten digit form, and a registry record carries
# it with parentheses and hyphens. Matching only `+1...` leaves both in the clear.
_INTERNATIONAL = re.compile(r"\+[0-9][0-9 ()\.\-]{6,20}")

# NANP local forms, with or without separators, parentheses, or a leading 1. Area code and
# exchange must start 2 through 9, which is what makes this safe to run over arbitrary
# text: ten-digit identifiers that are not phone numbers, such as an NPI beginning 0 or 1,
# cannot match.
_NANP_LOCAL = re.compile(
    r"(?<![0-9A-Za-z])(?:1[\s.\-]?)?\(?[2-9][0-9]{2}\)?[\s.\-]?[2-9][0-9]{2}[\s.\-]?[0-9]{4}(?![0-9])"
)


def mask_text(text: str) -> str:
    """Mask every phone-shaped run in a piece of free text."""
    masked = _INTERNATIONAL.sub(lambda m: mask(m.group(0)), text)
    return _NANP_LOCAL.sub(lambda m: mask(m.group(0)), masked)


def mask_deep(value):
    """Recursively mask anything that looks like a phone number inside a structure.

    Provider payloads nest numbers in places that move between versions, so redaction
    walks the whole object rather than naming fields.
    """
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, dict):
        return {k: mask_deep(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [mask_deep(v) for v in value]
    return value


def assert_approved_origin(base_url: str) -> str:
    """Return the approved origin for `base_url`, or refuse.

    Called before the Authorization header is built, so a hostile override never sees
    the key.
    """
    if not base_url:
        raise SafetyError("CALL-E base URL is empty.")

    parsed = urlparse(base_url.rstrip("/"))
    if parsed.scheme != "https":
        raise SafetyError(f"CALL-E base URL must use https, got {parsed.scheme or 'nothing'!r}.")
    if parsed.username or parsed.password:
        raise SafetyError("CALL-E base URL must not carry credentials.")
    if parsed.path or parsed.query or parsed.fragment:
        raise SafetyError("CALL-E base URL must be an origin only, with no path or query.")
    if parsed.port is not None:
        raise SafetyError("CALL-E base URL must not name an alternate port.")
    if parsed.hostname not in TRUSTED_CALLE_HOSTS:
        raise SafetyError(
            f"Refusing to send credentials to {parsed.hostname!r}. "
            f"Allowed: {', '.join(sorted(TRUSTED_CALLE_HOSTS))}."
        )
    return f"https://{parsed.hostname}"


def authorize_destinations(
    requested: list[str], allowlist: frozenset[str] | set[str] | None
) -> list[str]:
    """Return the numbers this run may dial.

    An unset or empty allowlist authorizes NOTHING. A survey is a batch of calls to
    businesses, so the failure mode to design against is dialling a list that was
    silently wider than the operator reviewed.
    """
    if not allowlist:
        raise SafetyError(
            "No authorized destinations. Live calling needs an explicit allowlist file; "
            "an empty one permits no calls rather than all of them."
        )
    approved, rejected = [], []
    for number in requested:
        validate_e164(number)
        (approved if number in allowlist else rejected).append(number)
    if rejected:
        raise SafetyError(
            f"{len(rejected)} destination(s) are not in the authorized list, "
            f"including {mask(rejected[0])}. Add them deliberately or drop them."
        )
    return approved
