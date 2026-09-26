import logging
from typing import Dict, Any, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] (NEXA-CONSTRAINT-ENFORCER) — %(message)s")
logger = logging.getLogger("NEXA_CONSTRAINT_ENFORCER")

class RuleBasedConstraintEnforcer:
    """
    Enterprise-grade deterministic rule enforcer and boundary validator 
    for NEXA-OMNI spatial lattice pipelines. Blocks invalid syntax, unmapped 
    node configurations, and hazardous unauthorized state overrides.
    """
    def __init__(self, max_allowed_nodes: int = 10000000):
        self.max_allowed_nodes = max_allowed_nodes
        self.blocked_intents_count = 0
        logger.info(f"Constraint Enforcer online. Max lattice capacity bounded at {self.max_allowed_nodes:,} nodes.")

    def enforce_constraints(self, intent: str, target_node: Optional[int], payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates input parameters against strict immutable enterprise rules.
        Returns enforcement verdict, modified payload (if sanitized), and rejection reasons.
        """
        # Rule 1: Node bounds validation
        if target_node is not None:
            if target_node < 1 or target_node > self.max_allowed_nodes:
                self.blocked_intents_count += 1
                logger.warning(f"BLOCKED: Node index {target_node} violates global spatial constraints.")
                return {
                    "allowed": False,
                    "error_code": "ERR_NODE_OUT_OF_BOUNDS",
                    "message": f"Constraint Violation: Node {target_node} is outside valid range [1, {self.max_allowed_nodes:,}].",
                    "remediation": "Provide a valid active node reference."
                }

        # Rule 2: Syntax & Malformed Payload check
        if not intent or not isinstance(intent, str):
            self.blocked_intents_count += 1
            logger.warning("BLOCKED: Malformed intent syntax detected.")
            return {
                "allowed": False,
                "error_code": "ERR_MALFORMED_SYNTAX",
                "message": "Constraint Violation: Intent string is missing, null, or improperly typed.",
                "remediation": "Re-serialize intent structure through VoiceToGridParser."
            }

        # Rule 3: Unauthorized Hazardous Overrides
        restricted_actions = ["SYSTEM_PURGE", "CORE_SHUTDOWN", "UNBIND_ALL_LATTICES"]
        if intent in restricted_actions:
            security_token = payload.get("security_token", None)
            if security_token != "ARCHITECT_OMEGA_2026":
                self.blocked_intents_count += 1
                logger.error(f"CRITICAL: Unauthorized attempt to execute restricted action '{intent}' without proper credentials.")
                return {
                    "allowed": False,
                    "error_code": "ERR_UNAUTHORIZED_OVERRIDE",
                    "message": f"Security Policy Violation: Action '{intent}' requires elevated architect clearance.",
                    "remediation": "Attach valid cryptographic security token."
                }

        # Rule 4: Thermal & Load Safety Boundary Check
        node_load = payload.get("load_percentage", 0.0)
        if node_load > 100.0:
            logger.info("Sanitizing payload: Clamping abnormal load percentage to 100.0%")
            payload["load_percentage"] = 100.0

        logger.info(f"VERIFIED: Intent '{intent}' for Node {target_node} passed all constraint rules.")
        return {
            "allowed": True,
            "error_code": None,
            "message": "All rule-based constraints satisfied successfully.",
            "sanitized_payload": payload
        }

    def get_enforcement_telemetry(self) -> Dict[str, Any]:
        return {
            "status": "ACTIVE_MONITORING",
            "total_violations_blocked": self.blocked_intents_count,
            "boundary_limit": self.max_allowed_nodes
        }