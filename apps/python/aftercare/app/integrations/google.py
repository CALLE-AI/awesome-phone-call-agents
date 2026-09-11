from __future__ import annotations

import json
from typing import Any 
from google import genai 
from google.genai import types 

from app.config import settings 
from app.integrations.anthropic import EXTRACTION_SCHEMA_HINT

def extract_facts_with_gemini(transcript: str) -> dict[str, Any]:
    if not settings.google_api_key:
        raise ValueError("Google API key is not set")

    client = genai.Client(api_key=settings.google_api_key)

    prompt = f"""
You are a clinical documentation assistant for post-discharge calls.
Extract only facts explicitly stated in the transcript.
Do not diagnose, recommend treatment, or invent information.
Respect negation. For example, "I do not have chest pain" means chest pain
is absent.
Transcript:
\"\"\"
{transcript}
\"\"\"
""".strip()

    response = client.models.generate_content(
        model=settings.agent_model, 
        contents = prompt, 
        config = types.GenerateContentConfig(
            temperature = 0, 
            response_mime_type = "application/json", 
            response_json_schema = EXTRACTION_SCHEMA_HINT,
        ), 
    )

    if not response.text:
        raise ValueError("Gemini returned an empty response")

    result = json.loads(response.text)
    if not isinstance(result, dict):
        raise ValueError("Gemini returned an invalid response")

    return result