#!/usr/bin/env python3
"""Compile a payer call task, and check the answer that comes back. Places no calls.

    python3 scripts/build_call_plan.py preview --request references/example_request.json
    python3 scripts/build_call_plan.py check   --request references/example_request.json \
                                               --result  references/example_result.json

``preview`` applies the workflow's disclosure envelope, drops every identifier the
workflow may not disclose, and prints the task text and the closed result schema.
``check`` validates a returned result locally and confirms each evidence quote
appears in the transcript, resetting anything it cannot confirm to "unknown".

Standard library only. ``calls_placed`` is always 0.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

UNKNOWN = "unknown"

# --- minimum necessary ------------------------------------------------------
ENVELOPES: Dict[str, Tuple[str, ...]] = {
    "claim_status": ("member_id", "date_of_birth", "patient_last_name"),
    "denial_reason": ("member_id", "date_of_birth", "patient_last_name"),
    "prior_auth_status": ("member_id", "date_of_birth", "patient_last_name"),
    "eligibility": ("member_id", "date_of_birth"),
}

NEVER_DISCLOSE: Tuple[str, ...] = (
    "ssn", "ssn_last4", "medical_record_number", "address_line1", "address",
    "patient_phone", "patient_email",
)

BOUNDARIES: Tuple[str, ...] = (
    "Open by stating that you are an AI assistant calling on behalf of the provider's billing "
    "office, and say so again if you are asked.",
    "State that the call may be recorded for accuracy before asking the first question.",
    "You are gathering information only. You may not agree to anything.",
    "Never file, initiate, withdraw, or escalate an appeal, reconsideration, grievance, or "
    "peer-to-peer review. If it is offered, say the billing office will follow up.",
    "Never accept, waive, negotiate, or dispute any amount, adjustment, refund, offset, or "
    "recoupment.",
    "Never agree to a corrected claim, a resubmission, a void, or any change to a claim.",
    "Never provide a Social Security number, a full patient address, a medical record number, a "
    "card, or a password. If one is demanded, say the billing office will call back and end the call.",
    "Never discuss clinical care, diagnosis, or treatment. This is claim administration only.",
    "Never state or imply that a claim is owed or incorrect. Ask what the plan's record says.",
    "Do not guess. If a value is not stated clearly, report it as unknown.",
    "Ask for a call reference number and the representative's first name before ending.",
)


# --- schemas ----------------------------------------------------------------
def _s(description: str) -> Dict[str, Any]:
    return {"type": "string", "description": description + ' Use "unknown" if not clearly stated.'}


def _e(values: Sequence[str], description: str) -> Dict[str, Any]:
    return {"type": "string", "enum": list(values), "description": description}


def _closed(properties: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "object", "additionalProperties": False,
            "required": sorted(properties), "properties": properties}


def _item(extra: Dict[str, Any]) -> Dict[str, Any]:
    properties: Dict[str, Any] = {"claim_number": _s("The claim number this answer belongs to.")}
    properties.update(extra)
    properties["evidence_quote"] = _s(
        "The representative's own words supporting this answer, quoted verbatim from the call.")
    return _closed(properties)


ITEMS: Dict[str, Dict[str, Any]] = {
    "claim_status": _item({
        "claim_status": _e(("paid", "denied", "pending", "in_process", "rejected", "not_on_file", UNKNOWN),
                           "The plan's processing status for this claim."),
        "paid_amount": _s("Amount the plan paid."),
        "allowed_amount": _s("Allowed amount for the claim."),
        "patient_responsibility": _s("Amount that is the patient's responsibility."),
        "check_number": _s("Check or EFT trace number."),
        "paid_date": _s("Date payment was issued, as YYYY-MM-DD if stated."),
    }),
    "denial_reason": _item({
        "carc_code": _s("Claim Adjustment Reason Code, for example CO-97."),
        "rarc_code": _s("Remittance Advice Remark Code, for example N130."),
        "denial_reason_text": _s("The denial reason in the representative's words."),
        "appealable": _e(("yes", "no", UNKNOWN), "Whether the plan says this denial can be appealed."),
        "appeal_deadline": _s("Last date an appeal may be filed, as YYYY-MM-DD if stated."),
        "appeal_method": _s("Where and how an appeal must be sent."),
        "corrected_claim_accepted": _e(("yes", "no", UNKNOWN),
                                       "Whether a corrected claim is accepted instead of an appeal."),
    }),
    "prior_auth_status": _item({
        "auth_status": _e(("approved", "denied", "pending", "not_found", UNKNOWN),
                          "Status of the authorization request."),
        "auth_number": _s("Authorization number issued by the plan."),
        "effective_date": _s("First date the authorization is valid, as YYYY-MM-DD if stated."),
        "expiration_date": _s("Last date the authorization is valid, as YYYY-MM-DD if stated."),
        "units_approved": _s("Number of visits or units approved."),
        "missing_information": _s("What the plan still needs before it can decide."),
    }),
    "eligibility": _item({
        "coverage_active": _e(("active", "inactive", "terminated", UNKNOWN),
                              "Whether coverage was active on the date of service."),
        "plan_name": _s("Name of the plan or product."),
        "group_number": _s("Group number for the member's plan."),
        "deductible_total": _s("Total individual deductible for the benefit year."),
        "deductible_met": _s("Deductible met so far this benefit year."),
        "copay": _s("Copay that applies to this service."),
        "coinsurance": _s("Coinsurance percentage that applies to this service."),
        "out_of_pocket_max": _s("Individual out-of-pocket maximum."),
        "out_of_pocket_met": _s("Out-of-pocket amount met so far."),
        "prior_auth_required": _e(("yes", "no", UNKNOWN),
                                  "Whether prior authorization is required for this service."),
    }),
}

ASKS: Dict[str, List[str]] = {
    "claim_status": ["the current processing status of the claim",
                     "the paid amount, allowed amount, and patient responsibility",
                     "the check or EFT trace number and the date payment was issued"],
    "denial_reason": ["the claim adjustment reason code and any remark code",
                      "the denial reason in plain words",
                      "whether the denial can be appealed, by when, and where it must be sent",
                      "whether a corrected claim is accepted instead of an appeal"],
    "prior_auth_status": ["the status of the authorization request",
                          "the authorization number and the dates it covers",
                          "how many visits or units were approved",
                          "what information the plan is still waiting for"],
    "eligibility": ["whether coverage was active on the date of service",
                    "the plan name and group number",
                    "the deductible, how much is met, the copay, and the coinsurance",
                    "the out-of-pocket maximum and how much is met",
                    "whether prior authorization is required for this service"],
}

# Fields that carry the answer, blanked when the evidence quote cannot be confirmed.
CORE: Dict[str, Tuple[str, ...]] = {
    "claim_status": ("claim_status",),
    "denial_reason": ("carc_code", "denial_reason_text", "appealable"),
    "prior_auth_status": ("auth_status",),
    "eligibility": ("coverage_active",),
}

E164_RE = re.compile(r"^\+[1-9][0-9]{6,14}$")


class PlanError(ValueError):
    pass


def result_schema(workflow: str) -> Dict[str, Any]:
    return _closed({
        "call_outcome": _e(("answered", "partial", "not_on_file", "rep_refused", "ivr_dead_end",
                            "hold_timeout", "unreached", UNKNOWN), "How the call ended overall."),
        "reference_number": _s("The plan's reference number for this call."),
        "representative_name": _s("First name of the representative who answered."),
        "claims": {"type": "array", "description": "One entry per claim discussed, in order.",
                   "items": ITEMS[workflow]},
    })


def mask_phone(phone: str) -> str:
    digits = [c for c in phone if c.isdigit()]
    if len(digits) < 4:
        return "unknown"
    head = "".join(digits[:2]) if phone.startswith("+") else ""
    return ("+" if phone.startswith("+") else "") + head + "*" * (len(digits) - len(head) - 2) + "".join(digits[-2:])


def disclose(patient: Dict[str, Any], workflow: str) -> Dict[str, str]:
    """Apply the envelope. Fields outside it, and never-disclose fields, do not survive."""
    envelope = ENVELOPES.get(workflow)
    if envelope is None:
        raise PlanError("unknown workflow %r; expected one of %s" % (workflow, ", ".join(sorted(ENVELOPES))))
    out: Dict[str, str] = {}
    for name in envelope:
        if name in NEVER_DISCLOSE:
            continue
        value = str(patient.get(name, "")).strip()
        if value:
            out[name] = value
    return out


def build_task(request: Dict[str, Any]) -> Tuple[str, Dict[str, List[str]]]:
    workflow = request.get("workflow", "")
    if workflow not in ENVELOPES:
        raise PlanError("workflow must be one of: %s" % ", ".join(sorted(ENVELOPES)))
    practice = request.get("practice") or {}
    payer = request.get("payer") or {}
    claims = request.get("claims") or []
    if not claims:
        raise PlanError("the request needs at least one claim")
    phone = str(payer.get("phone", ""))
    if not E164_RE.match(phone):
        raise PlanError("payer.phone must be E.164, for example +12125550142")
    cap = int(payer.get("claims_per_call_cap", 3))
    if len(claims) > cap:
        raise PlanError("%d claims exceeds this payer's cap of %d per call" % (len(claims), cap))

    max_hold = int(request.get("max_hold_minutes", 25))
    npi = str(practice.get("npi", ""))
    lines: List[str] = [
        "You are calling %s on behalf of the billing office of %s, a medical practice."
        % (payer.get("name", "the health plan"), practice.get("name", "the practice")),
        "Provider NPI %s." % npi,
        "",
        "For each claim listed below, ask the representative for:",
    ]
    lines.extend("  - %s" % item for item in ASKS[workflow])
    lines += [
        "",
        "Reaching a representative:",
        "  This is a health plan provider-services line. Work through the phone menu to reach a live "
        "representative, using the keypad when the menu asks for entries.",
        "  If the menu asks for the provider NPI, enter %s." % npi,
        "  Do not settle for an automated self-service answer if a representative is offered.",
        "",
        "Waiting on hold:",
        "  Hold time is expected. Stay on the line and do not speak while hold music or a recording "
        "is playing.",
        "  If the total time on hold across the whole call passes %d minutes, end the call and "
        "report call_outcome as hold_timeout." % max_hold,
        "  A transfer may put you in a second queue. The limit covers all hold time added together.",
        "",
        "Once a representative is on the line:",
        "  Identify the practice, give the provider NPI, and give the patient identifiers listed with "
        "each claim when asked to verify. Give them again after a transfer without being asked twice.",
        "  Work through the claims one at a time and repeat each claim number back.",
        "",
    ]

    disclosed: Dict[str, List[str]] = {}
    for index, claim in enumerate(claims, start=1):
        values = disclose(claim.get("patient") or {}, workflow)
        disclosed[str(claim.get("claim_number", "claim %d" % index))] = sorted(values)
        lines.append("Claim %d of this call:" % index)
        lines.append("  claim number: %s" % claim.get("claim_number", ""))
        lines.append("  date of service: %s" % claim.get("date_of_service", ""))
        if claim.get("procedure_code"):
            lines.append("  procedure code: %s" % claim["procedure_code"])
        for name in sorted(values):
            lines.append("  %s: %s" % (name.replace("_", " "), values[name]))
        lines.append("")

    lines.append("Rules you must follow for the whole call:")
    lines.extend("- %s" % rule for rule in BOUNDARIES)
    lines += [
        "",
        "Reporting:",
        "  Return one entry in claims for every claim listed above, keyed by its claim number.",
        '  Any value the representative did not state clearly must be reported as "unknown".',
        "  Put the representative's own supporting words in evidence_quote, quoted exactly.",
    ]
    return "\n".join(lines), disclosed


# --- local verification -----------------------------------------------------
_PUNCT = re.compile(r"[^a-z0-9\s]+")
_WS = re.compile(r"\s+")
MIN_QUOTE_TOKENS = 6


def normalize(text: str) -> str:
    return _WS.sub(" ", _PUNCT.sub(" ", str(text or "").lower())).strip()


def validate(value: Any, schema: Dict[str, Any], path: str = "$") -> None:
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            raise PlanError("%s must be an object" % path)
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                raise PlanError("%s has fields outside the schema: %s" % (path, ", ".join(extra)))
        missing = sorted(set(schema.get("required", [])) - set(value))
        if missing:
            raise PlanError("%s is missing required fields: %s" % (path, ", ".join(missing)))
        for name, subschema in properties.items():
            if name in value:
                validate(value[name], subschema, "%s.%s" % (path, name))
    elif kind == "array":
        if not isinstance(value, list):
            raise PlanError("%s must be an array" % path)
        for index, item in enumerate(value):
            validate(item, schema["items"], "%s[%d]" % (path, index))
    elif kind == "string":
        if not isinstance(value, str):
            raise PlanError("%s must be a string" % path)
        allowed = schema.get("enum")
        if allowed is not None and value not in allowed:
            raise PlanError("%s is %r, not one of: %s" % (path, value, ", ".join(allowed)))


def is_grounded(quote: str, transcript: str) -> bool:
    needle, haystack = normalize(quote), normalize(transcript)
    tokens = needle.split()
    if not needle or not haystack or len(tokens) < MIN_QUOTE_TOKENS:
        return False
    if needle in haystack:
        return True
    for start in range(len(tokens) - MIN_QUOTE_TOKENS + 1):
        if " ".join(tokens[start:start + MIN_QUOTE_TOKENS]) in haystack:
            return True
    return False


def transcript_text(payload: Dict[str, Any]) -> str:
    turns: List[Dict[str, Any]] = []
    for recipient in payload.get("recipients") or []:
        for attempt in reversed(recipient.get("attempts") or []):
            if attempt.get("transcript_turns"):
                turns = attempt["transcript_turns"]
                break
        if turns:
            break
    if not turns:
        turns = payload.get("transcript_turns") or []
    return " ".join(str(turn.get("text", "")) for turn in turns)


# --- commands ---------------------------------------------------------------
def load(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def cmd_preview(args: argparse.Namespace) -> int:
    request = load(args.request)
    task, disclosed = build_task(request)
    payer = request.get("payer") or {}
    print("workflow:        %s" % request["workflow"])
    print("destination:     %s" % mask_phone(str(payer.get("phone", ""))))
    print("claims on call:  %d" % len(request.get("claims") or []))
    print("disclosed fields: %s" % json.dumps(disclosed, sort_keys=True))
    print("calls_placed:    0")
    print("")
    print("--- task ---")
    print(task)
    print("")
    print("--- result_schema ---")
    print(json.dumps(result_schema(request["workflow"]), indent=2, sort_keys=True))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    request = load(args.request)
    payload = load(args.result)
    workflow = request["workflow"]
    result = payload.get("structured_result")
    if not isinstance(result, dict):
        for recipient in payload.get("recipients") or []:
            if isinstance(recipient.get("structured_result"), dict):
                result = recipient["structured_result"]
                break
    if not isinstance(result, dict):
        print("unusable: the call returned no structured result")
        return 1

    try:
        validate(result, result_schema(workflow))
    except PlanError as error:
        print("unusable: schema check failed: %s" % error)
        return 1

    spoken = transcript_text(payload)
    grounded = reset = 0
    print("reference: %s   representative: %s"
          % (result.get("reference_number", UNKNOWN), result.get("representative_name", UNKNOWN)))
    for entry in result.get("claims", []):
        number = entry.get("claim_number", "?")
        if is_grounded(str(entry.get("evidence_quote", "")), spoken):
            grounded += 1
            print("  %s  grounded" % number)
        else:
            reset += 1
            for name in CORE[workflow]:
                entry[name] = UNKNOWN
            entry["evidence_quote"] = UNKNOWN
            print("  %s  NOT GROUNDED - fields reset to unknown, send to human review" % number)
    print("")
    print("%d grounded, %d reset" % (grounded, reset))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print("checked result written to %s" % args.out)
    return 0 if reset == 0 else 1


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Compile and check a payer call. Places no calls.")
    subparsers = parser.add_subparsers(dest="command")

    preview = subparsers.add_parser("preview", help="print the task text and result schema")
    preview.add_argument("--request", required=True)
    preview.set_defaults(handler=cmd_preview)

    check = subparsers.add_parser("check", help="validate a returned result and confirm its evidence")
    check.add_argument("--request", required=True)
    check.add_argument("--result", required=True)
    check.add_argument("--out", help="write the checked result here")
    check.set_defaults(handler=cmd_check)

    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return 1
    try:
        return int(args.handler(args))
    except PlanError as error:
        print("refused: %s" % error)
        return 2


if __name__ == "__main__":
    sys.exit(main())
