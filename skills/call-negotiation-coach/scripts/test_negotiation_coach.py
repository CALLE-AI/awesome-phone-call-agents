#!/usr/bin/env python3
"""test_negotiation_coach.py — Test suite for call-negotiation-coach"""
from __future__ import annotations
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(__file__))
from negotiation_coach import (
    prepare, debrief, DISC_TACTIC_MATRIX, TACTIC_LIBRARY,
    ANTI_PATTERNS, CONCERN_MODE_MAP, _batna_violated,
)

def make_transcript_file(turns: list[dict]) -> str:
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(turns, f)
    f.close()
    return f.name


CARD_STEADY = prepare(
    goal="Renew contract at ≤5% increase",
    batna="Switch to Supplier B at 15% higher",
    counterparty_disc="Steady",
    concern_mode="collaborating",
    dry_run=True,
)

GOOD_TRANSCRIPT = [
    {"role": "agent",  "text": "I really appreciate our long relationship and wanted to discuss renewal."},
    {"role": "callee", "text": "Yes, we value the partnership too."},
    {"role": "agent",  "text": "We'd like to continue at a 4% increase for a 2-year term."},
    {"role": "callee", "text": "That sounds reasonable. We agree to the 4% for 2 years."},
]

BAD_TRANSCRIPT = [
    {"role": "agent",  "text": "We need a 10% increase. That's our final offer. Take it or leave it."},
    {"role": "callee", "text": "That seems high."},
    {"role": "agent",  "text": "Actually, let me offer you 8% right now without you even asking."},
    {"role": "callee", "text": "OK if you insist. Deal."},
]

EMPTY_TRANSCRIPT: list[dict] = []


class TestPrepareMode(unittest.TestCase):
    def test_returns_dict(self):
        self.assertIsInstance(CARD_STEADY, dict)

    def test_mode_is_prepare(self):
        self.assertEqual(CARD_STEADY["mode"], "prepare")

    def test_goal_preserved(self):
        self.assertIn("Renew", CARD_STEADY["goal"])

    def test_batna_preserved(self):
        self.assertIn("Supplier B", CARD_STEADY["batna"])

    def test_disc_respected(self):
        self.assertEqual(CARD_STEADY["counterparty_disc"], "Steady")
        for step in CARD_STEADY["tactic_sequence"]:
            self.assertIn(step["tactic"], DISC_TACTIC_MATRIX["Steady"])

    def test_tactic_sequence_non_empty(self):
        self.assertGreater(len(CARD_STEADY["tactic_sequence"]), 0)

    def test_all_tactics_in_library(self):
        for step in CARD_STEADY["tactic_sequence"]:
            self.assertIn(step["tactic"], TACTIC_LIBRARY)

    def test_anti_patterns_listed(self):
        ap_names = {ap["pattern"] for ap in CARD_STEADY["anti_patterns_to_avoid"]}
        for ap in ANTI_PATTERNS:
            self.assertIn(ap["pattern"], ap_names)

    def test_schema_version(self):
        self.assertEqual(CARD_STEADY["schema_version"], "1.0")

    def test_dry_run_flag(self):
        self.assertTrue(CARD_STEADY["dry_run"])

    def test_disclaimer_present(self):
        self.assertTrue(CARD_STEADY["false_positive_disclaimer"].strip())

    def test_dual_concern_mode(self):
        self.assertEqual(CARD_STEADY["dual_concern_mode"], "Collaborating")

    def test_unknown_disc_defaults(self):
        card = prepare("Goal", "BATNA", counterparty_disc="Unknown", dry_run=True)
        self.assertGreater(len(card["tactic_sequence"]), 0)

    def test_competing_mode(self):
        card = prepare("Goal", "BATNA", concern_mode="competing", dry_run=True)
        self.assertEqual(card["dual_concern_mode"], "Competing")

    def test_each_disc_archetype(self):
        for disc in ["Dominant", "Influential", "Steady", "Analytical"]:
            card = prepare("Goal", "BATNA", counterparty_disc=disc, dry_run=True)
            self.assertEqual(card["counterparty_disc"], disc)
            self.assertGreater(len(card["tactic_sequence"]), 0)

    def test_negotiation_id_present(self):
        self.assertIn("negotiation_id", CARD_STEADY)
        self.assertIsInstance(CARD_STEADY["negotiation_id"], str)

    def test_each_step_has_rationale(self):
        for step in CARD_STEADY["tactic_sequence"]:
            self.assertIn("rationale", step)
            self.assertTrue(step["rationale"].strip())


class TestDebriefMode(unittest.TestCase):
    def setUp(self):
        self.good_path = make_transcript_file(GOOD_TRANSCRIPT)
        self.bad_path  = make_transcript_file(BAD_TRANSCRIPT)
        self.empty_path = make_transcript_file(EMPTY_TRANSCRIPT)

    def tearDown(self):
        for p in [self.good_path, self.bad_path, self.empty_path]:
            os.unlink(p)

    def test_good_transcript_reached_agreement(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertTrue(result["reached_agreement"])

    def test_good_transcript_no_anti_patterns(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertEqual(result["anti_patterns_detected"], [])

    def test_bad_transcript_anti_pattern_detected(self):
        result = debrief(self.bad_path, CARD_STEADY, dry_run=True)
        ap_names = {d["pattern"] for d in result["anti_patterns_detected"]}
        self.assertIn("pre_emptive_concession", ap_names)

    def test_mode_is_debrief(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertEqual(result["mode"], "debrief")

    def test_schema_version(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertEqual(result["schema_version"], "1.0")

    def test_tactic_adherence_dict(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertIsInstance(result["tactic_adherence"], dict)
        for k, v in result["tactic_adherence"].items():
            self.assertIn(v, ("EXECUTED", "SKIPPED"))

    def test_coaching_notes_non_empty(self):
        result = debrief(self.bad_path, CARD_STEADY, dry_run=True)
        self.assertGreater(len(result["coaching_notes"]), 0)

    def test_next_recommendations_present(self):
        result = debrief(self.bad_path, CARD_STEADY, dry_run=True)
        self.assertIsInstance(result["next_call_recommendations"], list)
        self.assertGreater(len(result["next_call_recommendations"]), 0)

    def test_empty_transcript_handled(self):
        result = debrief(self.empty_path, CARD_STEADY, dry_run=True)
        self.assertFalse(result["reached_agreement"])

    def test_disclaimer_present(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertTrue(result["false_positive_disclaimer"].strip())

    def test_flags_on_anti_pattern(self):
        result = debrief(self.bad_path, CARD_STEADY, dry_run=True)
        self.assertIn("ANTI_PATTERN_DETECTED", result["flags"])

    def test_goal_preserved_in_debrief(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertEqual(result["goal"], CARD_STEADY["goal"])

    def test_dry_run_flag_preserved(self):
        result = debrief(self.good_path, CARD_STEADY, dry_run=True)
        self.assertTrue(result["dry_run"])


class TestBatnaViolated(unittest.TestCase):
    def test_not_violated_within_range(self):
        self.assertFalse(_batna_violated("we agreed to 5% increase", "Switch to Supplier B at 15% higher"))

    def test_violated_above_batna(self):
        self.assertTrue(_batna_violated("we agreed to 20% increase", "alternative at 15% higher"))

    def test_no_percentage_in_batna(self):
        self.assertFalse(_batna_violated("agreed to something", "Use another vendor"))

    def test_equal_to_batna_not_violated(self):
        self.assertFalse(_batna_violated("agreed to 15% increase", "alternative at 15%"))


class TestTacticLibrary(unittest.TestCase):
    def test_all_disc_archetypes_have_tactics(self):
        for disc in DISC_TACTIC_MATRIX:
            self.assertGreater(len(DISC_TACTIC_MATRIX[disc]), 0)

    def test_all_tactic_keys_in_library(self):
        for disc, tactics in DISC_TACTIC_MATRIX.items():
            for t in tactics:
                self.assertIn(t, TACTIC_LIBRARY, f"Tactic '{t}' for DISC '{disc}' not in library")

    def test_all_tactics_have_rationale(self):
        for key, tactic in TACTIC_LIBRARY.items():
            self.assertIn("rationale", tactic, f"Tactic '{key}' missing rationale")
            self.assertTrue(tactic["rationale"].strip())

    def test_all_concern_modes_present(self):
        for mode in ["collaborating", "competing", "accommodating", "avoiding"]:
            self.assertIn(mode, CONCERN_MODE_MAP)


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    total = result.result.testsRun
    failures = len(result.result.failures) + len(result.result.errors)
    print(f"\n{'='*60}")
    print(f"Total tests: {total} | Passed: {total - failures} | Failed: {failures}")
    sys.exit(0 if failures == 0 else 1)
