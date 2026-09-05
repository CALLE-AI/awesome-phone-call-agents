from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, ValidationError


logger = logging.getLogger(__name__)


# ============================================================
# ENVIRONMENT CONFIGURATION
# ============================================================

# Resolve backend/.env correctly regardless of the directory
# from which Uvicorn or a Python command is started.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"

load_dotenv(ENV_FILE)


# ============================================================
# STRUCTURED RESPONSE MODEL
# ============================================================

class GeminiIncidentAnalysis(BaseModel):
    """
    Structured incident analysis returned by Gemini.
    """

    priority: str = Field(
        ...,
        description=(
            "Operational incident priority. "
            "Must be one of P1, P2, P3, or P4."
        ),
    )

    summary: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description=(
            "Concise executive summary describing the incident "
            "and its immediate operational concern."
        ),
    )

    root_cause: str = Field(
        ...,
        min_length=3,
        max_length=300,
        description=(
            "Most likely root-cause hypothesis based only on "
            "the supplied incident information."
        ),
    )

    business_impact: str = Field(
        ...,
        min_length=3,
        max_length=400,
        description=(
            "Likely customer, operational, service, or business impact."
        ),
    )

    owner: str = Field(
        ...,
        min_length=3,
        max_length=150,
        description=(
            "Recommended engineering team or operational owner."
        ),
    )

    recommendation: list[str] = Field(
        ...,
        min_length=3,
        max_length=5,
        description=(
            "Three to five concise and immediately actionable "
            "incident-response steps."
        ),
    )


# ============================================================
# CONFIGURATION HELPERS
# ============================================================

def _get_api_key() -> str | None:
    """
    Return the Gemini API key when a real value is configured.

    Empty values and known placeholders return None so that the caller
    can safely use deterministic fallback analysis.
    """

    api_key = os.getenv(
        "GEMINI_API_KEY",
        "",
    ).strip()

    invalid_values = {
        "",
        "YOUR_GEMINI_API_KEY",
        "YOUR_GEMINI_API_KEY_HERE",
        "REPLACE_WITH_YOUR_GEMINI_API_KEY",
        "NOT_USED",
    }

    if api_key in invalid_values:
        return None

    return api_key


def _get_model_name() -> str:
    """
    Return the configured Gemini model name.

    Supported environment formats:

        GEMINI_MODEL=gemini-3.6-flash

    or:

        GEMINI_MODEL=models/gemini-3.6-flash
    """

    model_name = os.getenv(
        "GEMINI_MODEL",
        "gemini-3.6-flash",
    ).strip()

    if not model_name:
        model_name = "gemini-3.6-flash"

    if model_name.startswith("models/"):
        model_name = model_name.removeprefix("models/")

    return model_name


def _get_timeout_ms() -> int:
    """
    Return the HTTP timeout in milliseconds.

    Default:
        30000 milliseconds

    Allowed range:
        5000–60000 milliseconds
    """

    raw_timeout = os.getenv(
        "GEMINI_TIMEOUT_MS",
        "30000",
    ).strip()

    try:
        timeout_ms = int(raw_timeout)

    except ValueError:
        logger.warning(
            "Invalid GEMINI_TIMEOUT_MS value. "
            "Using the default timeout of 30000 ms."
        )
        return 30000

    return max(
        5000,
        min(timeout_ms, 60000),
    )


# ============================================================
# PROMPT
# ============================================================

def _build_prompt(
    incident: str,
    severity: str,
) -> str:
    """
    Build a concise and controlled SRE incident-analysis prompt.
    """

    return f"""
You are a senior Site Reliability Engineer and Incident Commander.

Analyze the following production incident.

Reported severity:
{severity}

Incident description:
{incident}

Return a structured incident assessment with:

1. Exactly one priority: P1, P2, P3, or P4.
2. One concise executive summary.
3. One likely root-cause hypothesis.
4. One concise business-impact assessment.
5. One recommended engineering owner.
6. Exactly three immediate response recommendations.

Priority guidance:

P1:
Critical production outage, payment failure, security emergency,
business-critical service unavailable, or severe customer disruption.

P2:
High-impact production degradation requiring urgent investigation.

P3:
Moderate degradation, limited impact, or a viable workaround.

P4:
Low-impact event, informational issue, or routine investigation.

Rules:

- Do not invent exact customer counts.
- Do not invent financial losses.
- Do not invent outage duration.
- Do not claim access to logs or monitoring data.
- Do not present an unverified root cause as confirmed.
- State clearly when the root cause requires validation.
- Keep every field concise.
- Keep each recommendation to one short sentence.
- Return only data matching the required response schema.
""".strip()


# ============================================================
# NORMALIZATION
# ============================================================

def _clean_text(value: Any) -> str:
    """
    Normalize whitespace while preserving meaning.
    """

    return " ".join(
        str(value).split()
    ).strip()


def _normalize_analysis(
    analysis: GeminiIncidentAnalysis,
) -> GeminiIncidentAnalysis:
    """
    Validate and normalize Gemini output before returning it.
    """

    allowed_priorities = {
        "P1",
        "P2",
        "P3",
        "P4",
    }

    priority = _clean_text(
        analysis.priority
    ).upper()

    if priority not in allowed_priorities:
        raise ValueError(
            "Gemini returned an unsupported priority: "
            f"{analysis.priority!r}"
        )

    recommendations: list[str] = []

    for item in analysis.recommendation:
        cleaned = _clean_text(
            item
        ).strip(" -•")

        if (
            cleaned
            and cleaned not in recommendations
        ):
            recommendations.append(cleaned)

    if len(recommendations) < 3:
        raise ValueError(
            "Gemini returned fewer than three valid recommendations."
        )

    return GeminiIncidentAnalysis(
        priority=priority,
        summary=_clean_text(
            analysis.summary
        ),
        root_cause=_clean_text(
            analysis.root_cause
        ),
        business_impact=_clean_text(
            analysis.business_impact
        ),
        owner=_clean_text(
            analysis.owner
        ),
        recommendation=recommendations[:5],
    )


def _parse_response(
    response: Any,
) -> GeminiIncidentAnalysis:
    """
    Parse a structured Gemini response.

    The SDK-parsed value is preferred. Raw response text is used only
    when the SDK does not provide a parsed structured object.
    """

    parsed = getattr(
        response,
        "parsed",
        None,
    )

    if isinstance(
        parsed,
        GeminiIncidentAnalysis,
    ):
        return parsed

    if isinstance(parsed, dict):
        return GeminiIncidentAnalysis.model_validate(
            parsed
        )

    response_text = getattr(
        response,
        "text",
        None,
    )

    if response_text:
        return GeminiIncidentAnalysis.model_validate_json(
            response_text
        )

    raise ValueError(
        "Gemini returned no usable structured response."
    )


# ============================================================
# GEMINI SERVICE
# ============================================================

def analyze_with_gemini(
    incident: str,
    severity: str,
) -> GeminiIncidentAnalysis | None:
    """
    Analyze an incident using Gemini structured output.

    Returns GeminiIncidentAnalysis on success.

    Returns None when Gemini is unavailable, misconfigured, times out,
    reaches a quota limit, returns incomplete JSON, or fails schema
    validation. Returning None allows analyzer.py to use the existing
    deterministic fallback.
    """

    api_key = _get_api_key()

    if not api_key:
        logger.info(
            "Gemini analysis skipped because GEMINI_API_KEY "
            "is not configured."
        )
        return None

    clean_incident = _clean_text(
        incident
    )

    clean_severity = _clean_text(
        severity
    )

    if not clean_incident:
        logger.warning(
            "Gemini analysis skipped because the incident "
            "description is empty."
        )
        return None

    model_name = _get_model_name()
    timeout_ms = _get_timeout_ms()

    client: genai.Client | None = None

    try:
        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=timeout_ms,
            ),
        )

        response = client.models.generate_content(
            model=model_name,
            contents=_build_prompt(
                incident=clean_incident,
                severity=clean_severity,
            ),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiIncidentAnalysis,
                max_output_tokens=4096,
                temperature=0.1,
            ),
        )

        analysis = _parse_response(
            response
        )

        normalized = _normalize_analysis(
            analysis
        )

        logger.info(
            "Gemini incident analysis completed successfully "
            "using model %s.",
            model_name,
        )

        return normalized

    except ValidationError as exc:
        logger.warning(
            "Gemini returned structured output that failed "
            "Pydantic validation. Rule-based fallback will be used. "
            "Error: %s",
            str(exc)[:700],
        )

    except ValueError as exc:
        logger.warning(
            "Gemini response validation failed. "
            "Rule-based fallback will be used. Error: %s",
            str(exc)[:700],
        )

    except Exception as exc:
        logger.warning(
            "Gemini incident analysis failed. "
            "Rule-based fallback will be used. "
            "Error type: %s. Message: %s",
            type(exc).__name__,
            str(exc)[:700],
        )

    finally:
        if client is not None:
            try:
                client.close()

            except Exception:
                logger.debug(
                    "Gemini client could not be closed cleanly.",
                    exc_info=True,
                )

    return None
