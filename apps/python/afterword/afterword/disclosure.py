"""The disclosure budget, enforced in code.

A bereaved family tells its solicitor everything. An institution on the phone
needs three things: who died, who is asking, and the reference the family was
given. Everything else is somebody's private business, and a call centre is not
where it should turn up.

The budget is a whitelist of estate values (`Estate.disclosable`) plus a
blacklist of categories that must never be spoken however they are phrased: a
cause of death, a date of birth, a balance, and a telephone number. Free text cannot be proved
clean, so this module makes two checks that can be: no withheld value from the
estate record appears verbatim, and no forbidden category is present by
pattern. `check` is called from `task.py`, so a script that leaks cannot be
built at all.
"""

from __future__ import annotations

import re

from .models import Estate


class DisclosureError(RuntimeError):
    """Raised when a built script would say something outside the budget."""

    def __init__(self, violations: tuple[str, ...]) -> None:
        super().__init__("disclosure budget exceeded: " + ", ".join(violations))
        self.violations = violations


#: Phrasings of a cause of death. The agent reports that a death was reported;
#: how somebody died is never a document requirement.
CAUSE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bcause of death\b", re.IGNORECASE),
    re.compile(r"\bdied (?:of|from)\b", re.IGNORECASE),
    re.compile(r"\bpassed away (?:of|from)\b", re.IGNORECASE),
    re.compile(r"\b(?:terminal|palliative|post[- ]?mortem)\b", re.IGNORECASE),
)

#: Phrasings of a date of birth. Institutions ask for it constantly, so the
#: phrase is banned outright rather than only when a date follows it: a script
#: that says "I cannot give you the date of birth" invites the agent to improvise
#: one, and a refusal can be worded without naming the field.
DATE_OF_BIRTH_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bdate of birth\b", re.IGNORECASE),
    re.compile(r"\bborn (?:on|in)\b", re.IGNORECASE),
    re.compile(r"\bd\.?o\.?b\.?\b", re.IGNORECASE),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
)

#: Phrasings of a balance. What is in the account is the executor's business
#: and an institution never needs it to say what documents it wants.
BALANCE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bbalance\b", re.IGNORECASE),
    re.compile(r"[\u00a3\u20ac$]\s?\d"),
    re.compile(r"\b\d[\d,]*\.\d{2}\b"),
    re.compile(r"\b(?:pounds|dollars|euros)\b", re.IGNORECASE),
)

#: A number in the script is a number in every preview and every log of it.
#: The line being dialled belongs in the call payload, not in what is said.
PHONE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\+\d[\d\s-]{6,}\d"),
    re.compile(r"\b0\d{9,10}\b"),
)

FORBIDDEN: dict[str, tuple[re.Pattern[str], ...]] = {
    "cause_of_death": CAUSE_PATTERNS,
    "date_of_birth": DATE_OF_BIRTH_PATTERNS,
    "balance": BALANCE_PATTERNS,
    "phone_number": PHONE_PATTERNS,
}


def budget(estate: Estate) -> tuple[str, ...]:
    """Exactly what may be said about this estate. Nothing else is permitted."""
    return tuple(value for value in estate.disclosable if value.strip())


def violations(text: str, estate: Estate) -> tuple[str, ...]:
    """Named reasons the text breaks the budget. Empty tuple means it holds."""
    found: list[str] = []
    for name, patterns in FORBIDDEN.items():
        for pattern in patterns:
            if pattern.search(text):
                found.append(f"forbidden_{name}")
                break
    lowered = text.lower()
    for value in estate.withheld:
        if value.lower() in lowered:
            # Named without echoing it, so a log of the failure does not leak
            # the thing the failure was about.
            found.append("withheld_estate_value_present")
            break
    return tuple(found)


def check(text: str, estate: Estate) -> str:
    """Return the text, or refuse to hand back a script that leaks."""
    found = violations(text, estate)
    if found:
        raise DisclosureError(found)
    return text
