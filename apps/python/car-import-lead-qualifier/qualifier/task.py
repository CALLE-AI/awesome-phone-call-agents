"""Build the spoken call task for one lead.

Every question maps to exactly one field in `schema.py`, and the spoken options
are read from that schema, so the script and the extraction can never drift
apart. The task text never contains the phone number.
"""

from __future__ import annotations

from .models import Lead
from .schema import spoken_options

DISCLOSURE = (
    "Open the call by saying you are an AI calling assistant working for {dealer}, "
    "and that you are following up on the vehicle import inquiry submitted on {date} "
    "through {source}."
)

CONSENT_GATE = (
    "Ask whether you are speaking with the person who submitted that inquiry and whether "
    "this is a good moment for a short qualification call of about three minutes. "
    "If the person says it is the wrong person, is not interested, asks to be removed, or "
    "does not want to continue, apologise once, confirm that no further calls will be made, "
    "ask nothing else, and end the call."
)

QUESTIONS = (
    "If the person agrees to continue, ask these questions in order, one at a time, and "
    "accept short answers:\n"
    "1. Are you still planning to import a vehicle, and where are you in the process: ready "
    "to buy now, comparing options, or just looking for information?\n"
    "2. The inquiry says {vehicle}. Is that still what you want?\n"
    "3. What type of vehicle is that: {vehicle_types}? Ask this even when the person has "
    "just confirmed the vehicle, because confirming the inquiry does not state the type.\n"
    "4. Roughly what landed budget in US dollars are you working with: under five thousand, "
    "five up to ten thousand, ten up to twenty thousand, or twenty thousand or more? Accept "
    "a refusal and move on.\n"
    "5. Is anything holding up payment at the moment, for example foreign currency being "
    "hard to get, a bank transfer limit, the deposit being too high, needing financing, or "
    "waiting for funds to arrive? Accept nothing as an answer.\n"
    "6. Which port should we quote delivery to: Maputo, Beira, or Nacala? If it is another "
    "port, note which one.\n"
    "7. Would you like a human import specialist to call you back?"
)

LIMITS = (
    "Hard limits for the whole call:\n"
    "- Do not quote a price, promise availability, promise a delivery date, or state any "
    "customs duty, tax, homologation, or registration outcome. Say a human specialist will "
    "confirm those in writing.\n"
    "- Do not give legal, tax, customs, financial, or credit advice, and do not discuss "
    "financing approval, exchange rates, or how to obtain foreign currency.\n"
    "- Record a payment obstacle only as the person describes it. Do not ask for bank names, "
    "balances, account details, or any amount the person already has.\n"
    "- Do not collect or repeat payment card details, bank details, identity or passport "
    "numbers, home addresses, or any document number.\n"
    "- Do not take a deposit, do not create an order, and do not cancel or change anything.\n"
    "- Do not read back the phone number you dialled.\n"
    "- Never claim to be a human, even if asked directly.\n"
    "- If the person becomes upset, asks to stop, or asks to be removed from the list, stop "
    "asking questions immediately and end the call politely.\n"
    "- Do not leave a voicemail with inquiry details; if voicemail answers, say only that "
    "{dealer} called about a submitted inquiry and will try again."
)

CLOSING = (
    "Close by repeating only the delivery port and whether a specialist should call back, "
    "thank the person, and end the call. Keep the whole conversation under five minutes and "
    "speak {locale}."
)


def build_task(lead: Lead) -> str:
    """Return the full call script for one lead."""
    parts = (
        DISCLOSURE.format(
            dealer=lead.dealer_display_name,
            date=lead.inquiry_date,
            source=lead.inquiry_source,
        ),
        CONSENT_GATE,
        QUESTIONS.format(
            vehicle=lead.vehicle_interest,
            vehicle_types=spoken_options("vehicle_type"),
        ),
        LIMITS.format(dealer=lead.dealer_display_name),
        CLOSING.format(locale=lead.locale),
    )
    return "\n\n".join(parts)


def build_metadata(lead: Lead) -> dict[str, str]:
    """Non-secret provider metadata. Carries no phone number and no free text."""
    return {
        "workflow_type": "car_import_lead_qualification",
        "campaign_id": lead.campaign_id,
        "lead_id": lead.lead_id,
        "market": lead.market.region_hint,
        "destination_country": lead.destination_country,
        "dealer_display_name": lead.dealer_display_name,
    }


def describe_market(lead: Lead) -> str:
    """One line naming the market resolved from the dialled number."""
    return f"{lead.market.country} / {lead.locale} / {lead.timezone}"
