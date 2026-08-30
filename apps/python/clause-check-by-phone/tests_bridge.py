# -*- coding: utf-8 -*-
"""Witnesses for the bridge. No call, no network, no key.

    python tests_bridge.py

That separation is the whole point. Code whose execution costs a real phone
call, and where the budget is counted on one hand, cannot be tuned by running
it. It is tuned here.
"""
from __future__ import annotations
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bridge import call_task, contradiction, NothingToAsk       # noqa: E402

NUM = "+33000000000"          # fictional, never dialled by these tests


class TheCallTask(unittest.TestCase):

    def test_it_names_the_number_and_the_question(self):
        p = call_task(NUM, "students only", "Students only", "https://example/x")
        self.assertIn(NUM, p["task"])
        self.assertIn("not a student", p["task"])

    def test_it_declares_itself_automated(self):
        """Not negotiable. A synthetic call that does not say what it is, is a
        deception, and that would be a strange thing to build into a tool whose
        subject is what people hide from you."""
        p = call_task(NUM, "students only", "Students only", "s")
        self.assertIn("automated", p["task"].lower())

    def test_it_asks_one_question_only(self):
        p = call_task(NUM, "team required", "Team required", "s")
        self.assertIn("one question and only one", p["task"])
        self.assertIn("do not ask anything else", p["task"].lower())

    def test_a_long_quotation_is_cut_without_breaking_a_word(self):
        p = call_task(NUM, "students only", "word " * 200, "s")
        self.assertIn("...", p["quote"])
        self.assertLess(len(p["quote"]), 240)

    def test_a_broken_character_never_reaches_the_ear(self):
        """Seen on a real page. An eye skips the replacement character, a
        speech engine pronounces it or stumbles."""
        p = call_task(NUM, "country restricted", "Countries excluded �", "s")
        self.assertNotIn("�", p["quote"])
        self.assertNotIn("�", p["task"])

    def test_an_orphan_symbol_is_trimmed(self):
        """Real quotation, ending in a multiplication sign, the remains of a
        close icon flattened into the text. A valid character is not a
        pronounceable one."""
        p = call_task(NUM, "country restricted", "Countries excluded ×", "s")
        self.assertTrue(p["quote"].endswith("excluded"))

    def test_the_schema_always_offers_unknown(self):
        """Without it the extraction model must choose between yes and no even
        when the call produced nothing, and it will choose."""
        p = call_task(NUM, "prize not cash", "not a cash prize", "s")
        name = p["result_schema"]["required"][0]
        self.assertIn("unknown", p["result_schema"]["properties"][name]["enum"])


class WhatDoesNotJustifyACall(unittest.TestCase):
    """A call costs a stranger their time. Three refusals, all deliberate."""

    def test_an_unknown_family(self):
        with self.assertRaises(NothingToAsk):
            call_task(NUM, "age restricted", "Ages 13+ only", "s")

    def test_a_clause_with_no_quotation(self):
        with self.assertRaises(NothingToAsk):
            call_task(NUM, "students only", "   ", "s")

    def test_a_number_that_is_not_one(self):
        with self.assertRaises(NothingToAsk):
            call_task("06 12 34 56 78", "students only", "Students only", "s")


class TheContradiction(unittest.TestCase):

    def setUp(self):
        self.p = call_task(NUM, "students only", "Students only", "https://example/x")

    def test_the_voice_contradicts_the_page(self):
        r = contradiction(self.p, {"open_to_non_students": "yes",
                                   "their_words": "anyone can enter"})
        self.assertIsNotNone(r)
        self.assertIn("anyone can enter", r)

    def test_the_voice_confirms_the_page_and_that_is_not_a_failure(self):
        self.assertIsNone(contradiction(self.p, {"open_to_non_students": "no"}))

    def test_unknown_is_never_a_contradiction(self):
        """The easiest trap here. An absence of answer is not a denial, and
        presenting it as one would be exactly the fault this tool reports on
        the pages it reads."""
        self.assertIsNone(contradiction(self.p, {"open_to_non_students": "unknown"}))

    def test_a_call_with_no_result_says_nothing(self):
        self.assertIsNone(contradiction(self.p, {}))
        self.assertIsNone(contradiction(self.p, None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
