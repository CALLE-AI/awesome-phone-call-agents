"""Chain decisions, decided without a network, a credential, or a call."""

from __future__ import annotations

import unittest

from runaround import chain, phone, schema

RETAIL = chain.Desk(name="Example Retail Support", phone="+15550100", region="US")
FREIGHT = chain.Desk(name="Example Freight Claims", phone="+15550111", region="US")


def result(**overrides):
    base = {
        "owns_request": "no",
        "question_answered": "no",
        "answer_summary": None,
        "referral_target_name": None,
        "referral_target_phone": None,
        "referral_quote": None,
        "reference_number": None,
    }
    base.update(overrides)
    return schema.validate_hop_result(base)


class PhoneTests(unittest.TestCase):
    def test_punctuation_does_not_create_a_second_desk(self):
        self.assertEqual(
            phone.identity("+1 (555) 010-0"), phone.identity("+15550100")
        )

    def test_a_number_that_is_not_e164_is_refused_not_repaired(self):
        with self.assertRaises(phone.InvalidPhoneNumber):
            phone.normalize("555-0100")

    def test_mask_keeps_the_country_prefix_and_last_two_digits(self):
        self.assertEqual(phone.mask("+15550100"), "+1*****00")


class SchemaTests(unittest.TestCase):
    def test_a_missing_result_is_not_an_empty_result(self):
        with self.assertRaises(schema.ResultRejected):
            schema.validate_hop_result(None)

    def test_unknown_fields_are_refused(self):
        with self.assertRaises(schema.ResultRejected):
            schema.validate_hop_result(
                {
                    "owns_request": "no",
                    "question_answered": "no",
                    "answer_summary": None,
                    "referral_target_name": None,
                    "referral_target_phone": None,
                    "referral_quote": None,
                    "reference_number": None,
                    "who_knows": "surprise",
                }
            )

    def test_answered_yes_without_a_summary_is_refused(self):
        with self.assertRaises(schema.ResultRejected):
            result(owns_request="yes", question_answered="yes")

    def test_a_spoken_number_that_is_not_e164_is_reported_not_dialled(self):
        parsed = result(
            referral_quote="Try extension four four one.",
            referral_target_phone="ext. 441",
        )
        self.assertIsNone(parsed["referral_target_phone"])
        self.assertEqual(parsed["referral_phone_rejected"], "ext. 441")


class ClassifyHopTests(unittest.TestCase):
    def test_owner_that_answers_is_answered(self):
        verdict = chain.classify_hop(
            call_status="completed",
            result=result(
                owns_request="yes",
                question_answered="yes",
                answer_summary="We accept the claim.",
            ),
        )
        self.assertEqual(verdict.outcome, chain.HOP_ANSWERED)

    def test_owner_without_an_answer_does_not_resolve(self):
        verdict = chain.classify_hop(
            call_status="completed", result=result(owns_request="yes")
        )
        self.assertEqual(verdict.outcome, chain.HOP_OWNER_WITHOUT_ANSWER)

    def test_a_quoted_referral_is_a_referral(self):
        verdict = chain.classify_hop(
            call_status="completed",
            result=result(
                referral_target_name="Example Freight Claims",
                referral_target_phone="+15550111",
                referral_quote="That is the carrier's claim.",
            ),
        )
        self.assertEqual(verdict.outcome, chain.HOP_REFERRED)
        self.assertEqual(verdict.referral.target_phone, "+15550111")

    def test_a_number_without_words_behind_it_is_not_a_referral(self):
        verdict = chain.classify_hop(
            call_status="completed",
            result=result(
                referral_target_name="Example Freight Claims",
                referral_target_phone="+15550111",
            ),
        )
        self.assertEqual(verdict.outcome, chain.HOP_UNVERIFIED_REFERRAL)

    def test_words_without_a_usable_number_are_not_a_referral(self):
        verdict = chain.classify_hop(
            call_status="completed",
            result=result(referral_quote="Call the claims people."),
        )
        self.assertEqual(verdict.outcome, chain.HOP_UNVERIFIED_REFERRAL)

    def test_a_failed_call_is_unreachable_not_a_dead_end(self):
        verdict = chain.classify_hop(call_status="failed", result=None)
        self.assertEqual(verdict.outcome, chain.HOP_UNREACHABLE)

    def test_a_refused_result_is_unreachable(self):
        verdict = chain.classify_hop(
            call_status="completed", result=None, rejection="schema mismatch"
        )
        self.assertEqual(verdict.outcome, chain.HOP_UNREACHABLE)

    def test_no_owner_and_no_referral_is_a_dead_end(self):
        verdict = chain.classify_hop(call_status="completed", result=result())
        self.assertEqual(verdict.outcome, chain.HOP_DEAD_END)


def referral_verdict(target_phone: str, name: str = "Example Retail Support"):
    return chain.classify_hop(
        call_status="completed",
        result=result(
            referral_target_name=name,
            referral_target_phone=target_phone,
            referral_quote="Go back to them.",
        ),
    )


class DecideNextTests(unittest.TestCase):
    def decide(self, verdict, **overrides):
        kwargs = {
            "verdict": verdict,
            "current": FREIGHT,
            "visited": [RETAIL, FREIGHT],
            "requester_phone": "+15550199",
            "hop_budget": 4,
            "hops_used": 2,
            "authorized_identities": {RETAIL.identity(), FREIGHT.identity()},
            "auto_dial_referrals": False,
        }
        kwargs.update(overrides)
        return chain.decide_next(**kwargs)

    def test_a_referral_to_an_already_called_desk_closes_the_loop(self):
        decision = self.decide(referral_verdict("+15550100"))
        self.assertEqual(decision.state, chain.CHAIN_LOOP_DETECTED)
        self.assertEqual(decision.loop_path, ["+1*****00", "+1*****11", "+1*****00"])
        self.assertTrue(decision.is_terminal)

    def test_punctuation_does_not_hide_a_loop(self):
        decision = self.decide(referral_verdict("+1 (555) 010-0"))
        self.assertEqual(decision.state, chain.CHAIN_LOOP_DETECTED)

    def test_a_desk_referring_to_itself_stops_the_chain(self):
        decision = self.decide(
            referral_verdict("+15550111", name="Example Freight Claims")
        )
        self.assertEqual(decision.state, chain.CHAIN_SELF_REFERRAL)

    def test_a_referral_back_to_the_requester_stops_the_chain(self):
        decision = self.decide(
            referral_verdict("+15550199", name="The customer"),
            visited=[FREIGHT],
        )
        self.assertEqual(decision.state, chain.CHAIN_REFERRED_TO_REQUESTER)

    def test_a_new_number_needs_a_person_before_it_is_dialled(self):
        decision = self.decide(
            referral_verdict("+15550122", name="Example Insurance Desk"),
        )
        self.assertEqual(decision.state, chain.CHAIN_AWAITING_APPROVAL)
        self.assertEqual(decision.next_desk.phone, "+15550122")
        self.assertFalse(decision.is_terminal)

    def test_an_approved_number_continues(self):
        decision = self.decide(
            referral_verdict("+15550122", name="Example Insurance Desk"),
            authorized_identities={
                RETAIL.identity(),
                FREIGHT.identity(),
                "+15550122",
            },
        )
        self.assertEqual(decision.state, chain.CHAIN_CONTINUE)

    def test_a_second_number_for_a_visited_name_is_only_suspected(self):
        decision = self.decide(
            referral_verdict("+15550133", name="Example Retail Support, Inc."),
        )
        self.assertEqual(decision.state, chain.CHAIN_LOOP_SUSPECTED)
        self.assertFalse(decision.is_terminal)

    def test_the_hop_budget_stops_the_chain(self):
        decision = self.decide(
            referral_verdict("+15550122", name="Example Insurance Desk"),
            hops_used=4,
        )
        self.assertEqual(decision.state, chain.CHAIN_BUDGET_EXHAUSTED)

    def test_an_unverified_referral_goes_to_a_person(self):
        verdict = chain.classify_hop(
            call_status="completed",
            result=result(
                referral_target_name="Example Freight Claims",
                referral_target_phone="+15550111",
            ),
        )
        self.assertEqual(self.decide(verdict).state, chain.CHAIN_NEEDS_HUMAN)


class FoldNameTests(unittest.TestCase):
    def test_legal_suffixes_and_punctuation_fold_together(self):
        self.assertEqual(
            chain.fold_name("Example Retail Support, Inc."),
            chain.fold_name("example retail support"),
        )

    def test_different_organizations_do_not_fold_together(self):
        self.assertNotEqual(
            chain.fold_name("Example Retail Support"),
            chain.fold_name("Example Freight Claims"),
        )


if __name__ == "__main__":
    unittest.main()
