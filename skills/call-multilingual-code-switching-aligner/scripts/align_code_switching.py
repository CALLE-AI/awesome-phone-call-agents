class CodeSwitchingAligner:
    def __init__(self):
        # A simple list of common Spanish embedding words for a Spanglish prototype
        self.spanish_vocab = {"pero", "y", "porque", "hola", "gracias", "por", "favor", "bueno", "no", "si"}
        
    def detect_cmi(self, transcript_turn: str) -> float:
        """
        Calculates a simplified Code-Mixing Index (CMI) based on vocabulary overlap.
        :param transcript_turn: The user's spoken sentence.
        :return: Float between 0.0 and 1.0 representing the ratio of mixed tokens.
        """
        words = transcript_turn.lower().replace(",", "").replace(".", "").split()
        if not words:
            return 0.0
            
        embedded_count = sum(1 for word in words if word in self.spanish_vocab)
        return embedded_count / len(words)
        
    def process_turn(self, phone_number: str, transcript_turn: str) -> dict:
        """
        Main entry point for processing a conversational turn.
        Strictly respects compliance regarding the phone number.
        """
        if not phone_number.startswith("555-01"):
            raise ValueError("Compliance Error: Real phone numbers are prohibited. Use 555-01xx range.")
            
        cmi = self.detect_cmi(transcript_turn)
        
        # Determine how the LLM should respond
        if cmi > 0.3:
            style = "high_code_switching"
        elif cmi > 0:
            style = "low_code_switching"
        else:
            style = "monolingual_english"
            
        return {
            "phone_number": phone_number,
            "cmi": cmi,
            "prompt_style_injection": style
        }
