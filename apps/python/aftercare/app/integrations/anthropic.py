from __future__ import annotations

import json
import re
from typing import Any

from anthropic import Anthropic
from app.config import settings

EXTRACTION_SCHEMA_HINT = {
    "type": "object",
    "required": [
        "feeling_overall",
        "pain_level",
        "medication_compliance",
        "emergency_symptoms_reported",
        "followup_concerns",
        "notes",
        "symptoms",
    ],
    "properties": {
        "feeling_overall": {
            "type": "string",
            "enum": ["better", "same", "worse", "unknown"],
        },
        "pain_level": {
            "type": ["integer", "null"],
            "minimum": 0,
            "maximum": 10,
        },
        "medication_compliance": {
            "type": "string",
            "enum": ["yes", "partial", "no", "unknown"],
        },
        "emergency_symptoms_reported": {"type": "boolean"},
        "followup_concerns": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
        "symptoms": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string"},
                    "severity": {
                        "type": ["string", "null"],
                        "enum": ["mild", "moderate", "severe", None],
                    },
                    "note": {"type": ["string", "null"]},
                },
            },
        },
    },
}


def _get_client() -> Anthropic:
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY is not configured")
    return Anthropic(api_key=settings.anthropic_api_key)


def _parse_llm_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


def extract_facts_with_claude(transcript: str) -> dict[str, Any]:
    """Ask Claude for clinical facts only. Do not ask for the final risk label."""
    client = _get_client()

    prompt = f"""
You are a clinical documentation assistant for post-discharge follow-up calls.
Extract structured facts from the transcript.
Do not diagnose. Do not invent facts.
Respect negation (e.g. "I don't have chest pain" means that symptom is absent).
If unclear, use "unknown", null, or false.

Return ONLY valid JSON matching this schema:
{json.dumps(EXTRACTION_SCHEMA_HINT, indent=2)}

Transcript:
\"\"\"
{transcript}
\"\"\"
""".strip()

    response = client.messages.create(
        model=settings.llm_model,
        max_tokens=800,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )

    text_blocks = [block.text for block in response.content if hasattr(block, "text")]
    raw = "\n".join(text_blocks).strip()
    return _parse_llm_json(raw)
