"""Phone numbers: found only in the thread, validated strictly, shown masked.

Three rules, all structural rather than advisory:

1. A number is only ever taken from the thread the user is looking at, or typed
   by the user. Nothing is looked up, inferred from a name, or recalled from a
   contact store. There is no code path that can produce a number from a name.
2. Only strict ASCII E.164 can be dialled. A candidate without a country code is
   surfaced as unusable, not silently completed with a guess.
3. Every number leaving this module towards a log, an API response or a screen
   is masked.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass, asdict

from .thread import Thread

# ASCII digits only. [0-9] rather than \d, which in Python also matches Unicode
# digits such as U+0660 and would let a lookalike number through validation.
E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")

# Phone-shaped runs in free text: +1 415 555 0142, (415) 555-0142, 020 7946 0018.
_CANDIDATE = re.compile(r"(?:(?<=^)|(?<=[^0-9]))(\+?[0-9][0-9 ()\-.]{6,20}[0-9])")

# Things that look like phone numbers and are not.
_NOT_A_PHONE = re.compile(
    r"\b(invoice|inv|order|po|ref|reference|account|acct|vat|gst|pan|zip|postcode|"
    r"suite|room|floor|ext|extension|version|v\d)\b",
    re.IGNORECASE,
)


def mask(phone: str) -> str:
    """+442079460018 -> +44*******18. Country code and last two digits only."""
    cleaned = phone.strip()
    if len(cleaned) < 6:
        return "*" * len(cleaned)
    return f"{cleaned[:3]}{'*' * (len(cleaned) - 5)}{cleaned[-2:]}"


def mask_text(text: str) -> str:
    """Mask every phone-shaped run inside arbitrary text.

    Used on provider-supplied strings — summaries, transcripts, error bodies —
    which can echo a destination back at us in a shape we never sent.
    """
    def _replace(match: re.Match) -> str:
        raw = match.group(0)
        digits = re.sub(r"[^0-9+]", "", raw)
        return mask(digits) if len(re.sub(r"[^0-9]", "", digits)) >= 7 else raw

    return _CANDIDATE.sub(_replace, text or "")


def normalise(raw: str) -> str:
    """Collapse formatting. Does not invent a country code."""
    cleaned = re.sub(r"[^0-9+]", "", raw or "")
    if cleaned.count("+") > 1 or ("+" in cleaned and not cleaned.startswith("+")):
        return ""
    return cleaned


def is_dialable(phone: str) -> bool:
    return bool(E164.match(phone or ""))


# Per-process salt for candidate identifiers. A phone number has far too little
# entropy to hash bare, so the id is salted; the salt never leaves this process
# and both /analyze and the proposal that follows it run inside the same one.
_ID_SALT = secrets.token_bytes(16)


def candidate_id(number: str) -> str:
    """An opaque, collision-free handle for one exact number.

    The masked label cannot serve as the identifier. Two different numbers that
    share a country code, a length and their last two digits mask to the same
    string, so keying on it made the second number silently overwrite the first
    and the caller dialled a destination the user had not chosen.
    """
    return hashlib.sha256(_ID_SALT + number.encode("utf-8")).hexdigest()[:16]


@dataclass
class Candidate:
    """A phone number found in the thread, with where it came from."""

    id: str               # opaque handle; what a client refers to
    masked: str           # for display only, and deliberately ambiguous
    dialable: bool
    reason: str           # "" when dialable, else why it cannot be used
    message_index: int
    sender: str
    context: str          # the line it appeared on, itself masked

    def to_dict(self) -> dict:
        return asdict(self)


def find_candidates(thread: Thread) -> tuple[list[Candidate], dict[str, str]]:
    """Return (candidates, id->number).

    The plain number never leaves in the candidate list. Callers refer to a
    number by its opaque id and look it up in the private mapping, so an API
    response or a log line cannot carry a full destination by accident -- and
    because the id is derived from the exact number rather than from its masked
    label, two numbers that display alike still resolve to different rows.
    """
    candidates: list[Candidate] = []
    lookup: dict[str, str] = {}
    seen: set[str] = set()

    for message in thread.messages:
        if message.from_me:
            continue  # we call the other party, never ourselves
        for line in (message.body or "").splitlines():
            if _NOT_A_PHONE.search(line):
                continue
            for match in _CANDIDATE.finditer(line):
                number = normalise(match.group(1))
                digits = re.sub(r"[^0-9]", "", number)
                if len(digits) < 7 or number in seen:
                    continue
                seen.add(number)

                if not number.startswith("+"):
                    reason = "no country code in the message; type the full +number to use it"
                    dialable = False
                elif not is_dialable(number):
                    reason = "not a valid E.164 number"
                    dialable = False
                else:
                    reason = ""
                    dialable = True

                handle = candidate_id(number)
                if dialable:
                    lookup[handle] = number
                candidates.append(Candidate(
                    id=handle,
                    masked=mask(number),
                    dialable=dialable,
                    reason=reason,
                    message_index=message.index,
                    sender=message.sender,
                    context=mask_text(line.strip())[:120],
                ))
    return candidates, lookup


def accept_typed(raw: str) -> tuple[str, str]:
    """Validate a number the user typed in. Returns (number, error)."""
    number = normalise(raw)
    if not number:
        return "", "Enter a number in international format, starting with +."
    if not is_dialable(number):
        return "", "That is not a valid international number. Expected +<country code><number>."
    return number, ""
