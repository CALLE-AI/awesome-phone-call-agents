from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
MATCH_PRIORITY = {"exact": 0, "compatible": 1, "none": 2, "unknown": 3}


class PartLineError(ValueError):
    """Raised when a request is unsafe or malformed."""


@dataclass(frozen=True)
class Supplier:
    name: str
    phone: str
    region: str
    locale: str
    authorized_contact: bool
    authorization_reference: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Supplier":
        return cls(
            name=str(data.get("name", "")).strip(),
            phone=str(data.get("phone", "")).strip(),
            region=str(data.get("region", "")).strip().upper(),
            locale=str(data.get("locale", "")).strip(),
            authorized_contact=bool(data.get("authorized_contact", False)),
            authorization_reference=str(data.get("authorization_reference", "")).strip(),
        )

    def validate(self) -> None:
        if not self.name:
            raise PartLineError("Every supplier needs a name.")
        if not E164_RE.fullmatch(self.phone):
            raise PartLineError(f"{self.name}: phone must use E.164 format.")
        if len(self.region) != 2:
            raise PartLineError(f"{self.name}: region must be a two-letter country code.")
        if not self.locale:
            raise PartLineError(f"{self.name}: locale is required.")
        if not self.authorized_contact or not self.authorization_reference:
            raise PartLineError(
                f"{self.name}: a purpose-bound contact authorization reference is required."
            )


@dataclass(frozen=True)
class CallWindow:
    timezone: str
    start: str
    end: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CallWindow":
        return cls(
            timezone=str(data.get("timezone", "")).strip(),
            start=str(data.get("start", "")).strip(),
            end=str(data.get("end", "")).strip(),
        )

    def validate(self) -> None:
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as exc:
            raise PartLineError(f"Unknown call-window timezone: {self.timezone}") from exc
        for label, value in (("start", self.start), ("end", self.end)):
            try:
                datetime.strptime(value, "%H:%M")
            except ValueError as exc:
                raise PartLineError(f"Call-window {label} must use HH:MM.") from exc
        if self.start >= self.end:
            raise PartLineError("Call-window start must be earlier than end.")

    def is_open(self, now: datetime | None = None) -> bool:
        local_now = now or datetime.now(ZoneInfo(self.timezone))
        if local_now.tzinfo is None:
            local_now = local_now.replace(tzinfo=ZoneInfo(self.timezone))
        else:
            local_now = local_now.astimezone(ZoneInfo(self.timezone))
        current = local_now.strftime("%H:%M")
        return self.start <= current < self.end and local_now.weekday() < 5


@dataclass(frozen=True)
class SourcingRequest:
    request_id: str
    requester: str
    facility: str
    part_number: str
    manufacturer: str
    description: str
    quantity: int
    acceptable_alternatives: bool
    required_specs: tuple[str, ...]
    need_by: str
    call_window: CallWindow
    suppliers: tuple[Supplier, ...]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SourcingRequest":
        return cls(
            request_id=str(data.get("request_id", "")).strip(),
            requester=str(data.get("requester", "")).strip(),
            facility=str(data.get("facility", "")).strip(),
            part_number=str(data.get("part_number", "")).strip(),
            manufacturer=str(data.get("manufacturer", "")).strip(),
            description=str(data.get("description", "")).strip(),
            quantity=int(data.get("quantity", 0)),
            acceptable_alternatives=bool(data.get("acceptable_alternatives", False)),
            required_specs=tuple(str(item).strip() for item in data.get("required_specs", [])),
            need_by=str(data.get("need_by", "")).strip(),
            call_window=CallWindow.from_dict(data.get("call_window", {})),
            suppliers=tuple(Supplier.from_dict(item) for item in data.get("suppliers", [])),
        )

    @classmethod
    def load(cls, path: str) -> "SourcingRequest":
        with open(path, encoding="utf-8") as handle:
            request = cls.from_dict(json.load(handle))
        request.validate()
        return request

    def validate(self) -> None:
        required = {
            "request_id": self.request_id,
            "requester": self.requester,
            "facility": self.facility,
            "part_number": self.part_number,
            "manufacturer": self.manufacturer,
            "description": self.description,
            "need_by": self.need_by,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise PartLineError(f"Missing required fields: {', '.join(missing)}")
        if self.quantity < 1:
            raise PartLineError("Quantity must be at least one.")
        if not self.required_specs or any(not item for item in self.required_specs):
            raise PartLineError("At least one non-negotiable specification is required.")
        try:
            deadline = datetime.fromisoformat(self.need_by)
        except ValueError as exc:
            raise PartLineError("Need-by must be an ISO 8601 timestamp.") from exc
        if deadline.tzinfo is None:
            raise PartLineError("Need-by must include a UTC offset.")
        if not 1 <= len(self.suppliers) <= 5:
            raise PartLineError("Choose between one and five approved suppliers per run.")
        phones: set[str] = set()
        for supplier in self.suppliers:
            supplier.validate()
            if supplier.phone in phones:
                raise PartLineError("Duplicate supplier phone numbers are not allowed.")
            phones.add(supplier.phone)
        self.call_window.validate()


def mask_phone(phone: str) -> str:
    if len(phone) <= 6:
        return "*" * len(phone)
    return f"{phone[:3]}{'*' * (len(phone) - 5)}{phone[-2:]}"


def _canonical_request(request: SourcingRequest) -> dict[str, Any]:
    return {
        "request_id": request.request_id,
        "part_number": request.part_number,
        "manufacturer": request.manufacturer,
        "quantity": request.quantity,
        "acceptable_alternatives": request.acceptable_alternatives,
        "required_specs": list(request.required_specs),
        "need_by": request.need_by,
        "suppliers": [
            {
                "name": supplier.name,
                "phone": supplier.phone,
                "region": supplier.region,
                "locale": supplier.locale,
                "authorization_reference": supplier.authorization_reference,
            }
            for supplier in request.suppliers
        ],
    }


def _digest(request: SourcingRequest) -> str:
    canonical = json.dumps(_canonical_request(request), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def approval_token(request: SourcingRequest) -> str:
    digest = hashlib.sha256(f"partline-live-approval:{_digest(request)}".encode()).hexdigest()
    return f"PARTLINE-{digest[:12].upper()}"


def idempotency_key(request: SourcingRequest) -> str:
    return f"partline_{_digest(request)[:32]}"


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["completed_count"],
        "properties": {
            "completed_count": {"type": "integer"},
            "unresolved_count": {"type": "integer"},
        },
    }


def recipient_result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "match_status",
            "part_number_confirmed",
            "quantity_available",
            "needs_human_followup",
            "evidence_quote",
        ],
        "properties": {
            "match_status": {
                "type": "string",
                "enum": ["exact", "compatible", "none", "unknown"],
            },
            "manufacturer_confirmed": {"type": ["string", "null"]},
            "part_number_confirmed": {"type": ["string", "null"]},
            "quantity_available": {"type": ["integer", "null"]},
            "unit_price": {"type": ["number", "null"]},
            "currency": {"type": ["string", "null"]},
            "earliest_ship_date": {"type": ["string", "null"]},
            "shipping_cutoff": {"type": ["string", "null"]},
            "lead_time_days": {"type": ["integer", "null"]},
            "alternative_part_number": {"type": ["string", "null"]},
            "alternative_caveats": {"type": ["string", "null"]},
            "evidence_quote": {"type": "string"},
            "needs_human_followup": {"type": "boolean"},
        },
    }


def build_task(request: SourcingRequest) -> str:
    specs = "; ".join(request.required_specs)
    alternate_instruction = (
        "If the exact item is unavailable, ask about an alternative but do not describe it as compatible unless the supplier explicitly confirms every required specification."
        if request.acceptable_alternatives
        else "Do not ask for or accept alternatives."
    )
    return (
        "You are PartLine, an AI procurement research assistant. At the start, disclose that you are an AI assistant calling on behalf of "
        f"{request.requester} at {request.facility}. Ask only about sourcing request {request.request_id}. "
        f"Verify manufacturer {request.manufacturer}, exact part number {request.part_number}, quantity {request.quantity}, "
        f"required by {request.need_by}. Non-negotiable specifications: {specs}. {alternate_instruction} "
        "Collect current on-hand quantity, price only if the supplier volunteers or readily provides it, earliest ship date, shipping cutoff and lead time. "
        "Ask the supplier to repeat the confirmed part number. Capture one short evidence quote. "
        "Never place an order, reserve stock, negotiate, accept terms, share another supplier's information or make a purchasing commitment. "
        "If any critical answer is ambiguous, set match_status to unknown and needs_human_followup to true."
    )


def build_payload(request: SourcingRequest) -> dict[str, Any]:
    return {
        "task": build_task(request),
        "recipients": [
            {
                "phones": [supplier.phone],
                "region": supplier.region,
                "locale": supplier.locale,
            }
            for supplier in request.suppliers
        ],
        "result_schema": result_schema(),
        "recipient_result_schema": recipient_result_schema(),
        "metadata": {
            "workflow": "partline",
            "request_id": request.request_id,
            "facility": request.facility,
        },
    }


def build_plan(request: SourcingRequest) -> dict[str, Any]:
    return {
        "request_id": request.request_id,
        "purpose": f"Source {request.quantity} x {request.manufacturer} {request.part_number}",
        "call_window": {
            "timezone": request.call_window.timezone,
            "start": request.call_window.start,
            "end": request.call_window.end,
            "weekdays_only": True,
        },
        "recipients": [
            {
                "name": supplier.name,
                "phone": mask_phone(supplier.phone),
                "authorization_reference": supplier.authorization_reference,
            }
            for supplier in request.suppliers
        ],
        "side_effect": f"Places {len(request.suppliers)} outbound phone call(s).",
        "purchase_authority": "none",
        "idempotency_key": idempotency_key(request),
        "approval_token": approval_token(request),
        "task": build_task(request),
    }


def rank_results(
    call_result: dict[str, Any], request: SourcingRequest | None = None
) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for index, recipient in enumerate(call_result.get("recipients", [])):
        result = recipient.get("structured_result") or {}
        status = result.get("match_status", "unknown")
        if status not in MATCH_PRIORITY:
            status = "unknown"
        evidence = str(result.get("evidence_quote") or "").strip()
        needs_followup = bool(result.get("needs_human_followup", True))
        if request is not None and status == "exact":
            part_matches = str(result.get("part_number_confirmed") or "").casefold() == request.part_number.casefold()
            maker_matches = str(result.get("manufacturer_confirmed") or "").casefold() == request.manufacturer.casefold()
            if not part_matches or not maker_matches:
                status = "unknown"
        if not evidence or status in {"compatible", "unknown"}:
            needs_followup = True
        ranked.append(
            {
                "supplier": recipient.get("name") or f"Supplier {index + 1}",
                **result,
                "match_status": status,
                "needs_human_followup": needs_followup,
            }
        )
    return sorted(
        ranked,
        key=lambda item: (
            item["needs_human_followup"],
            MATCH_PRIORITY[item["match_status"]],
            -(item.get("quantity_available") or 0),
            item.get("lead_time_days") if item.get("lead_time_days") is not None else 10**9,
        ),
    )
