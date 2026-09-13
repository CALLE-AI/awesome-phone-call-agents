from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


APP_NAME = "RolloffScope"
SCHEMA_VERSION = "2.0"
OFFICIAL_BASE_URL = "https://api.heycall-e.com"
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$")
COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
LOCALE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
TWO_PLACES = Decimal("0.01")

FEE_COMPONENTS = ("delivery_fee", "pickup_fee", "fuel_fee", "environmental_fee")
FEE_STATUSES = {"included", "additional", "none", "unknown"}
OUTCOMES = {"quoted", "unavailable", "voicemail", "refused", "callback_needed", "unknown"}
OVERAGE_STATUSES = {"quoted", "not_applicable", "unknown"}
PERMIT_REQUIREMENTS = {"required", "not_required", "unknown"}
PERMIT_RESPONSIBILITIES = {"vendor", "customer", "not_applicable", "unknown"}
PROHIBITED_STATUSES = {"provided", "none", "unknown"}
TAX_STATUSES = {"included", "additional", "exempt", "unknown"}
AVAILABILITY_STATUSES = {"available", "unavailable", "unknown"}

REQUIRED_QUOTED_FIELDS = (
    "scope_match",
    "base_rental_amount",
    "currency",
    "delivery_fee_amount",
    "delivery_fee_status",
    "pickup_fee_amount",
    "pickup_fee_status",
    "rental_days_included",
    "included_tonnage",
    "overage_per_ton_amount",
    "overage_status",
    "fuel_fee_amount",
    "fuel_fee_status",
    "environmental_fee_amount",
    "environmental_fee_status",
    "permit_requirement",
    "permit_responsibility",
    "permit_fee_amount",
    "permit_fee_status",
    "prohibited_materials_status",
    "prohibited_materials",
    "tax_amount",
    "tax_status",
    "availability",
    "earliest_delivery",
    "quote_valid_until",
    "assumptions",
    "contradictions",
    "evidence",
)

FACT_FIELDS = (
    "outcome",
    "scope_match",
    "base_rental_amount",
    "currency",
    "delivery_fee_amount",
    "delivery_fee_status",
    "pickup_fee_amount",
    "pickup_fee_status",
    "rental_days_included",
    "included_tonnage",
    "overage_per_ton_amount",
    "overage_status",
    "fuel_fee_amount",
    "fuel_fee_status",
    "environmental_fee_amount",
    "environmental_fee_status",
    "permit_requirement",
    "permit_responsibility",
    "permit_fee_amount",
    "permit_fee_status",
    "prohibited_materials_status",
    "prohibited_materials",
    "tax_amount",
    "tax_status",
    "availability",
    "earliest_delivery",
    "quote_valid_until",
    "assumptions",
)


class RequestValidationError(ValueError):
    pass


def _text(value: Any, field: str, max_length: int = 240) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RequestValidationError(f"{field} is required")
    result = value.strip()
    if len(result) > max_length:
        raise RequestValidationError(f"{field} must be {max_length} characters or fewer")
    return result


def _bounded_number(value: Any, field: str, low: Decimal, high: Decimal) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise RequestValidationError(f"{field} must be numeric")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise RequestValidationError(f"{field} must be numeric") from exc
    if not result.is_finite() or result < low or result > high:
        raise RequestValidationError(f"{field} is outside the allowed range")
    return result


def _aware_datetime(value: Any, field: str) -> str:
    text = _text(value, field, 64)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RequestValidationError(f"{field} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise RequestValidationError(f"{field} must include a UTC offset")
    return text


def validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestValidationError("request must be a JSON object")

    request_id = _text(value.get("request_id"), "request_id", 80)
    if not ID_RE.fullmatch(request_id):
        raise RequestValidationError("request_id contains unsupported characters")

    scope_raw = value.get("scope")
    if not isinstance(scope_raw, dict):
        raise RequestValidationError("scope must be an object")
    size = _bounded_number(scope_raw.get("container_size_cubic_yards"), "scope.container_size_cubic_yards", Decimal("4"), Decimal("50"))
    if size != size.to_integral_value():
        raise RequestValidationError("scope.container_size_cubic_yards must be an integer")
    days = _bounded_number(scope_raw.get("rental_days"), "scope.rental_days", Decimal("1"), Decimal("60"))
    if days != days.to_integral_value():
        raise RequestValidationError("scope.rental_days must be an integer")
    tonnage = _bounded_number(scope_raw.get("estimated_tonnage"), "scope.estimated_tonnage", Decimal("0"), Decimal("50"))
    scope = {
        "container_size_cubic_yards": int(size),
        "waste_type": _text(scope_raw.get("waste_type"), "scope.waste_type", 180),
        "rental_days": int(days),
        "estimated_tonnage": float(tonnage),
        "placement": _text(scope_raw.get("placement"), "scope.placement", 180),
        "service_area": _text(scope_raw.get("service_area"), "scope.service_area", 180),
        "delivery_window_requested": _text(
            scope_raw.get("delivery_window_requested"), "scope.delivery_window_requested", 120
        ),
    }

    currency = _text(value.get("currency"), "currency", 3).upper()
    country_code = _text(value.get("country_code"), "country_code", 2).upper()
    locale = _text(value.get("locale"), "locale", 12)
    if not CURRENCY_RE.fullmatch(currency):
        raise RequestValidationError("currency must be a three-letter code")
    if not COUNTRY_RE.fullmatch(country_code):
        raise RequestValidationError("country_code must be a two-letter code")
    if not LOCALE_RE.fullmatch(locale):
        raise RequestValidationError("locale must look like en or en-US")

    vendors_raw = value.get("vendors")
    if not isinstance(vendors_raw, list) or not 1 <= len(vendors_raw) <= 5:
        raise RequestValidationError("vendors must contain 1 to 5 entries")
    vendors: list[dict[str, str]] = []
    for index, raw in enumerate(vendors_raw):
        if not isinstance(raw, dict):
            raise RequestValidationError(f"vendors[{index}] must be an object")
        vendor_id = _text(raw.get("vendor_id"), f"vendors[{index}].vendor_id", 80)
        if not ID_RE.fullmatch(vendor_id):
            raise RequestValidationError(f"vendors[{index}].vendor_id contains unsupported characters")
        phone = _text(raw.get("phone"), f"vendors[{index}].phone", 16)
        if not E164_RE.fullmatch(phone):
            raise RequestValidationError(f"vendors[{index}].phone must use E.164 format")
        vendors.append(
            {
                "vendor_id": vendor_id,
                "name": _text(raw.get("name"), f"vendors[{index}].name", 120),
                "phone": phone,
                "authorization_reference": _text(
                    raw.get("authorization_reference"), f"vendors[{index}].authorization_reference", 120
                ),
            }
        )
    if len({vendor["vendor_id"] for vendor in vendors}) != len(vendors):
        raise RequestValidationError("vendor_id values must be unique")
    if len({vendor["phone"] for vendor in vendors}) != len(vendors):
        raise RequestValidationError("vendor phone numbers must be unique")

    live_authorized = value.get("live_authorized", False)
    if not isinstance(live_authorized, bool):
        raise RequestValidationError("live_authorized must be a boolean")
    call_window: dict[str, str] | None = None
    if live_authorized:
        raw_window = value.get("call_window")
        if not isinstance(raw_window, dict):
            raise RequestValidationError("call_window is required for a live-authorized request")
        starts_at = _aware_datetime(raw_window.get("starts_at"), "call_window.starts_at")
        ends_at = _aware_datetime(raw_window.get("ends_at"), "call_window.ends_at")
        start_dt = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(ends_at.replace("Z", "+00:00"))
        if end_dt <= start_dt:
            raise RequestValidationError("call_window.ends_at must be after starts_at")
        call_window = {"starts_at": starts_at, "ends_at": ends_at}
    elif value.get("call_window") is not None:
        raise RequestValidationError("call_window must be null unless live_authorized is true")

    return {
        "request_id": request_id,
        "scope": scope,
        "currency": currency,
        "country_code": country_code,
        "locale": locale,
        "live_authorized": live_authorized,
        "call_window": call_window,
        "vendors": vendors,
    }


def _canonical_bytes(request: dict[str, Any]) -> bytes:
    normalized = validate_request(request)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def request_digest(request: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(request)).hexdigest()


def idempotency_key(request: dict[str, Any]) -> str:
    return f"rolloffscope-{request_digest(request)}"


def approval_token(request: dict[str, Any]) -> str:
    return f"ROLLOFFSCOPE-{request_digest(request)[:12].upper()}"


def mask_phone(phone: str) -> str:
    if not E164_RE.fullmatch(phone):
        return "masked"
    return f"{phone[:4]} {'*' * max(3, len(phone) - 7)} {phone[-3:]}"


def build_recipient_result_schema(currency: str) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "outcome": {"type": "string", "enum": sorted(OUTCOMES)},
        "scope_match": {"type": "string", "enum": ["yes", "no", "partial", "unknown"]},
        "base_rental_amount": {"type": "number", "description": "Non-negative base rental amount quoted in the requested currency."},
        "currency": {"type": "string", "enum": [currency]},
        "rental_days_included": {"type": "integer", "description": "Non-negative number of rental days included in the base quote."},
        "included_tonnage": {"type": "number", "description": "Non-negative tonnage included in the base quote."},
        "overage_per_ton_amount": {"type": "number", "description": "Non-negative amount charged for each ton over the included tonnage."},
        "overage_status": {"type": "string", "enum": sorted(OVERAGE_STATUSES)},
        "permit_requirement": {"type": "string", "enum": sorted(PERMIT_REQUIREMENTS)},
        "permit_responsibility": {"type": "string", "enum": sorted(PERMIT_RESPONSIBILITIES)},
        "permit_fee_amount": {"type": "number", "description": "Non-negative permit fee amount; use zero when none applies."},
        "permit_fee_status": {"type": "string", "enum": sorted(FEE_STATUSES)},
        "prohibited_materials_status": {"type": "string", "enum": sorted(PROHIBITED_STATUSES)},
        "prohibited_materials": {"type": "array", "items": {"type": "string"}, "description": "Materials the vendor says are prohibited for this dumpster."},
        "tax_amount": {"type": "number", "description": "Non-negative tax amount; use zero when included or exempt."},
        "tax_status": {"type": "string", "enum": sorted(TAX_STATUSES)},
        "availability": {"type": "string", "enum": sorted(AVAILABILITY_STATUSES)},
        "earliest_delivery": {"type": "string"},
        "quote_valid_until": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}, "description": "Explicit assumptions stated during the call; do not infer missing facts."},
        "contradictions": {"type": "array", "items": {"type": "string"}, "description": "Conflicting statements that prevent a reliable comparison."},
        "evidence": {
            "type": "array",
            "description": "Short recipient statements mapped only to the fields they directly support.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["fields", "statement"],
                "properties": {
                    "fields": {
                        "type": "array",
                        "items": {"type": "string", "enum": sorted(FACT_FIELDS)},
                        "description": "Result fields directly supported by this statement.",
                    },
                    "statement": {"type": "string"},
                },
            },
        },
        "notes": {"type": "string"},
    }
    for component in FEE_COMPONENTS:
        properties[f"{component}_amount"] = {
            "type": "number",
            "description": f"Non-negative {component.replace('_', ' ')} amount; use zero when none applies.",
        }
        properties[f"{component}_status"] = {"type": "string", "enum": sorted(FEE_STATUSES)}
    required = ["outcome", *REQUIRED_QUOTED_FIELDS, "notes"]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def build_call_payload(request: dict[str, Any]) -> dict[str, Any]:
    normalized = validate_request(request)
    scope = normalized["scope"]
    task = " ".join(
        [
            "You are RolloffScope, an AI calling assistant collecting a roll-off-dumpster quote for comparison.",
            "At the start, disclose that you are an AI assistant gathering information for a customer.",
            f"Ask for one {scope['container_size_cubic_yards']}-cubic-yard roll-off dumpster for {scope['waste_type']}.",
            f"The locked scope is {scope['rental_days']} rental days, estimated {scope['estimated_tonnage']} tons, {scope['placement']}, in {scope['service_area']}, with delivery requested {scope['delivery_window_requested']}.",
            f"In {normalized['currency']}, capture base rental, delivery, pickup, included days, included tonnage, overage per ton, fuel fee, environmental fee, permit requirement and responsibility, permit fee, prohibited materials, tax, availability, earliest delivery, quote validity, assumptions, and contradictions.",
            "For each non-null fact, add an evidence record naming every field that the recipient's statement supports.",
            "Do not infer a missing term. Record unknown and preserve contradictions when answers conflict.",
            "Do not haggle, book, order, reserve, accept a bid, authorize work, agree to terms, or promise payment.",
        ]
    )
    return {
        "task": task,
        "recipients": [
            {"phones": [vendor["phone"]], "region": normalized["country_code"], "locale": normalized["locale"]}
            for vendor in normalized["vendors"]
        ],
        "result_schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["recipients_contacted", "quotes_received"],
            "properties": {
                "recipients_contacted": {"type": "integer", "description": "Non-negative number of recipients reached."},
                "quotes_received": {"type": "integer", "description": "Non-negative number of recipients that provided a quote."},
            },
        },
        "recipient_result_schema": build_recipient_result_schema(normalized["currency"]),
        "metadata": {
            "workflow": "rolloffscope-rolloff-dumpster",
            "schema_version": SCHEMA_VERSION,
            "request_id": normalized["request_id"],
        },
    }


def preview_plan(request: dict[str, Any]) -> dict[str, Any]:
    normalized = validate_request(request)
    payload = build_call_payload(normalized)
    return {
        "app": APP_NAME,
        "mode": "dry_run",
        "network_attempted": False,
        "endpoint": f"POST {OFFICIAL_BASE_URL}/v1/calls",
        "request_id": normalized["request_id"],
        "locked_scope": normalized["scope"],
        "call_count": len(normalized["vendors"]),
        "live_authorized": normalized["live_authorized"],
        "approval_token": approval_token(normalized),
        "idempotency_key": idempotency_key(normalized),
        "recipients": [
            {
                "vendor_id": vendor["vendor_id"],
                "name": vendor["name"],
                "phone": mask_phone(vendor["phone"]),
                "authorization_reference": vendor["authorization_reference"],
            }
            for vendor in normalized["vendors"]
        ],
        "task": payload["task"],
        "payload_fields": list(payload.keys()),
        "result_schema": payload["result_schema"],
        "recipient_result_schema": payload["recipient_result_schema"],
        "side_effects": "No call, negotiation, booking, order, acceptance, payment promise, or network request occurred.",
    }


def _money(value: Any, field: str, reasons: list[str]) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        reasons.append(f"invalid_{field}")
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        reasons.append(f"invalid_{field}")
        return None
    if not result.is_finite() or result < 0 or result > Decimal("100000000"):
        reasons.append(f"invalid_{field}")
        return None
    return result.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _clean_string_list(value: Any, *, max_items: int = 20) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip()[:400] for item in value if isinstance(item, str) and item.strip()][:max_items]


def _parse_evidence(value: Any) -> tuple[list[dict[str, Any]], set[str]]:
    if not isinstance(value, list):
        return [], set()
    cleaned: list[dict[str, Any]] = []
    covered: set[str] = set()
    allowed = set(FACT_FIELDS)
    for item in value[:40]:
        if not isinstance(item, dict):
            continue
        statement = item.get("statement")
        fields = item.get("fields")
        if not isinstance(statement, str) or not statement.strip() or not isinstance(fields, list):
            continue
        valid_fields = sorted({field for field in fields if isinstance(field, str) and field in allowed})
        if not valid_fields:
            continue
        covered.update(valid_fields)
        cleaned.append({"fields": valid_fields, "statement": statement.strip()[:500]})
    return cleaned, covered


def _present_fact_fields(structured: dict[str, Any]) -> set[str]:
    present: set[str] = set()
    for field in FACT_FIELDS:
        if field not in structured or structured[field] is None:
            continue
        value = structured[field]
        if isinstance(value, list) and not value:
            continue
        present.add(field)
    return present


def _base_quote(vendor: dict[str, str], recipient_status: str) -> dict[str, Any]:
    return {
        "vendor_id": vendor["vendor_id"],
        "vendor_name": vendor["name"],
        "recipient_status": recipient_status,
        "classification": "unresolved",
        "base_rental_amount": None,
        "normalized_total": None,
        "currency": None,
        "missing_fields": [],
        "evidence_missing_fields": [],
        "contradictions": [],
        "reasons": [],
        "assumptions": [],
        "prohibited_materials": [],
        "evidence": [],
        "requires_human_approval": True,
        "commitment_allowed": False,
    }


def normalize_recipient_quote(request: dict[str, Any], vendor: dict[str, str], recipient: Any) -> dict[str, Any]:
    normalized_request = validate_request(request)
    if not isinstance(recipient, dict):
        quote = _base_quote(vendor, "missing")
        quote["missing_fields"] = ["recipient_result"]
        quote["reasons"] = ["missing_recipient_result"]
        return quote

    recipient_status = str(recipient.get("status", "unknown"))
    quote = _base_quote(vendor, recipient_status)
    structured = recipient.get("structured_result")
    if not isinstance(structured, dict):
        quote["missing_fields"] = ["structured_result"]
        quote["reasons"] = ["missing_structured_result"]
        return quote

    evidence, covered = _parse_evidence(structured.get("evidence"))
    quote["evidence"] = evidence
    present_facts = _present_fact_fields(structured)
    quote["evidence_missing_fields"] = sorted(present_facts - covered)
    outcome = structured.get("outcome")
    if outcome not in OUTCOMES:
        quote["classification"] = "incomplete"
        quote["reasons"] = ["invalid_outcome"]
        return quote

    if outcome != "quoted":
        quote["classification"] = "unavailable" if outcome == "unavailable" else "unresolved"
        quote["missing_fields"] = sorted(field for field in REQUIRED_QUOTED_FIELDS if field not in structured)
        reasons = [f"outcome_{outcome}"]
        if "outcome" not in covered:
            reasons.append("missing_evidence:outcome")
        quote["reasons"] = sorted(reasons)
        return quote

    missing_fields = sorted(
        field for field in REQUIRED_QUOTED_FIELDS if field not in structured or structured[field] is None
    )
    quote["missing_fields"] = missing_fields
    reasons: list[str] = [f"missing_{field}" for field in missing_fields]
    reasons.extend(f"missing_evidence:{field}" for field in quote["evidence_missing_fields"])
    if recipient_status != "completed":
        reasons.append("recipient_not_completed")
    if structured.get("scope_match") != "yes":
        reasons.append("scope_not_confirmed")
    if structured.get("currency") != normalized_request["currency"]:
        reasons.append("currency_mismatch")
    if structured.get("availability") != "available":
        reasons.append("availability_not_confirmed")

    base = _money(structured.get("base_rental_amount"), "base_rental_amount", reasons)
    if base is not None and base <= 0:
        reasons.append("base_rental_amount_not_positive")
    component_values: dict[str, Decimal | None] = {}
    for component in FEE_COMPONENTS:
        amount = _money(structured.get(f"{component}_amount"), f"{component}_amount", reasons)
        status = structured.get(f"{component}_status")
        component_values[component] = amount
        if status not in FEE_STATUSES:
            reasons.append(f"invalid_{component}_status")
        elif status == "unknown":
            reasons.append(f"{component}_unknown")
        elif status == "additional" and (amount is None or amount <= 0):
            reasons.append(f"{component}_additional_amount_missing")
        elif status == "none" and amount is not None and amount != 0:
            reasons.append(f"{component}_none_amount_conflict")

    rental_days = structured.get("rental_days_included")
    if isinstance(rental_days, bool) or not isinstance(rental_days, int) or rental_days < normalized_request["scope"]["rental_days"]:
        reasons.append("rental_days_insufficient_or_invalid")
    included_tonnage = _money(structured.get("included_tonnage"), "included_tonnage", reasons)
    overage_rate = _money(structured.get("overage_per_ton_amount"), "overage_per_ton_amount", reasons)
    overage_status = structured.get("overage_status")
    if overage_status not in OVERAGE_STATUSES:
        reasons.append("invalid_overage_status")
    elif overage_status == "unknown":
        reasons.append("overage_unknown")
    elif overage_status == "quoted" and (overage_rate is None or overage_rate <= 0):
        reasons.append("overage_rate_missing")
    elif overage_status == "not_applicable" and overage_rate is not None and overage_rate != 0:
        reasons.append("overage_not_applicable_amount_conflict")

    permit_amount = _money(structured.get("permit_fee_amount"), "permit_fee_amount", reasons)
    permit_requirement = structured.get("permit_requirement")
    permit_responsibility = structured.get("permit_responsibility")
    permit_status = structured.get("permit_fee_status")
    if permit_requirement not in PERMIT_REQUIREMENTS or permit_requirement == "unknown":
        reasons.append("permit_requirement_unknown_or_invalid")
    if permit_responsibility not in PERMIT_RESPONSIBILITIES or permit_responsibility == "unknown":
        reasons.append("permit_responsibility_unknown_or_invalid")
    if permit_status not in FEE_STATUSES or permit_status == "unknown":
        reasons.append("permit_fee_unknown_or_invalid")
    if permit_requirement == "not_required":
        if permit_responsibility != "not_applicable" or permit_status != "none" or permit_amount != Decimal("0.00"):
            reasons.append("permit_not_required_conflict")
    elif permit_requirement == "required":
        if permit_responsibility not in {"vendor", "customer"}:
            reasons.append("permit_responsibility_missing")
        if permit_status == "additional" and (permit_amount is None or permit_amount <= 0):
            reasons.append("permit_additional_amount_missing")

    prohibited_status = structured.get("prohibited_materials_status")
    prohibited = _clean_string_list(structured.get("prohibited_materials"))
    quote["prohibited_materials"] = prohibited
    if prohibited_status not in PROHIBITED_STATUSES or prohibited_status == "unknown":
        reasons.append("prohibited_materials_unknown_or_invalid")
    if prohibited_status == "provided" and not prohibited:
        reasons.append("prohibited_materials_list_missing")
    if prohibited_status == "none" and prohibited:
        reasons.append("prohibited_materials_none_conflict")

    tax_amount = _money(structured.get("tax_amount"), "tax_amount", reasons)
    tax_status = structured.get("tax_status")
    if tax_status not in TAX_STATUSES or tax_status == "unknown":
        reasons.append("tax_unknown_or_invalid")
    elif tax_status == "additional" and (tax_amount is None or tax_amount <= 0):
        reasons.append("tax_additional_amount_missing")
    elif tax_status in {"included", "exempt"} and tax_amount is not None and tax_amount != 0:
        reasons.append("tax_included_amount_conflict")

    if not isinstance(structured.get("earliest_delivery"), str) or not structured["earliest_delivery"].strip():
        reasons.append("earliest_delivery_missing")
    if not isinstance(structured.get("quote_valid_until"), str) or not structured["quote_valid_until"].strip():
        reasons.append("quote_valid_until_missing")
    assumptions = _clean_string_list(structured.get("assumptions"), max_items=12)
    quote["assumptions"] = assumptions
    if not isinstance(structured.get("assumptions"), list):
        reasons.append("assumptions_invalid")
    contradictions = _clean_string_list(structured.get("contradictions"), max_items=12)
    quote["contradictions"] = contradictions
    if not isinstance(structured.get("contradictions"), list):
        reasons.append("contradictions_invalid")
    elif contradictions:
        reasons.append("reported_contradiction")

    quote["base_rental_amount"] = format(base, ".2f") if base is not None else None
    quote["currency"] = structured.get("currency") if isinstance(structured.get("currency"), str) else None
    if reasons:
        quote["classification"] = "incomplete"
        quote["reasons"] = sorted(set(reasons))
        return quote

    assert base is not None and included_tonnage is not None and overage_rate is not None and permit_amount is not None and tax_amount is not None
    total = base
    for component in FEE_COMPONENTS:
        if structured[f"{component}_status"] == "additional":
            assert component_values[component] is not None
            total += component_values[component]
    if permit_status == "additional":
        total += permit_amount
    if tax_status == "additional":
        total += tax_amount
    expected_tonnage = Decimal(str(normalized_request["scope"]["estimated_tonnage"]))
    if overage_status == "quoted" and expected_tonnage > included_tonnage:
        total += (expected_tonnage - included_tonnage) * overage_rate

    quote["classification"] = "comparable"
    quote["normalized_total"] = format(total.quantize(TWO_PLACES, rounding=ROUND_HALF_UP), ".2f")
    quote["reasons"] = []
    return quote


def normalize_call_result(request: dict[str, Any], call_result: Any) -> dict[str, Any]:
    normalized_request = validate_request(request)
    if not isinstance(call_result, dict):
        raise ValueError("call result must be a JSON object")
    recipients = call_result.get("recipients")
    if not isinstance(recipients, list):
        recipients = []
    count_matches = len(recipients) == len(normalized_request["vendors"])
    batch_errors = [] if count_matches else ["recipient_count_mismatch"]
    quotes = [
        normalize_recipient_quote(
            normalized_request,
            vendor,
            recipients[index] if index < len(recipients) else None,
        )
        for index, vendor in enumerate(normalized_request["vendors"])
    ]
    ranked: list[dict[str, Any]] = []
    if count_matches:
        comparable = [quote for quote in quotes if quote["classification"] == "comparable"]
        comparable.sort(key=lambda quote: (Decimal(quote["normalized_total"]), quote["vendor_id"]))
        ranked = [
            {
                "rank": index + 1,
                "vendor_id": quote["vendor_id"],
                "vendor_name": quote["vendor_name"],
                "normalized_total": quote["normalized_total"],
                "currency": quote["currency"],
                "requires_human_approval": True,
            }
            for index, quote in enumerate(comparable)
        ]
    return {
        "app": APP_NAME,
        "schema_version": SCHEMA_VERSION,
        "request_id": normalized_request["request_id"],
        "locked_scope": normalized_request["scope"],
        "call_id": call_result.get("id") if isinstance(call_result.get("id"), str) else None,
        "call_status": call_result.get("status") if isinstance(call_result.get("status"), str) else "unknown",
        "batch_errors": batch_errors,
        "quotes": quotes,
        "ranked_for_human_review": ranked,
        "selection_authority": "human_only",
        "booking_order_or_acceptance_performed": False,
    }


def naive_base_price_candidate(recipient: Any) -> bool:
    if not isinstance(recipient, dict) or not isinstance(recipient.get("structured_result"), dict):
        return False
    structured = recipient["structured_result"]
    if structured.get("outcome") != "quoted":
        return False
    value = structured.get("base_rental_amount")
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value > 0
