import json
import re
import time
from difflib import SequenceMatcher
from google import genai
from config import (
    GEMINI_API_KEY, GEMINI_MODEL, DIMENSIONS, sanitize_name,
    MIN_TRANSCRIPT_TURNS, MIN_QUESTIONS_ANSWERED,
)

_client = None

VALID_RECOMMENDATIONS = {"strong_yes", "yes", "neutral", "hesitant", "no"}
VALID_HIRE_RECOMMENDATIONS = {"strong_hire", "hire", "lean_hire", "lean_no", "no_hire"}
VALID_SEVERITIES = {"minor", "notable", "major"}
VALID_QUALITY_STATUSES = {"verified", "partial", "insufficient", "no_consent", "wrong_person"}
SCORE_FIELDS = [f"{d}_score" for d in DIMENSIONS]

QUESTION_MARKERS = [
    r"how long.*(work|capacity)",
    r"greatest strengths",
    r"(team|collaborate|collaboration)",
    r"(reliable|deadline|commitment)",
    r"(grow|improve|development)",
    r"scale of 1 to 10",
]


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _gemini_with_retry(prompt: str, retries: int = 1) -> dict:
    for attempt in range(retries + 1):
        response = _get_client().models.generate_content(
            model=GEMINI_MODEL, contents=prompt,
        )
        try:
            return _parse_json_response(response.text)
        except (json.JSONDecodeError, ValueError):
            if attempt < retries:
                time.sleep(1)
                continue
            raise


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _clamp_score(value, field_name: str) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return 0
    return max(1, min(10, v))


def _fuzzy_match(quote: str, transcript: str, threshold: float = 0.65) -> bool:
    quote_lower = quote.lower().strip()
    if not quote_lower:
        return False
    transcript_lower = transcript.lower()
    if quote_lower in transcript_lower:
        return True
    words = transcript_lower.split()
    window = len(quote_lower.split()) + 5
    for i in range(max(1, len(words) - window + 1)):
        chunk = " ".join(words[i:i + window])
        if SequenceMatcher(None, quote_lower, chunk).ratio() > threshold:
            return True
    return False


def _check_score_recommendation_coherence(scores: dict, recommendation: str) -> str:
    valid_scores = [v for v in scores.values() if v > 0]
    if not valid_scores:
        return recommendation
    avg = sum(valid_scores) / len(valid_scores)
    if avg >= 8 and recommendation in ("no", "hesitant"):
        return "yes"
    if avg <= 3 and recommendation in ("strong_yes", "yes"):
        return "hesitant"
    return recommendation


def _compute_confidence(calls: list[dict]) -> int:
    completed = [c for c in calls if c.get("status") == "completed"]
    if len(completed) < 2:
        return max(30, min(50, len(completed) * 25))
    variances = []
    for dim in DIMENSIONS:
        key = f"{dim}_score"
        scores = [c.get(key, 0) for c in completed if c.get(key, 0) > 0]
        if len(scores) >= 2:
            mean = sum(scores) / len(scores)
            var = sum((s - mean) ** 2 for s in scores) / len(scores)
            variances.append(var)
    if not variances:
        return 50
    avg_var = sum(variances) / len(variances)
    base = 90 - (avg_var * 5)
    ref_bonus = min(10, (len(completed) - 2) * 5)
    return max(20, min(98, int(base + ref_bonus)))


def _count_transcript_turns(transcript: str) -> int:
    if not transcript:
        return 0
    return sum(1 for line in transcript.strip().split("\n")
               if line.startswith("Bot:") or line.startswith("User:"))


IDENTITY_AFFIRMATIVE = (
    "yes", "yeah", "yep", "that's me", "speaking", "this is",
)
IDENTITY_NEGATIVE = (
    "no", "wrong", "not",
)

CONSENT_AFFIRMATIVE = (
    "yes", "yeah", "yep", "sure", "okay", "ok", "go ahead", "fine",
    "that's fine", "no problem", "absolutely", "of course", "certainly",
    "no worries", "sounds good", "that works", "all good", "please",
)
CONSENT_NEGATIVE = (
    "no", "don't", "decline", "rather not", "not okay", "prefer not",
    "i'd rather", "not comfortable", "not interested",
)

_AMBIGUOUS = "ambiguous"


def _keyword_check_identity(transcript: str, reference_name: str):
    if not transcript or not reference_name:
        return False
    lines = transcript.strip().split("\n")
    first_name = reference_name.split()[0].lower()
    for i, line in enumerate(lines):
        if "am i speaking with" in line.lower():
            for response_line in lines[i + 1:i + 3]:
                if response_line.startswith("User:"):
                    text = response_line[5:].lower()
                    if any(w in text for w in IDENTITY_AFFIRMATIVE) or first_name in text:
                        return True
                    if any(w in text for w in IDENTITY_NEGATIVE):
                        return False
                    return _AMBIGUOUS
            break
    return False


def _keyword_check_consent(transcript: str):
    if not transcript:
        return False
    lines = transcript.strip().split("\n")
    for i, line in enumerate(lines):
        if "analyzed by ai" in line.lower() or "is that okay" in line.lower():
            for response_line in lines[i + 1:i + 3]:
                if response_line.startswith("User:"):
                    text = response_line[5:].lower()
                    if any(w in text for w in CONSENT_AFFIRMATIVE):
                        return True
                    if any(w in text for w in CONSENT_NEGATIVE):
                        return False
                    return _AMBIGUOUS
            break
    return False


def _llm_check_yes_no(question: str, context: str) -> bool:
    prompt = f"""{question}

TRANSCRIPT EXCERPT:
{context[:500]}

Answer with ONLY "yes" or "no". Nothing else."""
    try:
        response = _get_client().models.generate_content(
            model=GEMINI_MODEL, contents=prompt,
        )
        return response.text.strip().lower().startswith("yes")
    except Exception:
        return False


def _check_identity_confirmed(transcript: str, reference_name: str) -> bool:
    result = _keyword_check_identity(transcript, reference_name)
    if result is not _AMBIGUOUS:
        return result
    lines = transcript.strip().split("\n")[:10]
    excerpt = "\n".join(lines)
    return _llm_check_yes_no(
        f"Did the person who answered confirm they are {reference_name}?",
        excerpt,
    )


def _check_consent_given(transcript: str) -> bool:
    result = _keyword_check_consent(transcript)
    if result is not _AMBIGUOUS:
        return result
    lines = transcript.strip().split("\n")[:10]
    excerpt = "\n".join(lines)
    return _llm_check_yes_no(
        "Did the person consent to having this call analyzed by AI?",
        excerpt,
    )


def _count_questions_answered(transcript: str) -> int:
    if not transcript:
        return 0
    lines = transcript.strip().split("\n")
    count = 0
    for marker in QUESTION_MARKERS:
        found = False
        for i, line in enumerate(lines):
            if found:
                break
            if line.startswith("Bot:") and re.search(marker, line.lower()):
                for response in lines[i + 1:i + 3]:
                    if response.startswith("User:") and len(response) > 10:
                        count += 1
                        found = True
                        break
    return count


def assess_call_quality(transcript: str, reference_name: str) -> dict:
    turns = _count_transcript_turns(transcript)
    identity_confirmed = _check_identity_confirmed(transcript, reference_name)
    consent_given = _check_consent_given(transcript)
    questions_answered = _count_questions_answered(transcript)

    if not identity_confirmed:
        quality_status = "wrong_person"
    elif not consent_given:
        quality_status = "no_consent"
    elif turns < MIN_TRANSCRIPT_TURNS:
        quality_status = "insufficient"
    elif questions_answered < MIN_QUESTIONS_ANSWERED:
        quality_status = "partial"
    else:
        quality_status = "verified"

    return {
        "quality_status": quality_status,
        "turn_count": turns,
        "identity_confirmed": identity_confirmed,
        "consent_given": consent_given,
        "questions_answered": questions_answered,
    }


def _validate_call_analysis(analysis: dict, transcript: str) -> dict:
    for field in SCORE_FIELDS:
        analysis[field] = _clamp_score(analysis.get(field), field)

    rec = analysis.get("overall_recommendation", "neutral")
    if rec not in VALID_RECOMMENDATIONS:
        analysis["overall_recommendation"] = "neutral"

    scores = {d: analysis.get(f"{d}_score", 0) for d in DIMENSIONS}
    analysis["overall_recommendation"] = _check_score_recommendation_coherence(
        scores, analysis["overall_recommendation"]
    )

    for field in ("strengths", "growth_areas", "key_quotes"):
        val = analysis.get(field)
        if not isinstance(val, list):
            analysis[field] = []

    if transcript:
        verified_quotes = []
        for q in analysis.get("key_quotes", []):
            if isinstance(q, str) and _fuzzy_match(q, transcript):
                verified_quotes.append(q)
        analysis["key_quotes"] = verified_quotes
        analysis["_quotes_verified"] = True

    evidence = analysis.get("evidence", {})
    if isinstance(evidence, dict) and transcript:
        validated_evidence = {}
        for dim, excerpt in evidence.items():
            if isinstance(excerpt, str) and _fuzzy_match(excerpt, transcript):
                validated_evidence[dim] = excerpt
            else:
                dim_key = f"{dim}_score" if not dim.endswith("_score") else dim
                plain_dim = dim.replace("_score", "")
                if plain_dim in DIMENSIONS and analysis.get(dim_key, 0) > 0:
                    analysis[dim_key] = 0
        analysis["evidence"] = validated_evidence
    elif not isinstance(evidence, dict):
        analysis["evidence"] = {}

    if not isinstance(analysis.get("ref_summary"), str):
        analysis["ref_summary"] = ""

    return analysis


def _validate_cross_analysis(cross: dict, calls: list[dict]) -> dict:
    rec = cross.get("hire_recommendation", "")
    if rec not in VALID_HIRE_RECOMMENDATIONS:
        cross["hire_recommendation"] = "lean_hire"

    discs = cross.get("discrepancies", [])
    if not isinstance(discs, list):
        discs = []
    validated_discs = []
    for d in discs:
        if not isinstance(d, dict):
            continue
        sev = d.get("severity", "minor")
        if sev not in VALID_SEVERITIES:
            d["severity"] = "minor"
        if d.get("dimension") and d.get("detail"):
            validated_discs.append(d)
    cross["discrepancies"] = validated_discs

    if not isinstance(cross.get("overall_summary"), str):
        cross["overall_summary"] = ""

    cross["confidence_score"] = _compute_confidence(calls)

    return cross


def extract_transcript(call_result: dict) -> str:
    recipients = call_result.get("recipients", [])
    if recipients:
        attempts = recipients[0].get("attempts", [])
        if attempts:
            turns = attempts[0].get("transcript_turns", [])
            if turns:
                lines = []
                for t in turns:
                    speaker = "Bot" if t.get("speaker") == "bot" else "User"
                    lines.append(f"{speaker}: {t.get('text', '')}")
                return "\n".join(lines)
    return call_result.get("transcript", "")


def analyze_call_result(candidate_name: str, ref_name: str,
                        ref_relation: str, call_result: dict) -> dict:
    candidate_name = sanitize_name(candidate_name)
    ref_name = sanitize_name(ref_name)
    ref_relation = sanitize_name(ref_relation)
    summary = call_result.get("summary", "")
    transcript = extract_transcript(call_result)

    prompt = f"""You are analyzing a professional reference check call.

CANDIDATE: {candidate_name}
REFERENCE: {ref_name} ({ref_relation})

CALL RESULTS:
- Call summary: {summary}
- Transcript:
{transcript[:3000]}

Extract and return a JSON object with these exact fields:
- "collaboration_score": integer 1-10
- "technical_ability_score": integer 1-10
- "reliability_score": integer 1-10
- "communication_score": integer 1-10
- "leadership_score": integer 1-10
- "evidence": object mapping each dimension to a direct quote or close paraphrase from the transcript that justifies the score. Keys: "collaboration", "technical_ability", "reliability", "communication", "leadership". Each value must be text that actually appears in the transcript.
- "strengths": list of 2-3 key strengths mentioned
- "growth_areas": list of areas for improvement mentioned
- "overall_recommendation": one of "strong_yes", "yes", "neutral", "hesitant", "no"
- "key_quotes": list of 2-3 notable direct quotes from the reference
- "ref_summary": 3-4 sentence summary of the reference's assessment

Base your analysis on the transcript. Infer scores from the reference's tone, specific examples, and explicit ratings.
Every evidence value and key_quote MUST be traceable to actual words in the transcript — do not fabricate or paraphrase beyond recognition.
Return ONLY valid JSON, no markdown formatting."""

    raw = _gemini_with_retry(prompt)
    return _validate_call_analysis(raw, transcript)


def cross_reference_analysis(candidate_name: str, role_title: str,
                             calls: list[dict]) -> dict:
    candidate_name = sanitize_name(candidate_name)
    role_title = sanitize_name(role_title)
    refs_summary = []
    for c in calls:
        refs_summary.append({
            "reference": c.get("ref_name", "Unknown"),
            "relation": c.get("ref_relation", "Unknown"),
            "collaboration": c.get("collaboration_score"),
            "technical": c.get("technical_ability_score"),
            "reliability": c.get("reliability_score"),
            "communication": c.get("communication_score"),
            "leadership": c.get("leadership_score"),
            "recommendation": c.get("overall_recommendation"),
            "strengths": c.get("strengths", []),
            "growth_areas": c.get("growth_areas", []),
            "summary": c.get("summary", ""),
        })

    prompt = f"""You are a senior hiring analyst reviewing reference check results.

CANDIDATE: {candidate_name}
ROLE: {role_title}

REFERENCE RESULTS:
{json.dumps(refs_summary, indent=2)}

Analyze all references together and return a JSON object with:
- "discrepancies": list of objects, each with "dimension" (which score/trait), "detail" (what doesn't match), and "severity" ("minor", "notable", "major"). Look for:
  - Score gaps of 3+ points on the same dimension
  - One reference mentioning a growth area that others cite as a strength
  - Hesitant vs enthusiastic recommendations
  - Contradictory quotes or assessments
- "overall_summary": 4-5 sentence summary of the candidate based on all references combined
- "hire_recommendation": one of "strong_hire", "hire", "lean_hire", "lean_no", "no_hire"
- "confidence_score": integer 1-100 representing how confident we should be in this assessment (lower if references disagree significantly)

Be specific about discrepancies — name the references involved and the exact dimension.
Return ONLY valid JSON, no markdown formatting."""

    raw = _gemini_with_retry(prompt)
    return _validate_cross_analysis(raw, calls)
