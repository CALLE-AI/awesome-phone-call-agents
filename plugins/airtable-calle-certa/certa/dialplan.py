"""Which country a number belongs to, and whether CALL-E can reach it.

A dial-ready contact already carries the fact that decides how the call is
routed: its country calling code. Sending a +91 number to CALL-E with no
region leaves that fact on the floor. The call is accepted, dialed, and
refused by the carrier in zero seconds with a bare SIP 404 -- which is an
expensive and completely uninformative way to learn something the number
itself already said.

So the region is derived rather than configured. There is nothing for an
operator to set and nothing to get wrong: a number that starts +91 is dialed
as IN, and a number that starts +44 is dialed as GB.

The same table also answers a question worth asking *before* spending a call:
whether CALL-E covers the country at all. Its published coverage is a finite
list, so a number outside it is refused by name here instead of being dialed
into a failure. That is the same fail-closed posture the rest of Certa takes
-- the difference between "we could not verify this" and "we do not reach
Jamaica" matters to the person reading the row.

Coverage tracks the list CALL-E publishes at
https://github.com/CALLE-AI/call-e-integrations ("Supported Regions and
Languages"). It is a snapshot of a document that can change, so
`UnsupportedRegion` says so and the panel lets the call through to a human
rather than pretending the list is authoritative forever.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from .types import E164


class UnsupportedRegion(Exception):
    """The number's country is not in CALL-E's published coverage."""


@dataclass(frozen=True, slots=True)
class Destination:
    """Where a number dials, and what CALL-E speaks there."""

    region: str
    country: str
    languages: tuple[str, ...]

    @property
    def locale(self) -> str:
        """The language CALL-E should open in. First listed is the default."""
        return self.languages[0]


# Country calling code -> destination. Ordered by nothing in particular; the
# lookup is longest-prefix, so the order of this mapping does not matter.
COVERAGE: Final[dict[str, Destination]] = {
    "20": Destination("EG", "Egypt", ("en", "ar")),
    "27": Destination("ZA", "South Africa", ("en",)),
    "31": Destination("NL", "Netherlands", ("en",)),
    "33": Destination("FR", "France", ("fr", "en")),
    "34": Destination("ES", "Spain", ("en", "es")),
    "44": Destination("GB", "United Kingdom", ("en",)),
    "48": Destination("PL", "Poland", ("pl", "en")),
    "49": Destination("DE", "Germany", ("en", "de")),
    "52": Destination("MX", "Mexico", ("es", "en")),
    "55": Destination("BR", "Brazil", ("pt", "en")),
    "60": Destination("MY", "Malaysia", ("en", "zh", "ms")),
    "61": Destination("AU", "Australia", ("en",)),
    "62": Destination("ID", "Indonesia", ("en",)),
    "63": Destination("PH", "Philippines", ("en",)),
    "65": Destination("SG", "Singapore", ("en",)),
    "66": Destination("TH", "Thailand", ("en", "th")),
    "81": Destination("JP", "Japan", ("ja", "en")),
    "84": Destination("VN", "Vietnam", ("vi", "en")),
    "90": Destination("TR", "Turkey", ("tr",)),
    "91": Destination("IN", "India", ("en", "hi", "ta")),
    "92": Destination("PK", "Pakistan", ("en", "ur")),
    "94": Destination("LK", "Sri Lanka", ("en", "ta", "si")),
    "216": Destination("TN", "Tunisia", ("en",)),
    "233": Destination("GH", "Ghana", ("en",)),
    "234": Destination("NG", "Nigeria", ("en",)),
    "237": Destination("CM", "Cameroon", ("en", "fr")),
    "254": Destination("KE", "Kenya", ("en",)),
    "258": Destination("MZ", "Mozambique", ("en", "pt")),
    "264": Destination("NA", "Namibia", ("en",)),
    "267": Destination("BW", "Botswana", ("en",)),
    "353": Destination("IE", "Ireland", ("en",)),
    "358": Destination("FI", "Finland", ("en", "fi")),
    "380": Destination("UA", "Ukraine", ("en", "uk")),
    "504": Destination("HN", "Honduras", ("en", "es")),
    "880": Destination("BD", "Bangladesh", ("bn", "en")),
    "886": Destination("TW", "Taiwan", ("en",)),
    "966": Destination("SA", "Saudi Arabia", ("en", "ar")),
    "968": Destination("OM", "Oman", ("en", "ar")),
    "971": Destination("AE", "United Arab Emirates", ("en", "ar")),
    "972": Destination("IL", "Israel", ("en", "he")),
}

_US: Final = Destination("US", "United States", ("en",))
_CA: Final = Destination("CA", "Canada", ("en",))

# +1 is shared by twenty-odd countries. CALL-E's list names two of them, so
# the area code has to be read to tell a supported destination from an
# unsupported one. These are the Canadian assignments; every other +1 number
# below is either US or one of the territories named in _NANP_ELSEWHERE.
_CANADA_AREA_CODES: Final[frozenset[str]] = frozenset(
    """204 226 236 249 250 263 289 306 343 354 365 367 368 382 387 403 416 418
    428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 600 604 613
    639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902
    905""".split()
)

# NANP area codes that are neither US nor Canada. CALL-E's published list
# names none of them, so they are refused by name rather than dialed as US.
_NANP_ELSEWHERE: Final[dict[str, str]] = {
    "242": "the Bahamas", "246": "Barbados", "264": "Anguilla",
    "268": "Antigua and Barbuda", "284": "the British Virgin Islands",
    "340": "the U.S. Virgin Islands", "345": "the Cayman Islands",
    "441": "Bermuda", "473": "Grenada", "649": "the Turks and Caicos Islands",
    "658": "Jamaica", "664": "Montserrat", "670": "the Northern Mariana Islands",
    "671": "Guam", "684": "American Samoa", "721": "Sint Maarten",
    "758": "Saint Lucia", "767": "Dominica",
    "784": "Saint Vincent and the Grenadines", "787": "Puerto Rico",
    "809": "the Dominican Republic", "829": "the Dominican Republic",
    "849": "the Dominican Republic", "868": "Trinidad and Tobago",
    "869": "Saint Kitts and Nevis", "876": "Jamaica", "939": "Puerto Rico",
}


def resolve(e164: str) -> Destination:
    """Where this number dials. Raises `UnsupportedRegion` if CALL-E cannot.

    The match is longest-prefix over country calling codes, read from the
    front of the number, so +1 216 (Cleveland) and +216 (Tunisia) do not
    collide: the first is read as code "1", the second as code "216".
    """
    if not E164.fullmatch(e164):
        raise UnsupportedRegion(
            f"{e164!r} is not an E.164 number, so no destination can be read "
            "from it"
        )
    digits = e164[1:]

    for width in (3, 2, 1):
        code = digits[:width]
        if code in COVERAGE:
            return COVERAGE[code]
        if code == "1":
            return _resolve_nanp(digits)

    # A code was read; it is simply not one CALL-E publishes coverage for.
    # Naming the code is what makes the row actionable: an operator can check
    # the published list, and the reason survives into the audit trail.
    # Shown as a prefix, not as a country code: the true code for an
    # uncovered country is unknown here, and asserting one would be a guess
    # printed as a fact.
    raise UnsupportedRegion(
        f"no country in CALL-E's published coverage has a calling code "
        f"matching +{digits[:3]}..., so the call is not placed. Its supported "
        "regions are listed at https://github.com/CALLE-AI/call-e-integrations"
    )


def _resolve_nanp(digits: str) -> Destination:
    """Split +1 into the two countries CALL-E covers, and the ones it does not."""
    area = digits[1:4]
    if area in _CANADA_AREA_CODES:
        return _CA
    if area in _NANP_ELSEWHERE:
        raise UnsupportedRegion(
            f"+1 {area} is {_NANP_ELSEWHERE[area]}. CALL-E's published coverage "
            "names the United States and Canada within +1, not this territory, "
            "so the call is not placed."
        )
    return _US
