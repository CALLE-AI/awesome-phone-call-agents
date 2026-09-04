"""The offline demonstration scenario.

A demo where every call succeeds is the least useful version of this product, because the
whole argument is about what happens when a call does not produce an answer. So the
offline run is deliberately mixed, and it is deterministic, so a judge who runs it twice
sees the same thing and can check the printed numbers against the rows.

Every number here is fictional. See `tests/fixtures.py`.
"""

from __future__ import annotations

from calle_double import CalleDouble, Outcome

_ANSWERED_TA = (
    {"reason_category": "illness", "expected_return": "tomorrow",
     "parent_confirmed_aware": "yes"},
    [("bot", "Kaalai vanakkam. This is an automated call from the school attendance "
             "office. You are speaking with an AI assistant, not a person."),
     ("user", "Sari, sollunga."),
     ("bot", "Anitha was marked absent this morning. May I ask the reason?"),
     ("user", "Avaluku kaaichal. Naalaikku varuvaanga."),
     ("bot", "Thank you. I have recorded fever, returning tomorrow.")],
)

_ANSWERED_HI = (
    {"reason_category": "medical_appointment", "expected_return": "today",
     "parent_confirmed_aware": "yes"},
    [("bot", "This is an automated call from the school attendance office. You are "
             "speaking with an AI assistant, not a person."),
     ("user", "Haan, boliye."),
     ("bot", "Rohit was marked absent this morning. May I ask the reason?"),
     ("user", "Doctor ke paas gaya tha, dopahar tak aa jayega."),
     ("bot", "Thank you. Medical appointment, returning today.")],
)

_AMBIGUOUS = [
    ("bot", "This is an automated call from the school attendance office. You are "
            "speaking with an AI assistant, not a person."),
    ("user", "Sorry, who is this? I am at work, I cannot talk now."),
    ("bot", "I understand. A member of staff will call you back today."),
]


def apply_demo_outcomes(double: CalleDouble) -> None:
    """Bind a fixed, mixed set of outcomes to the numbers in examples/absences.csv."""
    result, transcript = _ANSWERED_TA
    double.set_outcome("+915550000001", Outcome.answered(result, transcript))

    result, transcript = _ANSWERED_HI
    double.set_outcome("+915550000002", Outcome.answered(result, transcript))

    # Nobody on the first number; the second guardian picks up. This is the fallback
    # chain doing its job, and it is why `phones` is a list.
    double.set_outcome("+915550000003", Outcome.answered(
        {"reason_category": "family_emergency", "expected_return": "later_this_week",
         "parent_confirmed_aware": "yes"},
        [("bot", "This is an automated call from the school attendance office."),
         ("user", "Yes, her grandmother is unwell, we are travelling. Back Thursday.")],
        answers_on=1,
    ))

    # The case the product exists for: a real conversation that yields no usable answer.
    double.set_outcome("+915550000004", Outcome.ambiguous(_AMBIGUOUS))

    # Nobody home on any number.
    double.set_outcome("+915550000006", Outcome.no_answer())
