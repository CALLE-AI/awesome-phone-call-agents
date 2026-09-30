"""The words the agent says on the phone.

Four things are non-negotiable in this script and are asserted in the tests:
it discloses that it is an automated call and who it is for; it says a death
has been *reported* by the executor rather than asserting it as established
fact; it asks what the institution requires and takes no action whatever; and
it says nothing about the estate outside the disclosure budget.

The last one is enforced rather than intended: `build_task` runs the script
through `disclosure.check` before returning it, so a script that leaks cannot
be built, let alone spoken.

The number being dialled is deliberately absent. It belongs in the `recipients`
field of the call payload, which means it lives in exactly one place and every
preview of the script is safe to print.
"""

from __future__ import annotations

from . import disclosure
from .models import Estate, Institution


def build_task(estate: Estate, institution: Institution) -> str:
    """Compose the natural-language instruction for one notification call."""
    script = (
        f"Speak {institution.language}. "
        "Say that this is an automated call placed on behalf of "
        f"{estate.executor_name}, the executor for the estate of "
        f"{estate.deceased_name}, and that the executor has reported a death "
        f"which {institution.name} needs to be told about. "
        "Say that you are calling only to ask what the institution requires, "
        "that you are not able to register or confirm anything yourself, and "
        "that a person will follow up. "
        f"If they ask for a reference, give {estate.reference}. "
        "Ask these questions one at a time and wait for an answer to each. "
        "Question 1: which team or department handles a reported death? "
        "Question 2: what documents does the family need to send? "
        "Question 3: is a certified copy of the death certificate acceptable, "
        "or do you require an original? "
        "Question 4: what happens to direct debits and standing orders between "
        "now and the documents arriving? "
        "Question 5: is there a reference the family should quote when they "
        "write to you? "
        "Do not ask them to close an account, cancel a service, stop or "
        "restart a payment, move money, or redirect post. "
        "If they offer to do any of those things, say that you cannot accept "
        "anything on the family's behalf and that the executor will decide. "
        "Do not agree to terms, waive anything, or accept a settlement. "
        "If they say they can only speak to the named executor directly, "
        "accept that without arguing, ask which number the executor should "
        "call and at what times, thank them and end the call. "
        "If they ask for anything about the person who died beyond their name, "
        "say that you do not hold it and that the executor will provide it. "
        "Read back what they told you so they can correct it. "
        "Do not guess at an answer they did not give, and do not tell them what "
        "another institution asked for."
    )
    return disclosure.check(script, estate)
