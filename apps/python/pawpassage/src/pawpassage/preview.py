from __future__ import annotations

import hashlib
import json
from typing import Any

from .contracts import provider_result_schema
from .models import Checkpoint, JourneyCase, mask_phone


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def recipient_digest(phone_e164: str) -> str:
    return sha256_text(f"pawpassage-recipient-v1\0{phone_e164}")


def build_task(case: JourneyCase, checkpoint: Checkpoint) -> str:
    mandarin = checkpoint.locale in {"zh", "zh-CN", "zh-MY", "zh-SG", "zh-TW"}
    opening = "Hello, I am an AI voice assistant calling on behalf of PawPassage. "
    if mandarin and checkpoint.authorization_basis == "CONSENTING_TEST_RECIPIENT":
        opening += "This is the fictional checklist test you agreed to in advance. "
    opening += "This call may be recorded, transcribed, summarized, analyzed, stored, and shared with CALL-E service providers to operate the service. You may refuse or hang up at any time. Do you consent to continue?"
    opening_instruction = (
        f"Before asking anything, deliver the entire following disclosure in Mandarin Chinese (Putonghua), preserving every consent and processing detail: {opening}"
        if mandarin
        else f"Before asking anything, say exactly: {opening}"
    )
    language_instruction = (
        "Speak Mandarin Chinese (Putonghua) throughout the call, including the opening, consent question, checklist, and closing. Do not read the English control instructions or JSON keys aloud."
        if mandarin
        else f"Speak in the recipient's approved locale: {checkpoint.locale}."
    )
    is_test = checkpoint.authorization_basis == "CONSENTING_TEST_RECIPIENT"
    role_instruction = (
        "Explain that this is a synthetic checklist test. Confirm the person is the consenting test participant; never ask them to represent a real service desk or authority. For this test, roleMatch YES means only that test participation was confirmed."
        if is_test
        else f"First confirm that the person can speak for the {checkpoint.kind.lower().replace('_', ' ')} service desk."
    )
    reference_instruction = (
        "Ask whether the fictional written checklist is available; do not collect a URL or email address on the call."
        if is_test
        else "Ask whether an official written page or written follow-up is available; do not collect a URL or email address on the call."
    )
    propositions = "\n".join(
        f"{item.id}: Ask whether this exact proposition is confirmed, contradicted, or not established: {item.statement}"
        for item in checkpoint.propositions
    )
    return "\n".join(
        [
            language_instruction,
            opening_instruction,
            "Proceed only after the recipient clearly says yes. If they decline, do not answer, withdraw consent, or ask to stop, apologize, end the call immediately, and return DO_NOT_CONTACT with roleMatch UNKNOWN, every proposition NOT_ESTABLISHED, writtenReference UNKNOWN, and commitmentRequested UNKNOWN.",
            f"Purpose: verify three frozen operational propositions for the route {case.route_label}.",
            role_instruction,
            propositions,
            reference_instruction,
            "Do not book, pay, negotiate, make a reservation, certify travel readiness, request medical advice, or request legal interpretation.",
            "Do not disclose or collect names, addresses, passport numbers, microchip numbers, medical records, payment data, passwords, or security codes.",
            "If the recipient asks not to receive automated calls, stop and return DO_NOT_CONTACT.",
            "Do not retry or redial under any circumstance.",
            "Return only the supplied closed recipient result schema. Use NOT_ESTABLISHED rather than guessing.",
        ]
    )


def build_preview(case: JourneyCase, checkpoint: Checkpoint) -> dict[str, Any]:
    task = build_task(case, checkpoint)
    return {
        "schemaVersion": "1.0",
        "workflow": "pawpassage",
        "caseId": case.case_id,
        "checkpointId": checkpoint.checkpoint_id,
        "checkpointKind": checkpoint.kind,
        "routeLabel": case.route_label,
        "animalCategory": case.animal_category,
        "contactLabel": checkpoint.contact_label,
        "recipientMasked": mask_phone(checkpoint.phone_e164),
        "recipientDigest": recipient_digest(checkpoint.phone_e164),
        "region": checkpoint.region,
        "locale": checkpoint.locale,
        "officialSourceUrl": checkpoint.official_source_url,
        "authorizationBasis": checkpoint.authorization_basis,
        "authorizationNote": checkpoint.authorization_note,
        "propositions": [
            {"id": proposition.id, "statement": proposition.statement}
            for proposition in checkpoint.propositions
        ],
        "task": task,
        "recipientResultSchema": provider_result_schema(),
        "oneAttemptOnly": True,
        "retention": "Structured result and audit hashes only; no recording or transcript retention.",
        "authorityBoundary": "Evidence for human review only; never a booking, payment, health certificate, or travel clearance.",
    }


def preview_digest(preview: dict[str, Any]) -> str:
    return sha256_text(f"pawpassage-preview-v1\0{canonical_json(preview)}")


def dispatch_idempotency_key(preview: dict[str, Any], approval_digest: str) -> str:
    binding = {
        "preview": preview,
        "approvalDigest": approval_digest,
    }
    return sha256_text(f"pawpassage-dispatch-v1\0{canonical_json(binding)}")
