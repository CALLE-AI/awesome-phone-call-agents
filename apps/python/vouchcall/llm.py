import json
import re
from google import genai
from config import GEMINI_API_KEY, GEMINI_MODEL

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


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

    response = _get_client().models.generate_content(
        model=GEMINI_MODEL, contents=prompt,
    )
    return _parse_json_response(response.text)


def cross_reference_analysis(candidate_name: str, role_title: str,
                             calls: list[dict]) -> dict:
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

    response = _get_client().models.generate_content(
        model=GEMINI_MODEL, contents=prompt,
    )
    return _parse_json_response(response.text)
