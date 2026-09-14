"""Centralized safety gates for the calling path.

Every guard reviewers asked for lives here: E.164 syntax validation,
region-aware live-destination checks, fictional-number-block rejection,
MCP origin pinning, and operator authorization. Nothing in this module
is operator-tunable; enforcement is code.
"""
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# ASCII-strict on purpose: \d would also match Unicode decimal digits
# (fullwidth, Arabic-Indic, Devanagari), which are not valid E.164.
E164_RE = re.compile(r"\+[1-9][0-9]{6,14}")

# region -> (calling code, min national digits, max national digits)
REGION_CALLING_CODES: dict[str, tuple[str, int, int]] = {
    "VN": ("+84", 9, 10),
    "SG": ("+65", 8, 8),
    "US": ("+1", 10, 10),
    "CA": ("+1", 10, 10),
}

ALLOWED_ORIGINS = {"https://seleven-mcp-sg.airudder.com"}


class SafetyViolation(RuntimeError):
    """A safety gate refused something; the message explains which and why."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def mask_phone(phone: str) -> str:
    digits = phone.lstrip("+")
    return "+" + "*" * max(len(digits) - 2, 0) + digits[-2:]


# A phone-like run: optional leading "+", then digits joined by the common
# grouping separators (including comma/slash grouping). Only runs of seven
# or more digits are masked, so ordinary small numbers (party sizes, times)
# survive sanitization.
_PHONE_LIKE_RE = re.compile(r"\+?\d[\d\-.\s(),/]*")


def sanitize_text(text: str | None) -> str:
    """Mask every phone-like digit run (7+ digits) down to its last two digits.

    The boundary guard for anything printed or persisted: provider
    summaries, provider errors, and our own destination references.
    """
    if not text:
        return text or ""

    def mask_run(match: re.Match) -> str:
        fragment = match.group(0)
        if sum(character.isdigit() for character in fragment) < 7:
            return fragment
        keep = 2
        characters: list[str] = []
        for character in reversed(fragment):
            if character.isdigit():
                if keep > 0:
                    keep -= 1
                else:
                    character = "*"
            characters.append(character)
        return "".join(reversed(characters))

    return _PHONE_LIKE_RE.sub(mask_run, text)


def validate_phone_syntax(phone: str) -> None:
    # fullmatch rejects trailing newlines that "$" would otherwise tolerate.
    if not E164_RE.fullmatch(phone):
        raise SafetyViolation("INVALID_E164", mask_phone(phone))


def _is_fictional_nanp(phone: str) -> bool:
    digits = phone[1:]
    if not digits.startswith("1"):
        return False
    national = digits[1:]
    if national.startswith("555"):
        return True
    return (
        len(national) == 10
        and national[3:6] == "555"
        and "0100" <= national[6:] <= "0199"
    )


def validate_destination(phone: str, *, region: str | None, live: bool) -> None:
    validate_phone_syntax(phone)
    if not live:
        return
    specs = REGION_CALLING_CODES.get((region or "").upper())
    if specs is None:
        raise SafetyViolation(
            "UNSUPPORTED_REGION",
            f"{region}; supported: {', '.join(sorted(REGION_CALLING_CODES))}",
        )
    calling_code, min_len, max_len = specs
    if not phone.startswith(calling_code):
        raise SafetyViolation(
            "REGION_MISMATCH", f"{mask_phone(phone)} does not start with {calling_code}"
        )
    national = phone[len(calling_code):]
    # Fictional check runs before the length check so short sample forms
    # like +15550101 are reported as FICTIONAL_NUMBER, not INVALID_LENGTH.
    if _is_fictional_nanp(phone):
        raise SafetyViolation(
            "FICTIONAL_NUMBER",
            f"{mask_phone(phone)} is a reserved fictional NANP number "
            "and can never be dialed live",
        )
    if not min_len <= len(national) <= max_len:
        raise SafetyViolation(
            "INVALID_LENGTH",
            f"{mask_phone(phone)}: {len(national)} digits after {calling_code}, "
            f"expected {min_len}-{max_len}",
        )


def validate_origin(base_url: str) -> None:
    if base_url.rstrip("/") not in ALLOWED_ORIGINS:
        raise SafetyViolation(
            "ORIGIN_NOT_ALLOWED",
            f"{base_url}; allowed: {', '.join(sorted(ALLOWED_ORIGINS))}",
        )


def load_authorizations(path: str | Path) -> dict[str, dict]:
    authorizations: dict[str, dict] = {}
    with open(path, "r", encoding="utf-8") as handle:
        for lineno, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
                phone = row["phone"]
            except (json.JSONDecodeError, KeyError) as error:
                raise SafetyViolation(
                    "INVALID_AUTHORIZATION_FILE", f"{path}: line {lineno}: {error}"
                ) from error
            if phone in authorizations:
                raise SafetyViolation("DUPLICATE_AUTHORIZATION", mask_phone(phone))
            authorizations[phone] = row
    return authorizations


def missing_authorizations(
    phones: Iterable[str], authorizations: dict[str, dict]
) -> list[str]:
    return sorted({phone for phone in phones if phone not in authorizations})


@dataclass
class RunSafety:
    """Per-run gate bundle consulted before every dial."""

    live: bool = False
    region: str | None = None
    authorizations: dict[str, dict] = field(default_factory=dict)

    def check_destination(self, phone: str) -> None:
        if not self.live:
            return
        if self.region is None:
            raise SafetyViolation("MISSING_REGION", "live runs require --region")
        validate_destination(phone, region=self.region, live=True)
        if phone not in self.authorizations:
            raise SafetyViolation("NOT_AUTHORIZED", mask_phone(phone))
