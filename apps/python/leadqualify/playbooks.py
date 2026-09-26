from typing import Dict, Any
from config import AGENT_NAME, COMPANY_NAME

def get_qualification_playbook(name: str, company: str, product_interest: str) -> Dict[str, Any]:
    """
    Generates a dynamic task prompt and result schema for CALL-E lead qualification.
    """
    company_phrase = f" from {company}" if company else ""
    product_phrase = f" for {product_interest}" if product_interest else " in our software solutions"
    
    task_prompt = (
        f"LANGUAGE:\n- Speak in English.\n\n"
        f"Call {name}{company_phrase} regarding their recent interest{product_phrase}.\n\n"
        f"TONE AND PACE INSTRUCTIONS:\n"
        f"- Speak very slowly, calmly, and warmly. Take natural pauses between sentences.\n"
        f"- Be extremely patient, polite, and professional. Do not rush the customer.\n\n"
        f"GREETING INSTRUCTION:\n"
        f"Say: 'Hi {name}, this is {AGENT_NAME} from the {COMPANY_NAME} team. I saw you requested info on "
        f"{product_interest if product_interest else 'our solutions'} and wanted to do a quick 1-minute call "
        f"to understand your needs and see how we can best help. Is now a good time?'\n\n"
        f"HANDLING QUESTIONS & INTERRUPTIONS:\n"
        f"- If the customer raises questions, concerns, or asks about the product/purpose of the call, "
        f"listen carefully, answer their question politely and clearly, and then gently transition back to the qualification flow.\n"
        f"- Be helpful and conversational. Do not sound like a rigid script.\n\n"
        f"INTERVIEW GOALS:\n"
        f"If they agree to speak, ask these questions naturally:\n"
        f"1. What is the primary problem or pain point they are looking to solve?\n"
        f"2. When are they looking to implement a solution (immediate, 1-3 months, 3-6 months)?\n"
        f"3. Do they have an allocated budget or are they currently just pricing it out?\n\n"
        f"FLOW CONSTRAINTS:\n"
        f"- Keep the conversation short but relaxed. If they are busy, offer a callback.\n"
        f"- Use their inputs to answer the extraction schema."
    )
    
    result_schema = {
        "type": "object",
        "required": [
            "pain_point",
            "timeline_window",
            "budget_status",
            "interest_level",
            "handoff_recommended",
            "notes"
        ],
        "properties": {
            "pain_point": {
                "type": "string",
                "description": "The primary problem, challenge, or pain point described by the prospect."
            },
            "timeline_window": {
                "type": "string",
                "enum": ["immediate", "1_3_months", "3_6_months", "longer_or_unknown"],
                "description": "When the prospect plans to implement the solution based on their words."
            },
            "budget_status": {
                "type": "string",
                "enum": ["approved", "pricing_out", "no_budget", "unknown"],
                "description": "The status of the budget for this project (e.g., approved, pricing/evaluating, no budget, unknown)."
            },
            "interest_level": {
                "type": "string",
                "enum": ["high", "medium", "low", "not_interested"],
                "description": "The prospect's engagement and interest level assessed during the call."
            },
            "handoff_recommended": {
                "type": "boolean",
                "description": "Set to true if timeline is immediate/1-3 months, budget is approved/pricing, and interest is medium/high."
            },
            "notes": {
                "type": "string",
                "description": "A brief summary of the conversation, key concerns, and recommended next steps."
            }
        },
        "additionalProperties": False
    }
    
    return {
        "task": task_prompt,
        "result_schema": result_schema
    }