from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.integrations.anthropic import extract_facts_with_claude
from app.integrations.google import extract_facts_with_gemini


@dataclass
class SymptomResult:
    name: str
    severity: str | None = None
    note: str | None = None


@dataclass
class AnalysisResult:
    summary: str
    risk_score: float
    risk_level: str
    is_emergency: bool
    symptoms: list[SymptomResult] = field(default_factory=list)


EMERGENCY_KEYWORDS = [
    "chest pain",
    "shortness of breath",
    "can't breathe",
    "cannot breathe",
    "difficulty breathing",
    "fainting",
    "passed out",
    "pass out",
    "severe bleeding",
    "suicidal",
    "kill myself",
    "want to die",
    "stroke",
    "heart attack",
    "unconscious",
    "coughing blood",
    "vomiting blood",
]

NEGATION_WORDS = {
    "no",
    "not",
    "don't",
    "dont",
    "doesn't",
    "doesnt",
    "didn't",
    "didnt",
    "without",
    "never",
    "deny",
    "denies",
    "denied",
}


def _llm_available() -> bool:
    return bool(
        settings.llm_enabled
        and (settings.google_api_key or settings.anthropic_api_key)
    )


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _patient_only_text(transcript: str) -> str:
    """Return only patient utterances from a speaker-labelled transcript."""
    patient_lines: list[str] = []

    for line in transcript.splitlines():
        speaker, separator, text = line.partition(":")
        if separator and speaker.strip().lower() in {
            "user",
            "patient",
            "recipient",
        }:
            patient_lines.append(text.strip())

    return "\n".join(patient_lines) if patient_lines else transcript


def _is_negated(text: str, match_start: int, lookback_words: int = 4) -> bool:
    """Only check the last few words immediately before the match."""
    before = text[:match_start].strip()
    before_words = before.split()
    window = before_words[-lookback_words:] if before_words else []
    return any(word.strip(".,!?;:") in NEGATION_WORDS for word in window)


def _merge_keywords(extra: list[str] | None = None) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for phrase in EMERGENCY_KEYWORDS + (extra or []):
        normalized = _normalize(phrase)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    return merged


def detect_emergency_keywords(
    transcript: str, *, extra_keywords: list[str] | None = None
) -> list[str]:
    text = _normalize(_patient_only_text(transcript))
    matched: list[str] = []

    for phrase in _merge_keywords(extra_keywords):
        search_from = 0
        while True:
            idx = text.find(phrase, search_from)
            if idx == -1:
                break

            if not _is_negated(text, idx):
                matched.append(phrase)
                break

            search_from = idx + len(phrase)

    return matched


def score_risk(
    *,
    is_emergency: bool,
    pain_level: int | None,
    medication_compliance: str | None,
    feeling_overall: str | None,
    emergency_from_structured: bool = False,
    followup_concerns: list[str] | None = None,
) -> tuple[float, str]:
    """
    Convert clinical facts into an explainable risk score/level.
    Returns: (risk_score 0-100, risk_level)
    risk_level: low | medium | high | critical
    """

    if is_emergency or emergency_from_structured:
        return 95.0, "critical"

    score = 0.0

    if pain_level is not None:
        if pain_level >= 8:
            score += 40
        elif pain_level >= 4:
            score += 20
        elif pain_level >= 1:
            score += 5

    compliance = (medication_compliance or "unknown").lower()
    if compliance == "no":
        score += 30
    elif compliance == "partial":
        score += 15

    feeling = (feeling_overall or "unknown").lower()
    if feeling == "worse":
        score += 25
    elif feeling == "same":
        score += 10

    if followup_concerns:
        score += min(15, 5 * len(followup_concerns))

    score = min(100, score)

    if score >= 70:
        level = "high"
    elif score >= 40:
        level = "medium"
    else:
        level = "low"

    return score, level


def _coerce_pain(value: Any) -> int | None:
    if value is None:
        return None
    try:
        pain = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, min(10, pain))


def extract_from_structured_result(
    structured_result: dict[str, Any] | None,
) -> dict[str, Any]:
    """Turn CALL-E structured result into a clean internal facts dict."""

    data = structured_result or {}

    symptoms_raw = data.get("symptoms", [])
    symptoms: list[dict[str, Any]] = []
    if isinstance(symptoms_raw, list):
        for item in symptoms_raw:
            if isinstance(item, dict) and item.get("name"):
                symptoms.append(item)
            elif isinstance(item, str):
                symptoms.append({"name": item, "severity": None, "note": None})

    concerns = data.get("followup_concerns", [])
    if isinstance(concerns, str):
        concerns = [concerns]
    if not isinstance(concerns, list):
        concerns = []

    return {
        "feeling_overall": str(data.get("feeling_overall") or "unknown"),
        "pain_level": _coerce_pain(data.get("pain_level")),
        "medication_compliance": data.get("medication_compliance") or "unknown",
        "emergency_symptoms_reported": bool(data.get("emergency_symptoms_reported")),
        "followup_concerns": [str(c) for c in concerns],
        "notes": str(data.get("notes") or ""),
        "symptoms": symptoms,
    }


def extract_with_llm(transcript: str) -> tuple[dict[str, Any], str]:
    """
    Ask LLM for clinical facts only.
    Primary: Claude. Secondary: Gemini.
    Do NOT ask either model for the final risk label.
    """
    if not transcript.strip():
        return extract_from_structured_result(None), "rules"

    claude_error: Exception | None = None

    if settings.anthropic_api_key:
        try:
            parsed = extract_facts_with_claude(transcript)
            return extract_from_structured_result(parsed), "claude"
        except Exception as exc:
            claude_error = exc

    if settings.google_api_key:
        try:
            parsed = extract_facts_with_gemini(transcript)
            return extract_from_structured_result(parsed), "gemini"
        except Exception as gemini_error:
            raise RuntimeError(
                "Claude and Gemini clinical extraction both failed"
            ) from gemini_error

    if claude_error is not None:
        raise RuntimeError("Claude clinical extraction failed") from claude_error

    raise RuntimeError("No clinical extraction provider configured")


def _build_symptoms(
    extracted: dict[str, Any],
    matched_keywords: list[str],
) -> list[SymptomResult]:
    symptoms: list[SymptomResult] = []

    for item in extracted.get("symptoms", []):
        if isinstance(item, dict) and item.get("name"):
            symptoms.append(
                SymptomResult(
                    name=str(item["name"]),
                    severity=str(item.get("severity") or "unknown"),
                    note=str(item.get("note") or ""),
                )
            )

    for phrase in matched_keywords:
        if not any(s.name == phrase for s in symptoms):
            symptoms.append(
                SymptomResult(
                    name=phrase,
                    severity="severe",
                    note="Detected by emergency keyword backstop",
                )
            )

    return symptoms


def analyze_transcript(
    *,
    transcript: str,
    structured_result: dict[str, Any] | None = None,
    extra_emergency_keywords: list[str] | None = None,
) -> AnalysisResult:
    matched_keywords = detect_emergency_keywords(
        transcript, extra_keywords=extra_emergency_keywords
    )
    keyword_emergency = bool(matched_keywords)

    source = "rules"
    extracted: dict[str, Any]

    has_usable_structured = bool(
        structured_result
        and any(
            structured_result.get(k) is not None
            for k in (
                "feeling_overall",
                "pain_level",
                "medication_compliance",
                "emergency_symptoms_reported",
                "followup_concerns",
                "notes",
                "symptoms",
            )
        )
    )

    if has_usable_structured:
        extracted = extract_from_structured_result(structured_result)
        source = "calle_structured"

        # CALL-E payload exists but is sparse — fill gaps with LLM.
        thin = (
            not extracted.get("symptoms")
            and extracted.get("feeling_overall") == "unknown"
            and extracted.get("pain_level") is None
        )

        if thin and _llm_available() and transcript.strip():
            try:
                llm_extracted, provider = extract_with_llm(transcript)
                for key in ("symptoms", "followup_concerns", "notes"):
                    if not extracted.get(key) and llm_extracted.get(key):
                        extracted[key] = llm_extracted[key]
                if extracted.get("feeling_overall") == "unknown":
                    extracted["feeling_overall"] = (
                        llm_extracted.get("feeling_overall") or "unknown"
                    )
                if extracted.get("pain_level") is None:
                    extracted["pain_level"] = llm_extracted.get("pain_level")
                if extracted.get("medication_compliance") == "unknown":
                    extracted["medication_compliance"] = llm_extracted.get(
                        "medication_compliance", "unknown"
                    )
                if not extracted.get("emergency_symptoms_reported"):
                    extracted["emergency_symptoms_reported"] = bool(
                        llm_extracted.get("emergency_symptoms_reported")
                    )
                source = f"hybrid_{provider}"
            except Exception:
                pass
    elif _llm_available() and transcript.strip():
        # No usable CALL-E structured result — ask LLM directly.
        try:
            extracted, provider = extract_with_llm(transcript)
            source = provider
        except Exception:
            extracted = extract_from_structured_result(None)
            source = "rules"
    else:
        extracted = extract_from_structured_result(structured_result)
        source = "calle_structured" if structured_result else "rules"

    # Kept for observability of which extraction path ran.
    _ = source

    emergency_from_structured = bool(extracted.get("emergency_symptoms_reported"))
    is_emergency = keyword_emergency or emergency_from_structured

    risk_score, risk_level = score_risk(
        is_emergency=is_emergency,
        pain_level=extracted.get("pain_level"),
        medication_compliance=extracted.get("medication_compliance"),
        feeling_overall=extracted.get("feeling_overall"),
        emergency_from_structured=emergency_from_structured,
        followup_concerns=extracted.get("followup_concerns"),
    )

    # Keyword backstop always wins for emergency safety.
    if keyword_emergency:
        is_emergency = True
        risk_level = "critical"
        risk_score = max(95.0, float(risk_score))

    symptoms = _build_symptoms(extracted, matched_keywords)
    concerns = extracted.get("followup_concerns", [])

    summary_parts: list[str] = []
    if extracted.get("notes"):
        summary_parts.append(str(extracted["notes"]))
    if concerns:
        summary_parts.append("Concerns: " + "; ".join(map(str, concerns)))
    if matched_keywords:
        summary_parts.append("Emergency keywords: " + ", ".join(matched_keywords))
    if not summary_parts:
        summary_parts.append(
            f"Risk={risk_level}; feeling={extracted.get('feeling_overall')}; "
            f"pain={extracted.get('pain_level')}; "
            f"compliance={extracted.get('medication_compliance')}"
        )

    return AnalysisResult(
        summary="\n".join(summary_parts),
        risk_score=risk_score,
        risk_level=risk_level,
        is_emergency=is_emergency,
        symptoms=symptoms,
    )
