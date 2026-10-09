import re
from dataclasses import dataclass, field
from enum import Enum
from typing import List

class BotAction(str, Enum):
    CONTINUE_BAITING = "continue_baiting"
    TERMINATE_CALL = "terminate_call"
    ESCALATE_TO_HUMAN = "escalate_to_human"

@dataclass
class ExtractedIoCs:
    urls: List[str] = field(default_factory=list)
    crypto_wallets: List[str] = field(default_factory=list)
    phone_numbers: List[str] = field(default_factory=list)

@dataclass
class HoneybotResponse:
    caller_number: str
    extracted_iocs: ExtractedIoCs
    action: BotAction
    bait_prompt: str

class HoneybotExtractor:
    def __init__(self):
        # Basic regex patterns for IoCs
        self.url_pattern = re.compile(r'(?:https?://)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)')
        self.crypto_pattern = re.compile(r'\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b') # Simple Bitcoin address regex
        self.phone_pattern = re.compile(r'\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b')

    def extract_iocs(self, transcript_turn: str) -> ExtractedIoCs:
        """
        Extracts Indicators of Compromise (IoCs) from a single turn of the scammer's speech.
        """
        urls = self.url_pattern.findall(transcript_turn)
        wallets = self.crypto_pattern.findall(transcript_turn)
        phones = self.phone_pattern.findall(transcript_turn)
        
        return ExtractedIoCs(
            urls=list(set(urls)),
            crypto_wallets=list(set(wallets)),
            phone_numbers=list(set(phones))
        )

    def process_scammer_turn(self, caller_number: str, text: str) -> HoneybotResponse:
        """
        Main entry point for processing the scammer's audio/text stream.
        Strictly respects compliance regarding the phone number.
        """
        if not caller_number.startswith("555-01"):
            raise ValueError(f"Compliance Error: Real phone numbers are prohibited. Use 555-01xx range. Got {caller_number}")
            
        iocs = self.extract_iocs(text)
        
        # Decide action based on extracted IoCs
        action = BotAction.CONTINUE_BAITING
        bait_prompt = "Act confused and ask them to repeat the instructions slowly."
        
        if len(iocs.crypto_wallets) > 0:
            bait_prompt = "Pretend you don't know how to use Bitcoin and ask for alternative payment methods to stall them."
        elif len(iocs.urls) > 0:
            bait_prompt = "Tell them the website is blocked by your antivirus and ask what to do next."
            
        return HoneybotResponse(
            caller_number=caller_number,
            extracted_iocs=iocs,
            action=action,
            bait_prompt=bait_prompt
        )
