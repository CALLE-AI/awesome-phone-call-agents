import re
from dataclasses import dataclass
from enum import Enum
from typing import Set

class PromptStyle(str, Enum):
    HIGH_CODE_SWITCHING = "high_code_switching"
    LOW_CODE_SWITCHING = "low_code_switching"
    MONOLINGUAL = "monolingual_english"

@dataclass
class CodeSwitchingReport:
    phone_number: str
    cmi: float
    prompt_style_injection: PromptStyle
    embedded_words_detected: int
    total_words: int

class CodeSwitchingAligner:
    def __init__(self):
        # A simple list of common Spanish embedding words for a Spanglish prototype
        self.spanish_vocab: Set[str] = {
            "pero", "y", "porque", "hola", "gracias", "por", "favor", 
            "bueno", "no", "si", "pues", "entonces", "claro", "dale"
        }
        
    def detect_cmi(self, transcript_turn: str) -> tuple[float, int, int]:
        """
        Calculates a simplified Code-Mixing Index (CMI) based on vocabulary overlap.
        :param transcript_turn: The user's spoken sentence.
        :return: (CMI float, embedded_words_count, total_words_count)
        """
        if not transcript_turn or not transcript_turn.strip():
            return 0.0, 0, 0
            
        # Strip punctuation and split
        clean_text = re.sub(r'[^\w\s]', '', transcript_turn.lower())
        words = clean_text.split()
        
        if not words:
            return 0.0, 0, 0
            
        embedded_count = sum(1 for word in words if word in self.spanish_vocab)
        cmi = embedded_count / len(words)
        return cmi, embedded_count, len(words)
        
    def process_turn(self, phone_number: str, transcript_turn: str) -> CodeSwitchingReport:
        """
        Main entry point for processing a conversational turn.
        Strictly respects compliance regarding the phone number.
        """
        if not phone_number.startswith("555-01"):
            raise ValueError(f"Compliance Error: Real phone numbers are prohibited. Use 555-01xx range. Got {phone_number}")
            
        cmi, embedded, total = self.detect_cmi(transcript_turn)
        
        # Determine how the LLM should respond
        if cmi >= 0.3:
            style = PromptStyle.HIGH_CODE_SWITCHING
        elif cmi > 0.0:
            style = PromptStyle.LOW_CODE_SWITCHING
        else:
            style = PromptStyle.MONOLINGUAL
            
        return CodeSwitchingReport(
            phone_number=phone_number,
            cmi=cmi,
            prompt_style_injection=style,
            embedded_words_detected=embedded,
            total_words=total
        )
