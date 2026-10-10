import os

from typing import Any, Dict

from dotenv import load_dotenv
from calle import CalleClient


# ============================================================
# ENVIRONMENT
# ============================================================

APP_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

load_dotenv(
    os.path.join(
        APP_DIR,
        ".env",
    )
)


# ============================================================
# STRUCTURED RESULT SCHEMA
# ============================================================

RESULT_SCHEMA = {
    "type": "object",

    "required": [
        "call_completed",
        "churn_risk",
        "cancellation_intent",
        "primary_reason",
        "recoverable",
        "offer_eligibility",
        "recommended_offer",
        "offer_presented",
        "customer_decision",
        "human_follow_up_required",
        "evidence",
    ],

    "properties": {

        "call_completed": {
            "type": "boolean",
            "description": (
                "True only if a real customer conversation "
                "was completed."
            ),
        },

        "churn_risk": {
            "type": "string",
            "enum": [
                "low",
                "medium",
                "high",
                "unknown",
            ],
        },

        "cancellation_intent": {
            "type": "string",
            "enum": [
                "considering",
                "serious",
                "confirmed",
                "unknown",
            ],
        },

        "primary_reason": {
            "type": "string",
            "enum": [
                "price",
                "product",
                "support_experience",
                "technical_issue",
                "competitor",
                "low_usage",
                "temporary_need",
                "other",
                "unknown",
            ],
            "description": (
                "The customer's main stated reason for "
                "considering cancellation."
            ),
        },

        "recoverable": {
            "type": "string",
            "enum": [
                "yes",
                "no",
                "unknown",
            ],
        },

        "offer_eligibility": {
            "type": "string",
            "enum": [
                "eligible",
                "no_eligible_offer",
                "unknown",
            ],
        },

        "recommended_offer": {
            "type": "string",
            "enum": [
                "save20",
                "pause30",
                "support_escalation",
                "none",
                "unknown",
            ],
            "description": (
                "The retention option that best addresses "
                "the customer's stated problem, if authorized."
            ),
        },

        "offer_presented": {
            "type": "string",
            "enum": [
                "save20",
                "pause30",
                "support_escalation",
                "none",
                "unknown",
            ],
        },

        "customer_decision": {
            "type": "string",
            "enum": [
                "accepted",
                "declined",
                "undecided",
                "requested_human",
                "unknown",
            ],
        },

        "human_follow_up_required": {
            "type": "boolean",
        },

        "evidence": {
            "type": "array",
            "items": {
                "type": "string",
            },
        },
    },

    "additionalProperties": False,
}


# ============================================================
# CALL TASK
# ============================================================

def build_call_task(
    customer: Dict[str, Any],
    policy: Dict[str, Any],
    company: Dict[str, Any],
    product: Dict[str, Any],
) -> str:

    company_name = company.get(
        "name",
        "the company",
    )

    product_name = product.get(
        "name",
        "subscription",
    )

    offer_blocks = []

    for offer in policy.get(
        "offers",
        [],
    ):

        offer_blocks.append(
            f"""
Offer ID: {offer["id"]}
Offer: {offer["label"]}
Description: {offer["description"]}
Eligible plans: {", ".join(offer["plan_in"])}
Minimum tenure: {offer["min_tenure_months"]} months
Eligible reasons: {", ".join(offer["reasons"])}
Human follow-up required: {offer["requires_human"]}
""".strip()
        )

    offers_text = "\n\n".join(
        offer_blocks
    )

    return f"""
You are an AI customer-retention assistant for {company_name}.

You are calling a customer about their {product_name} subscription.

CUSTOMER
--------
Name: {customer["name"]}
Customer ID: {customer["customer_id"]}
Plan: {customer["plan"]}
Tenure: {customer["tenure_months"]} months


CONVERSATION GOAL
-----------------
Have a short, respectful conversation to understand why
the customer is considering cancellation.

You must discover the customer's actual reason from the
conversation. Do not assume the reason from their plan,
tenure, profile, or cancellation trigger.

Clearly disclose that you are an AI assistant.

Ask whether it is a good time to talk.

Ask why the customer is considering cancellation.

Ask a short follow-up question when needed.

After the customer's reason becomes clear, determine which
authorized retention action best addresses that specific reason.

Only use the options listed below.

Do not present an offer before understanding the customer's
reason.


AUTHORIZED RETENTION OPTIONS
----------------------------
{offers_text}


BUSINESS RULES
--------------
- These are the only commercial actions you may present.
- Never invent a discount.
- Never increase or modify an offer.
- Never combine multiple offers.
- Never create an unauthorized refund, credit, extension,
  free period, or price.
- If no authorized option applies, do not improvise.
- If the customer requests a human, require human follow-up.
- Never request passwords, OTPs, payment-card details,
  authentication codes, or security answers.
- Do not pressure or manipulate the customer.
- Respect the customer's decision to cancel.


OFFER SELECTION LOGIC
---------------------
The conversation determines the problem.

Then:

customer reason
    ↓
customer plan + tenure
    ↓
authorized policy
    ↓
most suitable eligible action

The offer is NOT predetermined before the conversation.

If multiple authorized options somehow apply, select the one
that most directly addresses the customer's stated problem.

If none applies:

recommended_offer = "none"
offer_presented = "none"


FINAL RESULT
------------
Return only information supported by the conversation.

Do not infer that the customer accepted an offer from silence,
politeness, or vague agreement.

Use "unknown" whenever the evidence is insufficient.

A failed or unanswered call must not be treated as a customer
retention decision.
""".strip()


# ============================================================
# MAIN CALL FUNCTION
# ============================================================

def call_customer(
    customer: Dict[str, Any],
    config: Dict[str, Any],
) -> Dict[str, Any]:

    api_key = os.getenv(
        "CALLE_API_KEY"
    )

    if not api_key:

        raise RuntimeError(
            "CALLE_API_KEY is missing from .env."
        )

    client = CalleClient(
        api_key=api_key
    )

    policy = config.get(
        "retention_policy",
        {},
    )

    company = config.get(
        "company",
        {},
    )

    product = config.get(
        "product",
        {},
    )

    task = build_call_task(
        customer,
        policy,
        company,
        product,
    )

    # Region and locale are intentionally omitted.
    # CALL-E can plan using the phone destination and task.
    call = client.calls.create_and_wait(
        task=task,

        recipients=[
            {
                "phones": [
                    customer["phone"]
                ]
            }
        ],

        result_schema=RESULT_SCHEMA,

        metadata={
            "workflow": "customer-churn-rescue",
            "customer_id": customer[
                "customer_id"
            ],
            "company": company.get(
                "name",
                "unknown",
            ),
        },

        # A unique key means each explicit test attempt is
        # treated as a new call rather than returning a prior call.
        idempotency_key=(
            "churn-rescue:"
            f"{customer['customer_id']}:"
            f"{os.urandom(8).hex()}"
        ),
    )

    return call