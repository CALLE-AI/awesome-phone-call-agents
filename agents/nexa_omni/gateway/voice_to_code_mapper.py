import logging
import time
import re
from typing import Dict, Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] (NEXA-VOICE-TO-CODE) — %(message)s")
logger = logging.getLogger("NEXA_VOICE_TO_CODE")

class VoiceToCodeIntentMapper:
    """
    Advanced semantic mapper that translates natural language voice utterances 
    directly into executable code patches, parameter mutations, and AST diffs.
    """
    def __init__(self):
        logger.info("Voice-to-Code Intent Mapper online. Natural language compiler armed.")

    def map_utterance_to_code_patch(self, utterance: str) -> Dict[str, Any]:
        """
        Analyzes semantic intent from text and generates a precise code patch payload.
        """
        start_time = time.perf_counter()
        clean_utterance = utterance.lower().strip()
        
        target_node = 4 # default fallback
        node_match = re.search(r'node\s*(\d+)', clean_utterance)
        if node_match:
            target_node = int(node_match.group(1))

        generated_patch = ""
        action_type = "UNKNOWN"

        # Intent 1: Emergency override / Isolation
        if "override" in clean_utterance or "isolate" in clean_utterance or "band" in clean_utterance:
            action_type = "ISOLATE_NODE_PATCH"
            generated_patch = f"""
# NEXA-OMNI Automated Code Patch [Generated via Voice]
def execute_patch_node_{target_node}():
    lattice_core.set_node_state({target_node}, State.EMERGENCY_OVERRIDE)
    lattice_core.purge_buffers(sector="Sector-Dynamic", force=True)
    logger.critical("Node {target_node} forcefully isolated via voice instruction.")
""".strip()

        # Intent 2: Threshold / Temperature modification
        elif "threshold" in clean_utterance or "temperature" in clean_utterance or "limit" in clean_utterance:
            action_type = "MODIFY_THRESHOLD_PATCH"
            temp_match = re.search(r'(\d+)', clean_utterance)
            limit_val = int(temp_match.group(1)) if temp_match else 85
            generated_patch = f"""
# NEXA-OMNI Thermal Threshold Patch [Generated via Voice]
def execute_patch_node_{target_node}():
    thermal_registry.update_threshold(node_id={target_node}, max_temp_c={limit_val}.0)
    logger.info("Thermal threshold for Node {target_node} adjusted to {limit_val}°C.")
""".strip()

        # Intent 3: General Query / Telemetry Check
        else:
            action_type = "TELEMETRY_QUERY_PATCH"
            generated_patch = f"""
# NEXA-OMNI Telemetry Diagnostic Patch [Generated via Voice]
def execute_patch_node_{target_node}():
    metrics = telemetry_engine.fetch_node_snapshot({target_node})
    return metrics
""".strip()

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"Voice-to-Code mapped '{utterance}' -> Action [{action_type}] in {elapsed_ms:.2f}ms.")

        return {
            "success": True,
            "utterance": utterance,
            "action_type": action_type,
            "target_node": target_node,
            "code_patch": generated_patch,
            "latency_overhead_ms": round(elapsed_ms, 3)
        }