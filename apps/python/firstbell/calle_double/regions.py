"""The regions and languages CALL-E actually supports.

Kept as data rather than prose so the double can reject an unsupported destination the
same way the real service does, with `unsupported_region` or `unsupported_language`.

Attribution: the country, calling code, language and line-region values below are
transcribed from the "Supported regions and languages" table in
https://github.com/CALLE-AI/call-e-integrations, which is published under the MIT licence,
Copyright (c) 2026 CALL-E contributors. See THIRD-PARTY-NOTICES.md. The table is reproduced
as factual reference data so that this test double can reject the same destinations the
real service rejects; a double that accepted numbers the service refuses would give a
false pass.

Line region matters: `Local` means the call originates from a local number for the
destination country. `International` means it goes out over CALL-E's international
numbers, which the upstream README describes as "primarily intended for testing".
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Region:
    country: str
    code: str
    calling_code: str
    languages: tuple[str, ...]
    line: str  # "Local" or "International"


_ROWS: tuple[tuple[str, str, str, tuple[str, ...], str], ...] = (
    ("United States of America", "US", "+1", ("English",), "Local"),
    ("Singapore", "SG", "+65", ("English",), "Local"),
    ("Malaysia", "MY", "+60", ("English", "Chinese", "Malay"), "Local"),
    ("India", "IN", "+91", ("English", "Hindi", "Tamil"), "International"),
    ("United Arab Emirates", "AE", "+971", ("English", "Arabic"), "Local"),
    ("Australia", "AU", "+61", ("English",), "Local"),
    ("Canada", "CA", "+1", ("English",), "International"),
    ("United Kingdom", "GB", "+44", ("English",), "International"),
    ("Viet Nam", "VN", "+84", ("Vietnamese", "English"), "International"),
    ("Germany", "DE", "+49", ("English", "German"), "International"),
    ("Japan", "JP", "+81", ("Japanese", "English"), "International"),
    ("France", "FR", "+33", ("French", "English"), "International"),
    ("Mexico", "MX", "+52", ("Spanish", "English"), "Local"),
    ("Brazil", "BR", "+55", ("Portuguese", "English"), "Local"),
    ("Indonesia", "ID", "+62", ("English",), "International"),
    ("Philippines", "PH", "+63", ("English",), "International"),
    ("Kenya", "KE", "+254", ("English",), "International"),
    ("Netherlands", "NL", "+31", ("English",), "International"),
    ("Poland", "PL", "+48", ("Polish", "English"), "International"),
    ("Bangladesh", "BD", "+880", ("Bengali", "English"), "International"),
    ("Nigeria", "NG", "+234", ("English",), "International"),
    ("Oman", "OM", "+968", ("English", "Arabic"), "International"),
    ("Thailand", "TH", "+66", ("English", "Thai"), "International"),
    ("Namibia", "NA", "+264", ("English",), "International"),
    ("Cameroon", "CM", "+237", ("English", "French"), "International"),
    ("Mozambique", "MZ", "+258", ("English", "Portuguese"), "International"),
    ("Saudi Arabia", "SA", "+966", ("English", "Arabic"), "International"),
    ("Finland", "FI", "+358", ("English", "Finnish"), "International"),
    ("Ukraine", "UA", "+380", ("English", "Ukrainian"), "International"),
    ("Sri Lanka", "LK", "+94", ("English", "Tamil", "Sinhala"), "International"),
    ("Botswana", "BW", "+267", ("English",), "International"),
    ("Pakistan", "PK", "+92", ("English", "Urdu"), "International"),
    ("Turkey", "TR", "+90", ("Turkish",), "International"),
    ("Honduras", "HN", "+504", ("English", "Spanish"), "International"),
    ("Spain", "ES", "+34", ("English", "Spanish"), "International"),
    ("Taiwan", "TW", "+886", ("English",), "International"),
    ("South Africa", "ZA", "+27", ("English",), "International"),
    ("Egypt", "EG", "+20", ("English", "Arabic"), "International"),
    ("Ghana", "GH", "+233", ("English",), "International"),
    ("Israel", "IL", "+972", ("English", "Hebrew"), "International"),
    ("Ireland", "IE", "+353", ("English",), "International"),
    ("Tunisia", "TN", "+216", ("English",), "International"),
)

REGIONS: dict[str, Region] = {r[1]: Region(*r) for r in _ROWS}

# Longest calling code first, so +1 does not shadow +91.
_BY_CALLING_CODE: tuple[tuple[str, Region], ...] = tuple(
    sorted(
        ((r.calling_code, r) for r in REGIONS.values()),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)


def resolve(phone: str) -> Region | None:
    """Best-effort country resolution from an E.164 number.

    +1 is shared by US and Canada and this returns whichever the table lists first for
    that prefix, which is a real ambiguity in the upstream data rather than a bug here.
    """
    if not phone.startswith("+"):
        return None
    for calling_code, region in _BY_CALLING_CODE:
        if phone.startswith(calling_code):
            return region
    return None


def supports_language(region: Region, language: str) -> bool:
    return language.strip().lower() in {lang.lower() for lang in region.languages}


TAMIL_REGIONS = tuple(
    r.code for r in REGIONS.values() if supports_language(r, "Tamil")
)
