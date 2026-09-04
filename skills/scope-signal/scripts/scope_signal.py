#!/usr/bin/env python3
"""Offline, fail-closed preview and reconciliation for Scope Signal.

This module deliberately contains no provider client or networking code. It compiles
one frozen call request, or reconciles a completed fixture using exact callee quotes.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable


class ValidationError(ValueError):
    """A safe validation failure that never includes input data or file paths."""


SCHEMA_VERSION = "2.0"
AUTH_PURPOSE = "Verify the project brief for human review."
AUTH_TYPES = {"explicit_request", "explicit_consent"}
AUTH_SOURCES = {
    "direct_user_request",
    "contact_written_consent",
    "contact_verbal_consent",
    "signed_project_agreement",
}
INPUT_KEYS = {
    "schema_version", "request_id", "freelancer_name", "contact",
    "authorization", "project_summary", "known_context", "language", "region",
}
CONTACT_KEYS = {"name", "organization", "phone_e164"}
AUTH_KEYS = {"authorization_type", "authorized_by", "authorized_at", "purpose", "source"}
FIELDS = (
    "contact_identity", "contact_role", "decision_authority", "deliverables",
    "exclusions", "budget_range_currency", "payment_method",
    "funding_or_deposit_status", "payment_timing", "deadline_timezone",
    "access_prerequisites", "acceptance_criteria", "unresolved_risks",
)
REQUIRED_FIELDS = FIELDS[:-1]
TERMINAL_STATUSES = {
    "COMPLETED", "FAILED", "NO_ANSWER", "DECLINED", "CANCELED", "CANCELLED",
    "VOICEMAIL", "BUSY", "EXPIRED",
}
FIXTURE_KEYS = {
    "schema_version", "approval_digest", "idempotency_key", "status", "run_id",
    "transcript", "result",
}
AMBIGUOUS = {"", "unknown", "not stated", "unsure", "n/a", "none provided"}

PHONE_RE = re.compile(r"(?<!\w)\+?\d(?:[\s().-]*\d){7,14}(?!\w)")
EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
ACCOUNT_RE = re.compile(r"(?<!\w)(?:\d[\s/:-]?){9,}\d(?!\w)")
ALNUM_ACCOUNT_RE = re.compile(
    r"(?i)(?<!\w)(?=[A-Z0-9_-]{16,}(?!\w))(?=[A-Z0-9_-]*[A-Z])"
    r"(?=(?:[A-Z0-9_-]*\d){4})[A-Z0-9_-]+"
)
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LANGUAGE_RE = re.compile(r"^[A-Za-z][A-Za-z .-]{1,39}$")
REGION_RE = re.compile(r"^[A-Za-z][A-Za-z .-]{1,39}$")
SENSITIVE_WORDS = re.compile(
    r"(?i)\b(password|passcode|authentication code|one[- ]time code|cvv|card number|"
    r"bank account number|routing number|social security|government id|private key|seed phrase)\b"
)
REFUSAL_RE = re.compile(r"(?i)\b(refuse|do not call|don't call|stop calling|will not verify|won't verify)\b")
UNKNOWN_RE = re.compile(r"(?i)\b(?:do not know|don't know|unknown|not (?:yet )?(?:known|stated|decided|confirmed)|unsure|unclear|tbd)\b")
CONDITIONAL_RE = re.compile(r"(?i)\b(?:if|after|once|when|subject to|conditional|contingent|pending|will be|ready to|future|approval|signature)\b")
CONTEXT_DENIAL_RE = re.compile(
    r"(?i)(?:\b(?:false|not true|incorrect)\s+that\b|\b(?:deny|denies|denied)\s+that\b|"
    r"\b(?:every|all)\b.{0,80}\b(?:statement|sentence|claim|fact)s?\b.{0,40}\bfalse\b)"
)
EXECUTION_CONTROLS = {
    "approval_required": True,
    "attempt_limit": 1,
    "automatic_retries": False,
    "recurring": False,
    "provider_workflow": ["plan_call", "run_call", "get_call_run"],
    "approval_instruction": "Approve this exact digest before one external run_call.",
}


def _closed(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValidationError(f"{label} must be a closed object with exactly the documented fields")
    return value


def _text(value: Any, label: str, minimum: int = 1, maximum: int = 1000) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{label} must be text")
    normalized = " ".join(value.split())
    if not minimum <= len(normalized) <= maximum:
        raise ValidationError(f"{label} has an invalid length")
    if (SENSITIVE_WORDS.search(normalized) or EMAIL_RE.search(normalized)
            or PHONE_RE.search(normalized) or ACCOUNT_RE.search(normalized)
            or ALNUM_ACCOUNT_RE.search(normalized)):
        raise ValidationError(f"{label} contains prohibited sensitive data")
    return normalized


def _parse_time(value: Any) -> str:
    text = _text(value, "authorization.authorized_at", 20, 40)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("authorization.authorized_at must be an ISO8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValidationError("authorization.authorized_at must include a timezone")
    now = datetime.now(timezone.utc)
    instant = parsed.astimezone(timezone.utc)
    if instant > now + timedelta(minutes=5) or instant < now - timedelta(days=90):
        raise ValidationError("authorization.authorized_at must be recent and not in the future")
    return instant.isoformat().replace("+00:00", "Z")


def validate_input(raw: Any) -> dict[str, Any]:
    data = _closed(copy.deepcopy(raw), INPUT_KEYS, "input")
    if data["schema_version"] != SCHEMA_VERSION:
        raise ValidationError(f"schema_version must be {SCHEMA_VERSION}")
    request_id = _text(data["request_id"], "request_id", 3, 80)
    if not ID_RE.fullmatch(request_id):
        raise ValidationError("request_id must be lowercase kebab-case")
    contact = _closed(data["contact"], CONTACT_KEYS, "contact")
    phone = contact["phone_e164"]
    if not isinstance(phone, str) or not E164_RE.fullmatch(phone):
        raise ValidationError("contact.phone_e164 must be E.164")
    authorization = _closed(data["authorization"], AUTH_KEYS, "authorization")
    if authorization["authorization_type"] not in AUTH_TYPES:
        raise ValidationError("authorization.authorization_type is not allowed")
    if authorization["source"] not in AUTH_SOURCES:
        raise ValidationError("authorization.source is not allowed")
    if authorization["purpose"] != AUTH_PURPOSE:
        raise ValidationError("authorization.purpose must exactly match the project-verification purpose")
    normalized_auth = {
        "authorization_type": authorization["authorization_type"],
        "authorized_by": _text(authorization["authorized_by"], "authorization.authorized_by", 2, 120),
        "authorized_at": _parse_time(authorization["authorized_at"]),
        "purpose": AUTH_PURPOSE,
        "source": authorization["source"],
    }
    context = data["known_context"]
    if not isinstance(context, list) or len(context) > 20:
        raise ValidationError("known_context must be a bounded list")
    normalized_context = [_text(item, "known_context item", 1, 500) for item in context]
    language = _text(data["language"], "language", 2, 40)
    region = _text(data["region"], "region", 2, 40)
    if not LANGUAGE_RE.fullmatch(language):
        raise ValidationError("language must be a plain language name")
    if not REGION_RE.fullmatch(region):
        raise ValidationError("region must be a plain region name")
    return {
        "schema_version": SCHEMA_VERSION,
        "request_id": request_id,
        "freelancer_name": _text(data["freelancer_name"], "freelancer_name", 2, 120),
        "contact": {
            "name": _text(contact["name"], "contact.name", 2, 120),
            "organization": _text(contact["organization"], "contact.organization", 2, 160),
            "phone_e164": phone,
        },
        "authorization": normalized_auth,
        "project_summary": _text(data["project_summary"], "project_summary", 10, 1000),
        "known_context": normalized_context,
        "language": language,
        "region": region,
    }


def mask_phone(phone: str) -> str:
    if not E164_RE.fullmatch(phone):
        return "[REDACTED_PHONE]"
    return phone[:3] + "*" * max(3, len(phone) - 7) + phone[-4:]


def redact(value: Any) -> str:
    text = str(value)
    text = EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = PHONE_RE.sub("[REDACTED_PHONE]", text)
    text = ACCOUNT_RE.sub("[REDACTED_NUMBER]", text)
    return ALNUM_ACCOUNT_RE.sub("[REDACTED_ACCOUNT]", text)


def _result_schema() -> dict[str, Any]:
    return {
        "type": "object", "additionalProperties": False, "required": list(FIELDS),
        "properties": {
            field: {
                "type": "object", "additionalProperties": False,
                "required": ["value", "quote"],
                "properties": {"value": {"type": "string"}, "quote": {"type": "string"}},
            } for field in FIELDS
        },
    }


def _task(data: dict[str, Any]) -> str:
    facts = ", ".join(field.replace("_", " ") for field in FIELDS)
    context = "; ".join(data["known_context"]) or "none supplied"
    return (
        f"Make one verification call as an automated assistant for {data['freelancer_name']}. "
        f"First confirm you reached {data['contact']['name']} at {data['contact']['organization']}; "
        "if not, disclose no project details and end. Explain that nothing is accepted or committed. "
        f"Verify only this project: {data['project_summary']} Known context: {context}. "
        f"Collect exact callee quotes for: {facts}. Do not negotiate, accept, request credentials, "
        "or infer answers. Honor refusal immediately. End by returning details for human review."
    )


def _frozen(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION, "recipient": data["contact"]["phone_e164"],
        "request_id": data["request_id"], "authorization": data["authorization"],
        "task": _task(data), "result_schema": _result_schema(),
        "project_summary": data["project_summary"], "known_context": data["known_context"],
        "contact_name": data["contact"]["name"],
        "contact_organization": data["contact"]["organization"],
        "language": data["language"], "region": data["region"],
        "execution_controls": copy.deepcopy(EXECUTION_CONTROLS),
    }


def _digest(frozen: dict[str, Any]) -> tuple[str, str]:
    encoded = json.dumps(frozen, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    hexdigest = hashlib.sha256(encoded).hexdigest()
    return "sha256:" + hexdigest, "scope-signal:" + hexdigest[:32]


def build_preview(raw: Any) -> dict[str, Any]:
    data = validate_input(raw)
    frozen = _frozen(data)
    digest, key = _digest(frozen)
    auth = data["authorization"]
    return {
        "schema_version": SCHEMA_VERSION, "mode": "preview", "call_placed": False,
        "request_id": data["request_id"],
        "contact": {"name": redact(data["contact"]["name"]),
                    "organization": redact(data["contact"]["organization"]),
                    "phone_masked": mask_phone(data["contact"]["phone_e164"])},
        "authorization_summary": {
            "authorization_type": auth["authorization_type"],
            "authorized_by": redact(auth["authorized_by"]), "authorized_at": auth["authorized_at"],
            "purpose": auth["purpose"], "source": auth["source"],
        },
        "task": redact(frozen["task"]), "result_schema": frozen["result_schema"],
        "language": data["language"], "region": data["region"],
        "approval_digest": digest, "idempotency_key": key,
        **copy.deepcopy(EXECUTION_CONTROLS),
        "notice": "No call was placed. Final decisions remain with a human.",
    }


def build_handoff(raw: Any, approved_digest: str) -> dict[str, Any]:
    data = validate_input(raw)
    frozen = _frozen(data)
    digest, key = _digest(frozen)
    if approved_digest != digest:
        raise ValidationError("approved digest does not exactly match the frozen preview")
    return {
        "schema_version": SCHEMA_VERSION, "recipient_e164": frozen["recipient"],
        "task": frozen["task"], "result_schema": frozen["result_schema"],
        "language": frozen["language"], "region": frozen["region"],
        "approval_digest": digest, "idempotency_key": key,
        **copy.deepcopy(EXECUTION_CONTROLS),
    }


def _norm(text: str) -> str:
    return " ".join(text.casefold().split())


def _substantive(quote: str) -> bool:
    return len(quote.strip()) >= 12 and len(re.findall(r"[A-Za-z0-9]+", quote)) >= 3 and not UNKNOWN_RE.search(quote)


def _extract(quote: str, pattern: str) -> str | None:
    match = re.search(pattern, quote, re.I)
    if not match:
        return None
    value = match.group(1).strip(" .,:;-")
    return redact(value) if value else None


def _identity(quote: str, data: dict[str, Any]) -> str | None:
    expected = data["contact"]["name"]
    if _norm(expected) not in _norm(quote):
        return None
    return redact(expected) if re.search(r"(?i)\b(?:i am|i'm|this is|my name is)\b", quote) else None


def _authority(quote: str, _: dict[str, Any]) -> str:
    q = _norm(quote)
    if re.search(r"\b(?:do not|don't|lack|without|no)\b.{0,25}\b(?:final )?(?:decision )?authority\b", q) or "not authorized" in q:
        return "NONE"
    if re.search(r"\b(?:need|requires?|with|joint|share|together|subject to)\b.{0,40}\b(?:approval|authority|sign.?off|decision)\b", q):
        return "SELF_PARTIAL"
    if (re.search(r"\b(?:budget|spending|technical|schedule|procurement|recommendation)\b.{0,30}\b(?:only|limited)\b", q)
            or re.search(r"\b(?:only|limited)\b.{0,30}\b(?:budget|spending|technical|schedule|procurement|recommendation)\b", q)):
        return "SELF_PARTIAL"
    if re.search(r"\b(?:i (?:have|hold)|my)\b.{0,30}\bfinal (?:project |decision )?authority\b", q) or re.search(r"\bi can make the final (?:project )?decision\b", q):
        return "SELF_FINAL"
    if re.search(r"\b(?:board|cfo|ceo|manager|client|owner|committee)\b", q) and re.search(r"\b(?:approval|approves?|decides?|decision|authority|sign.?off)\b", q):
        return "THIRD_PARTY"
    return "UNKNOWN"


def _funding(quote: str, _: dict[str, Any]) -> str:
    q = _norm(quote)
    if re.search(r"\b(?:not funded|unfunded|no funding|deposit (?:is )?not (?:paid|funded|secured))\b", q):
        return "NOT_FUNDED"
    if re.search(r"\b(?:pending|awaiting|not yet|still deciding|tbd)\b", q):
        return "PENDING"
    funded = re.search(r"\b(?:funded|deposit (?:has been|is) (?:paid|secured)|funds (?:are|have been) secured)\b", q)
    if funded and CONDITIONAL_RE.search(q):
        return "CONDITIONAL"
    return "FUNDED" if funded else "UNKNOWN"


def _risks(quote: str, _: dict[str, Any]) -> str:
    q = _norm(quote)
    if re.search(r"\b(?:no|none|there are no)\b.{0,25}\b(?:unresolved )?risks?\b", q):
        return "NONE"
    if re.search(r"\b(?:risk|risks|blocker|concern|dependency|legal review)\b", q):
        return "RISKS_PRESENT"
    return "UNKNOWN"


PARSERS: dict[str, Callable[[str, dict[str, Any]], str | None]] = {
    "contact_identity": _identity,
    "contact_role": lambda q, d: _extract(q, r"(?:i am|i'm|my role is|i serve as) (?:the |an? )?(.+?)(?:[.]|$)"),
    "decision_authority": _authority,
    "deliverables": lambda q, d: _extract(q, r"deliverables? (?:are|include|is) (.+?)(?:[.]|$)"),
    "exclusions": lambda q, d: _extract(q, r"exclusions? (?:are|include|is) (.+?)(?:[.]|$)"),
    "budget_range_currency": lambda q, d: _extract(q, r"(?:approved )?budget(?: range)? (?:is|of) (.+?)(?:[.]|$)") if re.search(r"\b(?:USD|EUR|GBP|CAD|AUD|JPY|dollars?|euros?|pounds?)\b", q, re.I) and re.search(r"\d", q) else None,
    "payment_method": lambda q, d: _extract(q, r"payment (?:will be|method is|is made) (?:by|via|through)?\s*(.+?)(?:[.]|$)"),
    "funding_or_deposit_status": _funding,
    "payment_timing": lambda q, d: _extract(q, r"payment (?:timing is|is due|will be due) (.+?)(?:[.]|$)"),
    "deadline_timezone": lambda q, d: _extract(q, r"deadline is (.+?)(?:[.]|$)") if re.search(r"\b(?:time|UTC|GMT|America|Europe|Asia|Africa|Pacific|Eastern|Central|Mountain)\b", q, re.I) else None,
    "access_prerequisites": lambda q, d: _extract(q, r"(?:access prerequisites? (?:are|include)|we must provide|prerequisites? (?:are|include)) (.+?)(?:[.]|$)"),
    "acceptance_criteria": lambda q, d: _extract(q, r"(?:acceptance (?:criteria )?(?:are|require|requires)|acceptance requires) (.+?)(?:[.]|$)"),
    "unresolved_risks": _risks,
}


def _consistent(field: str, supplied: str, derived: str) -> bool:
    supplied_norm = _norm(supplied)
    semantic_supplied = supplied_norm.replace("_", " ").replace("-", " ")
    if supplied_norm in AMBIGUOUS:
        return False
    if supplied_norm == derived.casefold():
        return True
    if derived == "FUNDED" and re.search(r"\b(?:not|unfunded|pending|conditional|after|if)\b", semantic_supplied):
        return False
    if derived == "NOT_FUNDED" and not re.search(r"\b(?:not|unfunded|no funding)\b", supplied_norm):
        return False
    semantic = {
        "decision_authority": {
            "SELF_FINAL": ("final", "authority", "decision"), "SELF_PARTIAL": ("partial", "joint", "shared"),
            "THIRD_PARTY": ("third", "board", "cfo", "other"), "NONE": ("no", "not", "none", "lack"),
        },
        "funding_or_deposit_status": {
            "FUNDED": ("funded", "paid", "secured"), "NOT_FUNDED": ("not funded", "unfunded"),
            "PENDING": ("pending", "awaiting", "not yet"), "CONDITIONAL": ("conditional", "after", "if", "subject"),
        },
        "unresolved_risks": {
            "NONE": ("none", "no unresolved", "no risk"), "RISKS_PRESENT": ("risk", "review", "concern", "blocker"),
        },
    }
    if field in semantic:
        return any(token in semantic_supplied for token in semantic[field].get(derived, ()))
    if re.search(r"\b(?:not|no|never|except|instead of|contrary)\b", supplied_norm):
        return False
    return supplied_norm == _norm(derived)


def _sentence_spans(text: str) -> list[str]:
    """Return normalized complete sentences; evidence cannot be an inner substring."""
    return [_norm(part) for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


def _empty_evidence(reason: str) -> dict[str, Any]:
    return {"verified": False, "value": "unknown", "quote": "", "reason": reason}


def reconcile(raw: Any, fixture: Any) -> dict[str, Any]:
    data = validate_input(raw)
    if not isinstance(fixture, dict) or set(fixture) != FIXTURE_KEYS:
        raise ValidationError("fixture must be a closed object with exactly the documented fields")
    preview = build_preview(data)
    if fixture.get("schema_version") != SCHEMA_VERSION:
        raise ValidationError("fixture schema_version does not match")
    if fixture.get("approval_digest") != preview["approval_digest"] or fixture.get("idempotency_key") != preview["idempotency_key"]:
        raise ValidationError("fixture binding does not match the frozen preview")
    status = fixture.get("status")
    if status not in TERMINAL_STATUSES:
        raise ValidationError("fixture status is not a recognized terminal status")
    transcript, result = fixture.get("transcript"), fixture.get("result")
    if not isinstance(transcript, list) or not isinstance(result, dict) or set(result) != set(FIELDS):
        raise ValidationError("fixture transcript or result shape is invalid")
    callee_turns: list[str] = []
    for turn in transcript:
        if not isinstance(turn, dict) or set(turn) != {"speaker", "text"} or turn["speaker"] not in {"agent", "callee"} or not isinstance(turn["text"], str):
            raise ValidationError("fixture transcript contains an invalid turn")
        if turn["speaker"] == "callee":
            callee_turns.append(turn["text"])
    refused = any(REFUSAL_RE.search(text) for text in callee_turns)
    evidence: dict[str, dict[str, Any]] = {}
    quote_owners: dict[str, list[str]] = {}
    if status != "COMPLETED":
        evidence = {field: _empty_evidence("call status was not COMPLETED") for field in FIELDS}
    else:
        for field in FIELDS:
            item = result[field]
            if not isinstance(item, dict) or set(item) != {"value", "quote"} or not all(isinstance(item[k], str) for k in item):
                raise ValidationError("fixture result contains an invalid evidence item")
            quote, supplied = " ".join(item["quote"].split()), " ".join(item["value"].split())
            if quote:
                quote_owners.setdefault(_norm(quote), []).append(field)
            if not _substantive(quote):
                evidence[field] = _empty_evidence("quote is missing, ambiguous, or not substantive")
                continue
            normalized_quote = _norm(quote)
            matching_turns = [turn for turn in callee_turns if normalized_quote in _sentence_spans(turn)]
            if len(matching_turns) != 1:
                evidence[field] = _empty_evidence("quote is not one complete sentence from exactly one callee turn")
                continue
            if CONTEXT_DENIAL_RE.search(matching_turns[0]):
                evidence[field] = _empty_evidence("callee turn contains a broad denial or false-context marker")
                continue
            derived = PARSERS[field](quote, data)
            if not derived or derived == "UNKNOWN":
                evidence[field] = _empty_evidence("quote lacks the field-specific evidence marker")
                continue
            if not _consistent(field, supplied, derived):
                evidence[field] = _empty_evidence("structured value contradicts or is unsupported by the quote")
                continue
            evidence[field] = {"verified": True, "value": redact(derived), "quote": redact(quote), "reason": "derived from one exact callee quote"}
        for owners in quote_owners.values():
            if len(owners) > 1:
                for field in owners:
                    evidence[field] = _empty_evidence("the same quote was reused for unrelated fields")

    identity_ok = evidence["contact_identity"]["verified"]
    authority = evidence["decision_authority"]["value"]
    funding = evidence["funding_or_deposit_status"]["value"]
    risks = evidence["unresolved_risks"]["value"]
    if status != "COMPLETED":
        recommendation, reasons = "NO-GO", ["The call did not complete; no facts were verified."]
    elif refused:
        recommendation, reasons = "NO-GO", ["The callee refused verification or requested no further calls."]
    elif not identity_ok:
        recommendation, reasons = "NO-GO", ["The intended callee identity was not verified."]
    elif authority != "SELF_FINAL":
        recommendation, reasons = "NO-GO", ["The callee did not establish sole, final decision authority."]
    elif all(evidence[field]["verified"] for field in REQUIRED_FIELDS) and funding == "FUNDED" and evidence["unresolved_risks"]["verified"] and risks == "NONE":
        recommendation, reasons = "GO", ["All required facts have explicit callee evidence, funding is unconditional, and no unresolved risks were stated."]
    else:
        recommendation, reasons = "CAUTION", ["One or more required facts, unconditional funding, or the absence of unresolved risks was not verified."]
    verified = [f"{field}: {redact(item['value'])}" for field, item in evidence.items() if item["verified"]]
    unresolved = [field for field in REQUIRED_FIELDS if not evidence[field]["verified"]]
    return {
        "schema_version": SCHEMA_VERSION, "mode": "reconciled", "request_id": data["request_id"],
        "contact": {"phone_masked": mask_phone(data["contact"]["phone_e164"])}, "status": status,
        "evidence": evidence,
        "brief": {
            "recommendation": recommendation, "reasons": reasons, "verified_facts": verified,
            "unresolved_facts": unresolved,
            "unresolved_risks": redact(risks if evidence["unresolved_risks"]["verified"] else "UNKNOWN"),
            "final_decision_owner": "human",
            "decision_notice": f"{recommendation} describes evidence completeness only. A human must accept or reject the project.",
        },
    }


def _read_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValidationError("could not read a valid JSON input file") from exc


def _write_json(path: str, payload: Any, sensitive: bool = False) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if sensitive else 0o644)
    try:
        if sensitive:
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline Scope Signal preview and reconciliation")
    sub = parser.add_subparsers(dest="command")
    preview = sub.add_parser("preview")
    preview.add_argument("--input", required=True)
    preview.add_argument("--output")
    reconcile_parser = sub.add_parser("reconcile")
    reconcile_parser.add_argument("--input", required=True)
    reconcile_parser.add_argument("--fixture", required=True)
    reconcile_parser.add_argument("--output")
    handoff = sub.add_parser("handoff")
    handoff.add_argument("--input", required=True)
    handoff.add_argument("--approved-digest", required=True)
    handoff.add_argument("--output", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "preview":
            payload = build_preview(_read_json(args.input))
            if args.output:
                _write_json(args.output, payload)
            else:
                json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
                sys.stdout.write("\n")
        elif args.command == "reconcile":
            payload = reconcile(_read_json(args.input), _read_json(args.fixture))
            if args.output:
                _write_json(args.output, payload)
            else:
                json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
                sys.stdout.write("\n")
        elif args.command == "handoff":
            payload = build_handoff(_read_json(args.input), args.approved_digest)
            _write_json(args.output, payload, sensitive=True)
            json.dump({"mode": "handoff-written", "call_placed": False, "output_written": True,
                       "notice": "Sensitive handoff written with mode 0600; no call was placed."}, sys.stdout)
            sys.stdout.write("\n")
        else:
            parser.error("a command is required")
        return 0
    except ValidationError as exc:
        print(f"scope-signal: {exc}", file=sys.stderr)
        return 2
    except OSError:
        print("scope-signal: could not write the requested output file", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
