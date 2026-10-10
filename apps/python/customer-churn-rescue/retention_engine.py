import json
import os
import re
import urllib.error
import urllib.request

from pathlib import Path
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv


APP_DIR = Path(__file__).resolve().parent
CONFIG_FILE = APP_DIR / "company_config.json"

ENV_FILE = APP_DIR / ".env"

load_dotenv(
    ENV_FILE
)


# ============================================================
# CONFIGURATION
# ============================================================

def load_config() -> Dict[str, Any]:
    """Load the complete company configuration."""

    with open(
        CONFIG_FILE,
        "r",
        encoding="utf-8",
    ) as file:
        return json.load(file)


def load_policy() -> Dict[str, Any]:
    """Return the retention policy."""

    config = load_config()

    return config.get(
        "retention_policy",
        {},
    )


# ============================================================
# POLICY ENGINE
# ============================================================

def normalize_reason(
    reason: str,
) -> str:

    if not reason:
        return "unknown"

    return reason.strip().lower()


def get_eligible_offers(
    customer: Dict[str, Any],
    primary_reason: str,
    policy: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Find all offers the customer is eligible for AFTER
    the customer's churn reason has been established.
    """

    reason = normalize_reason(
        primary_reason
    )

    plan = str(
        customer.get(
            "plan",
            "",
        )
    ).lower()

    tenure = int(
        customer.get(
            "tenure_months",
            0,
        )
    )

    eligible = []

    for offer in policy.get(
        "offers",
        [],
    ):

        allowed_plans = [
            str(value).lower()
            for value in offer.get(
                "plan_in",
                [],
            )
        ]

        allowed_reasons = [
            str(value).lower()
            for value in offer.get(
                "reasons",
                [],
            )
        ]

        minimum_tenure = int(
            offer.get(
                "min_tenure_months",
                0,
            )
        )

        if plan not in allowed_plans:
            continue

        if tenure < minimum_tenure:
            continue

        if reason not in allowed_reasons:
            continue

        eligible.append(offer)

    return eligible


def get_best_offer(
    customer: Dict[str, Any],
    primary_reason: str,
    policy: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Return a suitable authorized offer.

    None means no authorized offer applies.
    """

    eligible = get_eligible_offers(
        customer,
        primary_reason,
        policy,
    )

    if not eligible:
        return None

    return eligible[0]


def validate_returned_offer(
    customer: Dict[str, Any],
    primary_reason: str,
    returned_offer_id: str,
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Check whether the offer returned by CALL-E matches
    the business policy.
    """

    if (
        not returned_offer_id
        or returned_offer_id == "none"
        or returned_offer_id == "unknown"
    ):
        expected = get_best_offer(
            customer,
            primary_reason,
            policy,
        )

        return {
            "authorized": expected is None,
            "reason": (
                "no_eligible_offer"
                if expected is None
                else "eligible_offer_not_presented"
            ),
            "expected_offer": (
                expected["id"]
                if expected
                else "none"
            ),
            "returned_offer": "none",
        }

    expected = get_best_offer(
        customer,
        primary_reason,
        policy,
    )

    if expected is None:

        return {
            "authorized": False,
            "reason": "no_eligible_offer_exists",
            "expected_offer": "none",
            "returned_offer": returned_offer_id,
        }

    expected_id = expected["id"]

    if returned_offer_id != expected_id:

        return {
            "authorized": False,
            "reason": "returned_offer_not_authorized",
            "expected_offer": expected_id,
            "returned_offer": returned_offer_id,
        }

    return {
        "authorized": True,
        "reason": "offer_matches_policy",
        "authorized_offer": expected_id,
        "returned_offer": returned_offer_id,
    }


# ============================================================
# POST-CALL LLM ANALYSIS
# ============================================================

def _extract_json_object(
    text: str,
) -> Optional[Dict[str, Any]]:
    """Extract JSON from plain or fenced LLM output."""

    text = text.strip()

    fenced = re.search(
        r"```(?:json)?\s*(\{.*?\})\s*```",
        text,
        flags=re.DOTALL,
    )

    if fenced:

        text = fenced.group(1)

    try:
        data = json.loads(text)

        return data if isinstance(data, dict) else None

    except json.JSONDecodeError:
        return None


def analyze_transcript_with_llm(
    transcript: str,
) -> Dict[str, Any]:
    """
    Optional post-call analysis using OpenRouter.

    This is advisory only.
    It does not authorize or create commercial offers.
    """

    api_key = os.getenv(
        "OPENROUTER_API_KEY"
    )

    if not api_key:

        return {
            "enabled": False,
            "reason": "OPENROUTER_API_KEY is not configured.",
        }

    model = os.getenv(
        "LLM_MODEL",
        "openrouter/free",
    )

    prompt = f"""
You are a post-call customer-retention analyst for a subscription company.

Analyze this completed customer-retention conversation.

Return ONLY valid JSON with these fields:

{{
  "customer_pain_point": "",
  "communication_tone": "",
  "retention_opportunity": "",
  "unresolved_issue": "",
  "concise_summary": ""
}}

Rules:

- Base every statement on the transcript.
- Do not invent customer facts.
- Do not recommend a new discount.
- Do not change or authorize an offer.
- Do not override business policy.
- Keep each field concise.

TRANSCRIPT
----------
{transcript}
""".strip()

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "temperature": 0.2,
    }

    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode(
            "utf-8"
        ),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/",
            "X-Title": "Customer Churn Rescue",
        },
        method="POST",
    )

    try:

        with urllib.request.urlopen(
            request,
            timeout=45,
        ) as response:

            response_data = json.loads(
                response.read().decode(
                    "utf-8"
                )
            )

        content = (
            response_data["choices"][0]
            ["message"]["content"]
        )

        parsed = _extract_json_object(
            content
        )

        if parsed is None:

            return {
                "enabled": False,
                "reason": (
                    "LLM returned output that could not "
                    "be parsed as JSON."
                ),
                "raw_output": content,
            }

        return {
            "enabled": True,
            "model": model,
            "analysis": parsed,
        }

    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        KeyError,
        IndexError,
        json.JSONDecodeError,
    ) as exc:

        return {
            "enabled": False,
            "reason": str(exc),
        }