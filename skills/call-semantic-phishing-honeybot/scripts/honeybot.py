import re

class HoneybotExtractor:
    def __init__(self):
        # Basic regex patterns for IoCs
        self.url_pattern = re.compile(r'(?:https?://)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)')
        self.crypto_pattern = re.compile(r'\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b') # Simple Bitcoin address regex

    def extract_iocs(self, transcript_turn: str) -> dict:
        """
        Extracts Indicators of Compromise (IoCs) from a single turn of the scammer's speech.
        :param transcript_turn: The text spoken by the scammer.
        :return: Dictionary containing extracted URLs and Crypto Wallets.
        """
        urls = self.url_pattern.findall(transcript_turn)
        wallets = self.crypto_pattern.findall(transcript_turn)
        
        return {
            "urls": list(set(urls)),
            "crypto_wallets": list(set(wallets))
        }

    def process_scammer_turn(self, caller_number: str, text: str) -> dict:
        """
        Main entry point for processing the scammer's audio/text stream.
        Strictly respects compliance regarding the phone number.
        """
        if not caller_number.startswith("555-01"):
            raise ValueError("Compliance Error: Real phone numbers are prohibited. Use 555-01xx range.")
            
        iocs = self.extract_iocs(text)
        
        return {
            "caller_number": caller_number,
            "extracted_iocs": iocs,
            "action": "continue_baiting"
        }
