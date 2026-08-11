import json
import re
import time
from difflib import SequenceMatcher
from google import genai
from config import GEMINI_API_KEY, GEMINI_MODEL, DIMENSIONS, sanitize_name

_client = None

VALID_RECOMMENDATIONS = {"strong_yes", "yes", "neutral", "hesitant", "no"}
VALID_HIRE_RECOMMENDATIONS = {"strong_hire", "hire", "lean_hire", "lean_no", "no_hire"}
VALID_SEVERITIES = {"minor", "notable", "major"}
SCORE_FIELDS = [f"{d}_score" for d in DIMENSIONS]


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


def _fuzzy_match(quote: str, transcript: str, threshold: float = 0.45) -> bool:
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
- "strengths": list of 2-3 key strengths mentioned
- "growth_areas": list of areas for improvement mentioned
- "overall_recommendation": one of "strong_yes", "yes", "neutral", "hesitant", "no"
- "key_quotes": list of 2-3 notable direct quotes from the reference
- "ref_summary": 3-4 sentence summary of the reference's assessment

Base your analysis on the transcript. Infer scores from the reference's tone, specific examples, and explicit ratings.
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
