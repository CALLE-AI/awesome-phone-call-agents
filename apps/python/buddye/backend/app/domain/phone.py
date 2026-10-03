"""Region for an E.164 number.

CALL-E routes and applies compliance checks per recipient region, so a hardcoded "US" would make
any non-US demo number fail with `unsupported_region`. Longest calling-code prefix wins.
"""
from __future__ import annotations

# Only the codes we might plausibly dial. Unlisted numbers fall back to US with a visible warning,
# which is the same behaviour as before this module existed.
CALLING_CODES: dict[str, str] = {
    "1": "US", "7": "RU", "20": "EG", "27": "ZA", "31": "NL", "32": "BE", "33": "FR", "34": "ES",
    "39": "IT", "40": "RO", "44": "GB", "46": "SE", "47": "NO", "48": "PL", "49": "DE",
    "51": "PE", "52": "MX", "54": "AR", "55": "BR", "56": "CL", "57": "CO", "58": "VE",
    "60": "MY", "61": "AU", "62": "ID", "63": "PH", "64": "NZ", "65": "SG", "66": "TH",
    "81": "JP", "82": "KR", "84": "VN", "86": "CN", "90": "TR", "91": "IN", "92": "PK",
    "234": "NG", "254": "KE", "353": "IE", "358": "FI", "852": "HK", "886": "TW",
    "971": "AE", "972": "IL",
}
DEFAULT_REGION = "US"


def region_for(phone: str, default: str = DEFAULT_REGION) -> str:
    digits = phone.strip().lstrip("+")
    for length in (3, 2, 1):
        code = digits[:length]
        if code in CALLING_CODES:
            return CALLING_CODES[code]
    return default
