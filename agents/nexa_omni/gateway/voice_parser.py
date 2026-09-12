import logging
from typing import Dict, Any

logger = logging.getLogger("NEXA_VOICE_PARSER")

class VoiceToGridParser:
    """
    Parses natural language speech streams into spatial lattice grid intents 
    and target node parameters.
    """
    def __init__(self):
        logger.info("Voice-to-Grid Intent Mapping Engine initialized.")

    def parse_utterance(self, utterance: str) -> Dict[str, Any]:
        utterance_lower = utterance.lower()
        
        # Default parsing targets
        target_node = 4
        intent = "QUERY_TELEMETRY"
        sector = "Sector-D"
        
        if "node" in utterance_lower:
            words = utterance_lower.split()
            for i, word in enumerate(words):
                if word == "node" and i + 1 < len(words):
                    try:
                        target_node = int(words[i+1])
                    except ValueError:
                        pass

        if "override" in utterance_lower or "isolation" in utterance_lower or "emergency" in utterance_lower:
            intent = "TRIGGER_EMERGENCY_ISOLATION"
        elif "check" in utterance_lower or "temperature" in utterance_lower or "status" in utterance_lower:
            intent = "QUERY_TELEMETRY"

        return {
            "intent": intent,
            "target_node": target_node,
            "target_sector": sector,
            "spatial_coordinates": {"x": 342.0, "y": 248.0, "zoom": 2.5},
            "action_flag": "ISOLATE_NODE" if intent == "TRIGGER_EMERGENCY_ISOLATION" else "QUERY"
        }