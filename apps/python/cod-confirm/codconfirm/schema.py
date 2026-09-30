"""The conversation brief and the structured answer we ask CALL-E for.

Everything the agent is allowed to conclude lives here. Keeping the schema
narrow is what makes the result safe to write straight back into a store:
the agent returns an enum, not prose we have to guess at.
"""
from __future__ import annotations

from typing import Any

from codconfirm.orders import Order

RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["confirmed", "address_correct", "reached_customer"],
    "properties": {
        "reached_customer": {
            "type": "string",
            "enum": ["yes", "no"],
            "description": "Did a human actually answer and speak?",
        },
        "confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unclear"],
            "description": "Does the customer still want this order?",
        },
        "confirmation_quote": {
            "type": "string",
            "description": (
                "The customer's own words agreeing to the order, quoted "
                "exactly. Empty if they never said it in their own words."
            ),
        },
        "address_correct": {
            "type": "string",
            "enum": ["yes", "no", "unclear"],
        },
        "corrected_address": {
            "type": "string",
            "description": "The full corrected address, empty if unchanged.",
        },
        "preferred_time": {
            "type": "string",
            "description": "When delivery suits them, empty if not discussed.",
        },
        "decline_reason": {
            "type": "string",
            "description": "Why they no longer want it, empty if confirmed.",
        },
    },
}


def build_task(order: Order, store_name: str, currency: str) -> str:
    """Write the brief the voice agent works from.

    Written as instructions rather than a script: CALL-E handles the wording,
    we only fix the goal, the facts it may state, and the boundaries.
    """
    return f"""
You are calling on behalf of {store_name}, an online shop, to confirm a
cash-on-delivery order before it is dispatched.

Order details you may share:
- Order number: {order.id}
- Customer name: {order.customer_name}
- Items: {order.item_summary}
- Amount due on delivery: {order.total:.0f} {currency}
- Delivery address on file: {order.address}

You must ask all three questions below before ending the call. If you
realise one is still unanswered, ask it before you say goodbye. Do not end
the call with any of them unanswered, and do not treat a hearing check or
any other exchange as a substitute for asking one.

1. Greet the customer by name and say which shop you are calling from.
2. Say you are confirming their cash-on-delivery order and read back the
   items and the amount they will pay the courier.

QUESTION ONE. Ask whether they still want the order, and wait for them to
say so in their own words. Report those words in confirmation_quote,
exactly as spoken. Do not paraphrase, and do not fill it in from a hum, a
pause, or a yes you offered them yourself.

QUESTION TWO. Read the delivery address on file back to them and ask
whether it is correct. This question is mandatory even when everything else
has gone smoothly. If they say it is wrong, ask for the correct one and
repeat it back to check, then report it in corrected_address. Report
address_correct as unclear only if you asked and they did not give a clear
answer, never because you did not ask.

QUESTION THREE. Ask which time of day suits them for delivery.

Then thank them and end the call.

Boundaries:
- Keep the whole call under ninety seconds.
- Never ask for card, bank or payment details. This order is paid in cash on
  delivery and there is nothing to pay now.
- Do not offer discounts, refunds or delivery dates you were not given.
- If the person says it is a wrong number or they never placed an order, do
  not argue. Apologise, end the call, and report reached_customer as yes with
  confirmed as no.
- If you reach voicemail or nobody speaks, end the call and report
  reached_customer as no.
""".strip()
