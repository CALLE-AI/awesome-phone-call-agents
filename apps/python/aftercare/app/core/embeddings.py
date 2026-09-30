from __future__ import annotations

import logging
from functools import lru_cache

from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    """Load the local model once, then reuse it for every embedding."""
    logger.info("Loading embedding model %s", EMBEDDING_MODEL)
    return SentenceTransformer(EMBEDDING_MODEL)


def embed_text(text: str) -> list[float]:
    cleaned = (text or "").strip()
    if not cleaned:
        return []

    try:
        vector = _get_model().encode(
            cleaned,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        if len(vector) != EMBEDDING_DIM:
            logger.error("Unexpected embedding size: %s", len(vector))
            return []
        return vector.tolist()
    except Exception:
        logger.exception("Embedding text with the local model failed")
        return []


def build_patient_content(patient) -> str:
    protocol_name = patient.protocol.name if patient.protocol else "none"
    return (
        f"Patient: {patient.name}, Age: {patient.age}, Gender: {patient.gender}\n"
        f"Diagnosis: {patient.discharge_diagnosis or ''}\n"
        f"Protocol: {protocol_name}\n"
        f"Risk: {patient.current_risk_level}, Follow-up needed: {patient.needs_followup}\n"
        f"Doctor: {patient.doctor_name or ''}"
    )


def build_call_content(call) -> str:
    patient_name = call.patient.name if call.patient else "unknown"
    symptoms = ", ".join(s.name for s in (call.symptoms or []))
    transcript = (call.transcript or "")[:600]
    return (
        f"Patient: {patient_name}\n"
        f"Status: {call.status}, Risk: {call.risk_level}, Emergency: {call.is_emergency}\n"
        f"Summary: {call.summary or ''}\n"
        f"Symptoms: {symptoms}\n"
        f"Transcript excerpt: {transcript}"
    )