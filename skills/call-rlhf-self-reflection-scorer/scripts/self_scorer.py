import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional

class EvaluationSource(str, Enum):
    EXPLICIT_USER = "explicit_user"
    SELF_CRITIQUE = "self_critique"

@dataclass
class EvaluationResult:
    phone_number: str
    source: EvaluationSource
    score: int
    critique: Optional[str]
    recommendation: str

class SelfReflectionScorer:
    def __init__(self):
        # Mock LLM-as-a-judge prompt templates
        self.critique_prompt = "Analyze this transcript. Identify one major mistake the agent made and provide a specific recommendation."
        
    def evaluate_transcript(self, transcript: str) -> dict:
        """
        Runs a mocked LLM-as-a-Judge routine over the transcript.
        """
        text = transcript.lower()
        if not text.strip():
            return {
                "score": 0,
                "critique": "Transcript is empty.",
                "recommendation": "Check audio pipeline or user drop-off."
            }
            
        if "account number" in text and "don't have" in text:
            return {
                "score": 2,
                "critique": "Agent repeatedly pressed for account number when user explicitly stated they didn't have it.",
                "recommendation": "Offer alternative verification methods like Name and DOB if account number is unavailable."
            }
            
        if "angry" in text or "frustrated" in text:
            return {
                "score": 3,
                "critique": "User expressed frustration which was not adequately de-escalated.",
                "recommendation": "Use empathy statements earlier in the interaction."
            }
            
        return {
            "score": 5,
            "critique": "Agent handled the inquiry well.",
            "recommendation": "Maintain polite and concise tone."
        }
        
    def process_post_call(self, phone_number: str, explicit_score: int, transcript: str) -> EvaluationResult:
        """
        Main entry point for the post-call reflection hook.
        Strictly respects compliance regarding the phone number.
        """
        if not phone_number.startswith("555-01"):
            raise ValueError(f"Compliance Error: Real phone numbers are prohibited. Use 555-01xx range. Got {phone_number}")
            
        source = EvaluationSource.EXPLICIT_USER if explicit_score else EvaluationSource.SELF_CRITIQUE
        
        if explicit_score and explicit_score >= 4:
            return EvaluationResult(
                phone_number=phone_number,
                source=source,
                score=explicit_score,
                critique=None,
                recommendation="Continue current strategy. High explicit CSAT."
            )
        else:
            # Self-evaluate the transcript if explicit score is low or missing (0)
            llm_eval = self.evaluate_transcript(transcript)
            return EvaluationResult(
                phone_number=phone_number,
                source=source,
                score=explicit_score if explicit_score else llm_eval["score"],
                critique=llm_eval["critique"],
                recommendation=llm_eval["recommendation"]
            )
