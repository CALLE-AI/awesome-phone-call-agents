import json
import re
import time
from difflib import SequenceMatcher
from google import genai
from config import (
    GEMINI_API_KEY, GEMINI_MODEL, DIMENSIONS, sanitize_name,
    MIN_TRANSCRIPT_TURNS, MIN_QUESTIONS_ANSWERED, EXPECTED_QUESTIONS,
    RELATION_WEIGHTS,
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


def _ref_weight(call: dict) -> float:
    """Compute a reference's weight based on relation type and call quality.

    Weight = relation_weight × quality_discount

    relation_weight: seniority/proximity to the candidate determines base
    importance. A direct manager (1.5×) carries more weight than a peer (1.0×)
    because they observed performance more closely and evaluated it formally.

    quality_discount: min(1.0, questions_answered / expected_questions). A full
    6-question call gets 1.0; a 3-question call gets 0.5. This prevents short
    calls from carrying disproportionate influence without zeroing them out.

    CALL-E completion_confidence is intentionally excluded — it measures audio/
    connection quality, not reference credibility. A manager on a choppy line
    still matters more than a peer with perfect audio.
    """
    relation = (call.get("ref_relation") or "").lower().strip()
    base = RELATION_WEIGHTS.get(relation, 1.0)
    qa = call.get("questions_answered", EXPECTED_QUESTIONS)
    quality_discount = min(1.0, qa / EXPECTED_QUESTIONS) if EXPECTED_QUESTIONS > 0 else 1.0
    return base * quality_discount


def _compute_confidence(calls: list[dict]) -> int:
    completed = [c for c in calls if c.get("status") == "completed"]
    if len(completed) < 2:
        return max(30, min(50, len(completed) * 25))
    weights = [_ref_weight(c) for c in completed]
    total_w = sum(weights) or 1.0
    variances = []
    for dim in DIMENSIONS:
        key = f"{dim}_score"
        pairs = [(c.get(key, 0), w) for c, w in zip(completed, weights) if c.get(key, 0) > 0]
        if len(pairs) >= 2:
            w_sum = sum(w for _, w in pairs)
            if w_sum > 0:
                w_mean = sum(s * w for s, w in pairs) / w_sum
                w_var = sum(w * (s - w_mean) ** 2 for s, w in pairs) / w_sum
                variances.append(w_var)
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
    if not transcript or not reference_name:
        return False
    lines = transcript.strip().split("\n")[:10]
    excerpt = "\n".join(lines)
    return _llm_check_yes_no(
        f"Did the person who answered confirm they are {reference_name}?",
        excerpt,
    )


def _check_consent_given(transcript: str) -> bool:
    if not transcript:
        return False
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
    """Analyze all references together with relation-based weighting.

    Each reference is assigned a weight (shown as 'weight' in the prompt) so
    the LLM knows a manager's 8/10 matters more than a peer's 8/10. See
    _ref_weight() for the formula.
    """
    candidate_name = sanitize_name(candidate_name)
    role_title = sanitize_name(role_title)
    refs_summary = []
    for c in calls:
        refs_summary.append({
            "reference": c.get("ref_name", "Unknown"),
            "relation": c.get("ref_relation", "Unknown"),
            "weight": round(_ref_weight(c), 2),
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

Each reference has a "weight" field (higher = more influential). Weights reflect the reference's relationship to the candidate (e.g. a direct manager weighs more than a peer) and call completeness. Give proportionally more consideration to higher-weighted references when forming your recommendation.

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
