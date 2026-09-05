"""Default least-privilege scope for a HIPAA phone scheduler.

Deny-by-default: the only verb allowed is `run_call`, and only to allowlisted
scheduling recipients / regions, with bounded params and a per-call cost cap.
PHI is never part of the scope — the call *content* is the agent's job; the
protocol bounds *whether* and *to whom* the agent may dial.
"""
from safety_protocol.core import ScopeRule

# Closed action vocabulary — an unregistered verb is blocked before any rule.
ALLOWED_VERBS = ["run_call"]

DEFAULT_RULES: list[ScopeRule] = [
    ScopeRule(
        action_type="run_call",
        # Allowlist of recipient fingerprints this agent may dial (demo values).
        # In a real deployment these come from the scheduler's own patient
        # roster; here we show the shape. broad prefixes are rejected by the
        # deny-by-default philosophy — use exact/known fingerprints.
        allowed_targets=[
            "calle:call:fp:80ec4b4820b9e577",  # +155****4567 (demo patient line, masked)
            "calle:call:fp:5fd48603d08c533a",  # +155****4321 (demo clinic line, masked)
        ],
        match="exact",
        methods=["POST"],
        param_schema={
            "properties": {
                "region": {"type": "string", "enum": ["US"]},
                "locale": {"type": "string", "enum": ["en-US", "es-US"]},
                "task_len": {"type": "integer", "minimum": 1, "maximum": 4000},
            },
            "required": ["region", "locale", "task_len"],
            "additional_properties": False,
        },
        max_cost=5.0,            # per-call cap (demo)
        requires_approval=False,
    ),
]
