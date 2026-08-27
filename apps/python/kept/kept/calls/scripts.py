"""Write the task text CALL-E is given, one wording per escalation cycle.

The boundaries below are not stylistic. Accepting a card number on a collections
call would move the operator inside PCI scope, and promising a discount or a
legal consequence is a commitment the caller has no authority to make, so the
agent is told plainly that both are outside its mandate.
"""

from __future__ import annotations

import re
from datetime import date

from kept.config import Organisation
from kept.models import CallCycle, CallTarget
from kept.money import format_minor

_BOUNDARIES = """
Hard rules for this call:
- Open by saying you are {agent_name} calling on behalf of {org}. Never imply you are a person.
- Never accept or write down card numbers, CVV codes, bank credentials, one-time passcodes or
  any payment detail. If they offer one, say payment must go through the normal channel and
  that you cannot take it over the phone.
- Never threaten legal action, credit reporting, service suspension or any consequence.
- Never offer a discount, waiver, settlement, instalment plan or new payment terms. You may
  only record what they propose.
- If they contest the invoice, stop asking for payment, ask once for the reason in their own
  words, say a colleague will follow up, and end politely.
- If they ask not to be called again, agree, confirm it, and end the call.
- If voicemail or an automated system answers, leave only {org}, a request to call back on
  {callback}, and no invoice or amount details.
- Never propose an amount or a date the customer has not said. Do not offer a figure to be
  confirmed, do not guess at what they meant, and do not read back a value they did not give
  you. Ask an open question and wait. A read-back may only contain values they stated.
- Never accept a vague amount. "Most of it", "a few thousand" and "the balance" are not
  amounts. Ask for the exact figure and do not move on to the date until you have one.
- A date alone is not a commitment. Never end the call having agreed only a date; if you have
  a date but no exact amount, ask for the amount again before closing.
- Before ending any call where they commit to pay, read the amount and the calendar date back
  together and get an explicit yes. If they correct either one, use the corrected values.

Speaking rules:
- Today's date is given at the start of these instructions. If they ask what the date is,
  tell them. If they name a relative day such as "next Friday", work out the calendar date
  yourself and ask them to confirm it. Never say you cannot access the date.
- Speak {language} for the entire call. Never switch language, even to say you did not
  understand. If you did not hear them, ask again in {language}.
- Say the invoice reference out loud as "{spoken_invoice}". Never read punctuation aloud and
  never describe letter case.
- Give your opening line once. If they answer with a greeting, continue rather than repeating it.
- If they ask who is calling, answer in one sentence and go straight to the reason for the call.
""".strip()

_CYCLE_ASK = {
    CallCycle.FIRST_CONTACT: (
        "This is the first contact about this invoice. Confirm you are speaking to the person "
        "who handles payments for {customer}, mention the invoice and the amount, ask whether "
        "there is anything blocking payment, and ask for the exact amount and calendar date "
        "they will pay."
    ),
    CallCycle.REMINDER: (
        "This customer has paid on a previous commitment. Keep the tone appreciative and brief. "
        "Confirm you are speaking to the person who handles payments for {customer}, mention the "
        "invoice and the amount, and ask for the exact amount and calendar date they will pay."
    ),
    CallCycle.BROKEN_PROMISE: (
        "This customer previously committed to pay {broken_amount} by {broken_date} and that did "
        "not arrive in full. Say that plainly and without accusation, ask what changed, and ask "
        "for a new exact amount and calendar date. Do not accept a vague answer; if they cannot "
        "give a date, record that no date was agreed."
    ),
    CallCycle.FINAL_NOTICE: (
        "This customer has broken {broken_count} payment commitments on this account. Say that a "
        "colleague will take the account over if it is not resolved, state no other consequence, "
        "and ask for a final exact amount and calendar date. Do not accept a vague answer."
    ),
}


class ScriptWriter:
    def __init__(self, *, organisation: Organisation) -> None:
        self._organisation = organisation

    def write(self, target: CallTarget, today: date) -> str:
        return "\n\n".join(
            [
                self._context(target, today),
                _CYCLE_ASK[target.cycle].format(**self._cycle_fields(target)),
                self._boundaries(target),
            ]
        )

    def _context(self, target: CallTarget, today: date) -> str:
        invoice = target.invoice
        return (
            f"Today is {today.isoformat()}. Call {target.customer.name} about unpaid invoice "
            f"{invoice.id}, spoken as \"{spoken_reference(invoice.id)}\", from "
            f"{self._organisation.name}, issued for "
            f"{format_minor(invoice.amount_minor, invoice.currency)} and due on "
            f"{invoice.due_date.isoformat()}. The amount still outstanding is "
            f"{format_minor(target.outstanding_minor, invoice.currency)}. Your goal is to leave "
            f"the call with one of: a specific amount and calendar date they commit to pay, a "
            f"statement that it is already paid, or a stated dispute."
        )

    def _boundaries(self, target: CallTarget) -> str:
        return _BOUNDARIES.format(
            agent_name=self._organisation.agent_name,
            org=self._organisation.name,
            callback=self._organisation.callback_number,
            spoken_invoice=spoken_reference(target.invoice.id),
            language=_language_name(target.customer.locale),
        )

    def _cycle_fields(self, target: CallTarget) -> dict[str, str]:
        broken = target.last_broken_promise
        currency = target.invoice.currency
        return {
            "customer": target.customer.name,
            "broken_count": str(target.broken_promise_count),
            "broken_amount": format_minor(broken.amount_minor, currency) if broken else "",
            "broken_date": broken.due_date.isoformat() if broken else "",
        }


_LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "ja": "Japanese",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "pt": "Portuguese",
    "vi": "Vietnamese",
    "th": "Thai",
    "ar": "Arabic",
}


def _language_name(locale: str) -> str:
    """Name the call language explicitly.

    The region subtag alone does not hold the spoken language: a call can
    drift into another one to say it did not understand. Naming it lets the
    task forbid the switch.
    """
    return _LANGUAGE_NAMES.get(locale.split("-")[0].lower(), "English")


_ID_RUN = re.compile(r"[A-Za-z]+|\d+")
_DIGIT_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
}


def spoken_reference(identifier: str) -> str:
    """Render an identifier the way a person reads it down a phone.

    Text-to-speech narrates the punctuation and the letter case in a raw
    `INV-1001`, which the recipient cannot match to their copy. Letters are
    spelled out and digits are named individually, which is also how they will
    read it back off the invoice.
    """
    parts = [_speak_run(run) for run in _ID_RUN.findall(identifier)]
    return " ".join(part for part in parts if part)


def _speak_run(run: str) -> str:
    if run.isdigit():
        return " ".join(_DIGIT_WORDS[digit] for digit in run)
    return " ".join(character.upper() for character in run)
