"""
webhook.py

Escalates a real CALL-E danger-sign finding to CliniqBridge's actual
create_observation MCP tool (JSON-RPC 2.0 over POST /mcp), matching the
real implementation in CliniqBridge's main.py -- not the invented Flag
resource assumed earlier.
"""

import httpx
import os
import uuid

CLINIQBRIDGE_BASE_URL = os.environ.get("CLINIQBRIDGE_BASE_URL", "https://cliniqbridge.onrender.com")
CLINIQBRIDGE_API_KEY = os.environ.get("CLINIQBRIDGE_API_KEY", "")  # blank if unauthenticated

# Default target FHIR server CliniqBridge writes to if none specified --
# the public HAPI test server, safe for demo purposes.
DEMO_FHIR_BASE_URL = "https://hapi.fhir.org/baseR4"

# Real-world SNOMED CT codes for the danger signs in our screening script.
# Verify these against a terminology browser before relying on them for
# anything beyond a hackathon demo -- picked for plausibility, not
# clinically validated by a licensed source here.
DANGER_SIGN_CODES = {
    "vaginal_bleeding": {"code": "289724008", "display": "Vaginal bleeding"},
    "severe_headache_or_vision_change": {"code": "25064002", "display": "Headache"},
    "reduced_fetal_movement": {"code": "249217002", "display": "Decreased fetal movement"},
    "swelling_face_or_hands": {"code": "267038008", "display": "Facial swelling"},
    "high_fever": {"code": "386661006", "display": "Fever"},
}


async def escalate_danger_signs(
    patient_id: str,
    danger_signs: list[str],
    call_id: str,
    fhir_base_url: str = DEMO_FHIR_BASE_URL,
    status: str = "preliminary",
) -> list[dict]:
    """
    Writes one Observation per human-confirmed danger sign, via
    CliniqBridge's create_observation tool. Defaults to status
    "preliminary" rather than "final" -- the SNOMED codes used here have
    not been independently verified against an authoritative terminology
    source, and this data has not undergone clinical validation. Do not
    pass status="final" without that verification in place.
    """
    results = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for sign in danger_signs:
            sign_info = DANGER_SIGN_CODES.get(sign)
            if not sign_info:
                results.append({"sign": sign, "error": "unrecognized danger sign key"})
                continue

            request_body = {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "tools/call",
                "params": {
                    "name": "create_observation",
                    "arguments": {
                        "patient_id": patient_id,
                        "code": sign_info["code"],
                        "display": sign_info["display"],
                        "value": "Reported positive via SentinelCall follow-up (human-reviewed)",
                        "status": status,
                        "fhir_base_url": fhir_base_url,
                    },
                },
            }

            headers = {
                "Content-Type": "application/json",
                "x-patient-id": patient_id,
                "x-fhir-server-url": fhir_base_url,
            }
            if CLINIQBRIDGE_API_KEY:
                headers["x-fhir-access-token"] = CLINIQBRIDGE_API_KEY

            response = await client.post(
                f"{CLINIQBRIDGE_BASE_URL}/mcp",
                json=request_body,
                headers=headers,
            )
            response.raise_for_status()
            rpc_response = response.json()

            if "error" in rpc_response:
                results.append({"sign": sign, "error": rpc_response["error"]})
            else:
                results.append({
                    "sign": sign,
                    "result": rpc_response.get("result", {}).get("result", {}),
                })

    return results