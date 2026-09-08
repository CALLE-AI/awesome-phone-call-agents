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
     "parent_confirmed_aware": "yes",
     "spoke_with": "guardian"},
    [("bot", "Kaalai vanakkam. This is an automated call from the school attendance "
             "office. You are speaking with an AI assistant, not a person."),
     ("user", "Sari, sollunga."),
     ("bot", "Anitha was marked absent this morning. May I ask the reason?"),
     ("user", "Avaluku kaaichal. Naalaikku varuvaanga."),
     ("bot", "Thank you. I have recorded fever, returning tomorrow.")],
)

_ANSWERED_HI = (
    {"reason_category": "medical_appointment", "expected_return": "today",
     "parent_confirmed_aware": "yes",
     "spoke_with": "guardian"},
    [("bot", "This is an automated call from the school attendance office. You are "
             "speaking with an AI assistant, not a person."),
     ("user", "Haan, boliye."),
     ("bot", "Rohit was marked absent this morning. May I ask the reason?"),
     ("user", "Doctor ke paas gaya tha, dopahar tak aa jayega."),
     ("bot", "Thank you. Medical appointment, returning today.")],
)

# The three households in `absences-siblings.csv` share one number, so this answer is the
# one a parent gives when she is asked about all three children at once. It closes the
# dialled row and nothing else: the other two are held for a person, which is the whole
# argument of `dispatch/households.py`. Reading three records closed off one result is the
# move this program refuses everywhere.
_ANSWERED_HOUSEHOLD = (
    {"reason_category": "family_emergency", "expected_return": "later_this_week",
     "parent_confirmed_aware": "yes", "spoke_with": "guardian",
     "free_text_note": "grandmother in hospital, all three travelling with her"},
    [("bot", "This is an automated call from the school attendance office. You are "
             "speaking with an AI assistant, not a person."),
     ("user", "Yes, this is their mother."),
     ("bot", "Amara Okonjo was marked absent this morning. May I ask the reason?"),
     ("user", "Their grandmother is in hospital, we all went up on Tuesday."),
     ("bot", "Thank you. The school has also not been told why Chidi Okonjo and Ngozi "
             "Okonjo are absent. Is it the same reason?"),
     ("user", "Yes, all three of them are with me. Back Monday, I think."),
     ("bot", "Thank you. Family emergency, returning later this week.")],
)

_AMBIGUOUS = [
    ("bot", "This is an automated call from the school attendance office. You are "
            "speaking with an AI assistant, not a person."),
    ("user", "Sorry, who is this? I am at work, I cannot talk now."),
    ("bot", "I understand. A member of staff will call you back today."),
]


def _apply_district_outcomes(double: CalleDouble) -> None:
    """The numbers in `absences-oneroster.csv` and `absences-siblings.csv`.

    Same shape as the six above and mixed for the same reason: one row closes, one goes to a
    person, one is refused before it is dialled. The refusal is the useful one here. CALL-E
    offers English and nothing else in the United States (`calle_double/regions.py`), so a
    Spanish-speaking family in a US district cannot be called in their own language by this
    platform today, and the fixture a district would actually run is where that belongs
    rather than in a limits list further down the page.
    """
    # OneRoster row 1: a clean answer on the first number.
    double.set_outcome("+15550100201", Outcome.answered(
        {"reason_category": "illness", "expected_return": "tomorrow",
         "parent_confirmed_aware": "yes", "spoke_with": "guardian"},
        [("bot", "This is an automated call from the school attendance office. You are "
                 "speaking with an AI assistant, not a person."),
         ("user", "Speaking, yes, I am his father."),
         ("bot", "Marcus Ellery was marked absent this morning. May I ask the reason?"),
         ("user", "He has been up all night with a temperature. Back tomorrow I hope."),
         ("bot", "Thank you. I have recorded illness, returning tomorrow.")],
    ))

    # OneRoster row 2 is refused before anything is dialled: es-US against a US number.
    # Nothing is bound for it, and nothing should be.

    # OneRoster row 3: the phone column is empty and the sms column is not, so this is the
    # fallback chain reaching a number recorded for text messages. Nobody answers it.
    double.set_outcome("+15550100903", Outcome.no_answer())

    # The shared household number, answered once for three children.
    result, transcript = _ANSWERED_HOUSEHOLD
    double.set_outcome("+15550100301", Outcome.answered(result, transcript))

    # The fourth row of that fixture is a different house on its own number, and it is the
    # case this product exists for: a real conversation that yields nothing usable.
    double.set_outcome("+15550100999", Outcome.ambiguous(_AMBIGUOUS))


def apply_demo_outcomes(double: CalleDouble) -> None:
    """Bind a fixed, mixed set of outcomes to the numbers in every fixture under examples/.

    It used to bind only the six numbers in `absences.csv`. The other two fixtures are named
    on the first screen and in the README's three-minute table, and every call in both of
    them fell through to the double's `{"ok": true}`, failed the result schema and closed
    nothing, at exit 0. A judge running the command the page offers saw a product that does
    not work, which is the same defect the README diagnosed for the HTTP path and fixed
    there.
    """
    result, transcript = _ANSWERED_TA
    double.set_outcome("+915550000001", Outcome.answered(result, transcript))

    result, transcript = _ANSWERED_HI
    double.set_outcome("+915550000002", Outcome.answered(result, transcript))

    # Nobody on the first number; the second guardian picks up. This is the fallback
    # chain doing its job, and it is why `phones` is a list.
    double.set_outcome("+915550000003", Outcome.answered(
        {"reason_category": "family_emergency", "expected_return": "later_this_week",
         "parent_confirmed_aware": "yes",
     "spoke_with": "guardian"},
        [("bot", "This is an automated call from the school attendance office."),
         ("user", "Yes, her grandmother is unwell, we are travelling. Back Thursday.")],
        answers_on=1,
    ))

    # The case the product exists for: a real conversation that yields no usable answer.
    double.set_outcome("+915550000004", Outcome.ambiguous(_AMBIGUOUS))

    # Nobody home on any number.
    double.set_outcome("+915550000006", Outcome.no_answer())

    _apply_district_outcomes(double)

    # The case the escalation rule exists for, and the one this demo did not have.
    #
    # Everything about this answer is well-formed. A reason is given, a return date is
    # given, the schema is satisfied, and nothing in it is uncertain enough to make the
    # call undetermined. Read as data it is the cleanest result in the run.
    #
    # Read as a sentence, a parent has just found out from an automated call that a child
    # who left the house for school is not at school, and has guessed at where she might
    # be. Before `safeguarding_escalation` existed this row printed `ok` and closed.
    double.set_outcome("+915550000007", Outcome.answered(
        {"reason_category": "other", "expected_return": "today",
         "parent_confirmed_aware": "no",
         "free_text_note": "parent believes she may be with a friend"},
        [("bot", "This is an automated call from the school attendance office. You are "
                 "speaking with an AI assistant, not a person."),
         ("user", "Sorry, what? No, I did not know she was absent."),
         ("bot", "Divya was marked absent this morning. May I ask the reason?"),
         ("user", "She left for school at half seven. Maybe she is at her friend's "
                  "house, I will call them now."),
         ("bot", "Thank you. A member of staff will call you back.")],
    ))
