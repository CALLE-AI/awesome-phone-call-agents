from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class ContractError(ValueError):
    """Raised when an input crosses the app's closed contract."""


# Fail-closed snapshot of CALL-E's published recipient-routing table. Keeping the
# calling code beside the region prevents a supported label from being applied
# to a number in an unsupported destination (for example, +852 as MY).
REGION_CALLING_CODES = {
    "AE": "+971",
    "AU": "+61",
    "BD": "+880",
    "BR": "+55",
    "BW": "+267",
    "CA": "+1",
    "CM": "+237",
    "DE": "+49",
    "EG": "+20",
    "ES": "+34",
    "FI": "+358",
    "FR": "+33",
    "GB": "+44",
    "GH": "+233",
    "HN": "+504",
    "ID": "+62",
    "IE": "+353",
    "IL": "+972",
    "IN": "+91",
    "JP": "+81",
    "KE": "+254",
    "LK": "+94",
    "MX": "+52",
    "MY": "+60",
    "MZ": "+258",
    "NA": "+264",
    "NG": "+234",
    "NL": "+31",
    "OM": "+968",
    "PH": "+63",
    "PK": "+92",
    "PL": "+48",
    "SA": "+966",
    "SG": "+65",
    "TH": "+66",
    "TN": "+216",
    "TR": "+90",
    "TW": "+886",
    "UA": "+380",
    "US": "+1",
    "VN": "+84",
    "ZA": "+27",
}
SUPPORTED_REGIONS = frozenset(REGION_CALLING_CODES)

CHECKPOINT_KINDS = frozenset({"AIRLINE", "VETERINARY_SERVICE", "DESTINATION_AUTHORITY"})
AUTHORIZATION_BASES = frozenset(
    {"PUBLIC_OFFICIAL_INQUIRY", "CONSENTING_TEST_RECIPIENT"}
)
ANIMAL_CATEGORIES = frozenset({"CAT", "DOG", "OTHER_COMPANION_ANIMAL"})
PROPOSITION_IDS = ("P1", "P2", "P3")
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
LOCALE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
IDENTIFIER_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,63}$")

CASE_KEYS = frozenset(
    {"schema_version", "case_id", "route_label", "animal_category", "checkpoints"}
)
CHECKPOINT_KEYS = frozenset(
    {
        "checkpoint_id",
        "kind",
        "contact_label",
        "phone_e164",
        "region",
        "locale",
        "official_source_url",
        "authorization_basis",
        "authorization_note",
        "propositions",
    }
)
PROPOSITION_KEYS = frozenset({"id", "statement"})


@dataclass(frozen=True, slots=True)
class Proposition:
    id: str
    statement: str


@dataclass(frozen=True, slots=True)
class Checkpoint:
    checkpoint_id: str
    kind: str
    contact_label: str
    phone_e164: str
    region: str
    locale: str
    official_source_url: str
    authorization_basis: str
    authorization_note: str
    propositions: tuple[Proposition, Proposition, Proposition]


@dataclass(frozen=True, slots=True)
class JourneyCase:
    schema_version: str
    case_id: str
    route_label: str
    animal_category: str
    checkpoints: tuple[Checkpoint, ...]

    def checkpoint(self, checkpoint_id: str) -> Checkpoint:
        for item in self.checkpoints:
            if item.checkpoint_id == checkpoint_id:
                return item
        raise ContractError(f"Unknown checkpoint_id: {checkpoint_id}")


def load_case(path: str | Path) -> JourneyCase:
    with Path(path).open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return parse_case(raw)


def parse_case(raw: Any) -> JourneyCase:
    obj = _closed_object(raw, CASE_KEYS, "case")
    _require_equal(obj, "schema_version", "1.0", "case")
    case_id = _identifier(obj.get("case_id"), "case.case_id")
    route_label = _bounded_text(obj.get("route_label"), "case.route_label", 5, 80)
    animal_category = _enum(
        obj.get("animal_category"), ANIMAL_CATEGORIES, "case.animal_category"
    )
    checkpoints_raw = obj.get("checkpoints")
    if not isinstance(checkpoints_raw, list) or not 1 <= len(checkpoints_raw) <= 6:
        raise ContractError("case.checkpoints must contain between 1 and 6 entries")
    checkpoints = tuple(
        _parse_checkpoint(value, index) for index, value in enumerate(checkpoints_raw)
    )
    checkpoint_ids = [item.checkpoint_id for item in checkpoints]
    if len(set(checkpoint_ids)) != len(checkpoint_ids):
        raise ContractError("case.checkpoints contains duplicate checkpoint_id values")
    return JourneyCase(
        schema_version="1.0",
        case_id=case_id,
        route_label=route_label,
        animal_category=animal_category,
        checkpoints=checkpoints,
    )


def _parse_checkpoint(raw: Any, index: int) -> Checkpoint:
    label = f"case.checkpoints[{index}]"
    obj = _closed_object(raw, CHECKPOINT_KEYS, label)
    checkpoint_id = _identifier(obj.get("checkpoint_id"), f"{label}.checkpoint_id")
    kind = _enum(obj.get("kind"), CHECKPOINT_KINDS, f"{label}.kind")
    contact_label = _bounded_text(
        obj.get("contact_label"), f"{label}.contact_label", 3, 80
    )
    phone_e164 = obj.get("phone_e164")
    if not isinstance(phone_e164, str) or not E164_RE.fullmatch(phone_e164):
        raise ContractError(f"{label}.phone_e164 must be an exact E.164 number")
    region = _enum(obj.get("region"), SUPPORTED_REGIONS, f"{label}.region")
    expected_calling_code = REGION_CALLING_CODES.get(region)
    if expected_calling_code is None or not phone_e164.startswith(
        expected_calling_code
    ):
        raise ContractError(
            f"{label}.phone_e164 country calling code must match {label}.region"
        )
    locale = obj.get("locale")
    if not isinstance(locale, str) or not LOCALE_RE.fullmatch(locale):
        raise ContractError(f"{label}.locale must look like en or en-US")
    source = _https_url(obj.get("official_source_url"), f"{label}.official_source_url")
    basis = _enum(
        obj.get("authorization_basis"),
        AUTHORIZATION_BASES,
        f"{label}.authorization_basis",
    )
    note = _bounded_text(
        obj.get("authorization_note"), f"{label}.authorization_note", 12, 240
    )
    propositions_raw = obj.get("propositions")
    if not isinstance(propositions_raw, list) or len(propositions_raw) != 3:
        raise ContractError(
            f"{label}.propositions must contain exactly 3 frozen propositions"
        )
    propositions = tuple(
        _parse_proposition(value, label, i) for i, value in enumerate(propositions_raw)
    )
    if tuple(item.id for item in propositions) != PROPOSITION_IDS:
        raise ContractError(f"{label}.propositions IDs must be P1, P2, P3 in order")
    return Checkpoint(
        checkpoint_id=checkpoint_id,
        kind=kind,
        contact_label=contact_label,
        phone_e164=phone_e164,
        region=region,
        locale=locale,
        official_source_url=source,
        authorization_basis=basis,
        authorization_note=note,
        propositions=propositions,  # type: ignore[arg-type]
    )


def _parse_proposition(raw: Any, parent: str, index: int) -> Proposition:
    label = f"{parent}.propositions[{index}]"
    obj = _closed_object(raw, PROPOSITION_KEYS, label)
    proposition_id = _enum(obj.get("id"), frozenset(PROPOSITION_IDS), f"{label}.id")
    statement = _bounded_text(obj.get("statement"), f"{label}.statement", 12, 240)
    return Proposition(id=proposition_id, statement=statement)


def mask_phone(phone: str) -> str:
    if not E164_RE.fullmatch(phone):
        raise ContractError("Cannot mask an invalid E.164 phone number")
    visible = phone[-4:]
    return f"{phone[:2]}{'*' * max(4, len(phone) - 6)}{visible}"


def _closed_object(raw: Any, expected: frozenset[str], label: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ContractError(f"{label} must be an object")
    actual = frozenset(raw)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        raise ContractError(f"{label} keys mismatch; missing={missing}, extra={extra}")
    return raw


def _require_equal(obj: dict[str, Any], key: str, expected: str, label: str) -> None:
    if obj.get(key) != expected:
        raise ContractError(f"{label}.{key} must be {expected!r}")


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        raise ContractError(
            f"{label} must be 3-64 uppercase letters, numbers, underscores, or hyphens"
        )
    return value


def _bounded_text(value: Any, label: str, minimum: int, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or not minimum <= len(value) <= maximum
    ):
        raise ContractError(
            f"{label} must be trimmed text of length {minimum}-{maximum}"
        )
    if any(character in value for character in ("\r", "\n", "\x00")):
        raise ContractError(f"{label} must be one line")
    return value


def _enum(value: Any, allowed: frozenset[str], label: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ContractError(f"{label} must be one of {sorted(allowed)}")
    return value


def _https_url(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) > 300:
        raise ContractError(f"{label} must be a short HTTPS URL")
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
    ):
        raise ContractError(
            f"{label} must be an HTTPS URL without embedded credentials"
        )
    return value
