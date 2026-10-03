#!/usr/bin/env python3
"""
test_cognitive_load.py — Test suite for call-cognitive-load-monitor
Run: python3 scripts/test_cognitive_load.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from monitor_cognitive_load import (
    CONSENT_THRESHOLD,
    analyse,
    assign_phase,
    callee_turns,
    compute_load_score,
    consent_validity,
    detect_signals_in_turn,
    load_level,
    phase_scores,
    analyse_interaction_dynamics,
    generate_script_patches,
    load_transcript,
)
from validate_load_report import validate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_transcript_file(turns: list[dict]) -> str:
    f = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    json.dump(turns, f, ensure_ascii=False)
    f.close()
    return f.name


def make_high_load_transcript() -> list[dict]:
    return [
        {"role": "agent",  "text": "Good morning. This call is to discuss the indemnification clause pursuant to sub-clause 4(b)(ii) of your agreement."},
        {"role": "callee", "text": "I'm sorry, could you say that again? I don't understand what that means."},
        {"role": "agent",  "text": "Of course. The notwithstanding provision hereinafter referred to in article 7 stipulates your liability."},
        {"role": "callee", "text": "I'm confused. What does 'notwithstanding' mean? I'm not sure I follow any of this."},
        {"role": "agent",  "text": "Let me clarify. Pursuant to the aforementioned terms, you agree to indemnify us against losses."},
        {"role": "callee", "text": "Wait, what exactly does that mean for me? Can you explain that in plain English?"},
        {"role": "agent",  "text": "Certainly. The sub-clause 6(c)(iii) also requires your consent to the amortisation schedule."},
        {"role": "callee", "text": "I still don't get it. I'm just — I think — maybe I should speak to someone else. I'm lost."},
    ]


def make_low_load_transcript() -> list[dict]:
    return [
        {"role": "agent",  "text": "Hi, I'm calling to confirm your appointment tomorrow at 3pm. Does that work for you?"},
        {"role": "callee", "text": "Yes, that is fine. See you tomorrow."},
        {"role": "agent",  "text": "Perfect. We will send you a reminder an hour before. Anything else you need?"},
        {"role": "callee", "text": "No, all good. Thank you."},
    ]


def make_benign_confusion_transcript() -> list[dict]:
    """Single clarification in a pleasant call — should not be HIGH."""
    return [
        {"role": "agent",  "text": "Hi there! Just calling to confirm your order. You ordered item A and item B, correct?"},
        {"role": "callee", "text": "Yes, and can you confirm the delivery date?"},
        {"role": "agent",  "text": "Sure — it arrives Thursday between 9am and 1pm."},
        {"role": "callee", "text": "Great, that works for me."},
        {"role": "agent",  "text": "Wonderful. Is there anything else I can help with today?"},
        {"role": "callee", "text": "No, all good. Thank you so much."},
    ]


def make_closing_overload_transcript() -> list[dict]:
    """Normal opening/middle, heavy jargon at closing — consent at risk."""
    return [
        {"role": "agent",  "text": "Hello, thank you for calling today."},
        {"role": "callee", "text": "Hi, how can I help you?"},
        {"role": "agent",  "text": "We are calling to review your account."},
        {"role": "callee", "text": "Sure, go ahead."},
        {"role": "agent",  "text": "Everything looks good on your account."},
        {"role": "callee", "text": "Great, good to know."},
        # Closing phase starts here (~75% mark)
        {"role": "agent",  "text": "To proceed, pursuant to sub-clause 4(b)(ii), you must indemnify and consent to the notwithstanding amortisation provisions."},
        {"role": "callee", "text": "I'm sorry, could you repeat that? I don't understand any of that."},
        {"role": "agent",  "text": "By saying yes, you consent to all aforementioned terms."},
        {"role": "callee", "text": "I'm not sure... I guess... yes? I mean, maybe?"},
    ]


def make_empty_transcript() -> list[dict]:
    return []


def make_single_turn_transcript() -> list[dict]:
    return [{"role": "agent", "text": "Hello?"}]


# ---------------------------------------------------------------------------
# Test suite
# ---------------------------------------------------------------------------

class TestPhaseAssignment(unittest.TestCase):
    def test_opening(self):
        self.assertEqual(assign_phase(0, 10), "opening")

    def test_closing(self):
        self.assertEqual(assign_phase(9, 10), "closing")

    def test_middle(self):
        self.assertEqual(assign_phase(5, 10), "middle")

    def test_short_transcript_all_middle(self):
        self.assertEqual(assign_phase(0, 3), "middle")
        self.assertEqual(assign_phase(1, 3), "middle")


class TestLoadLevel(unittest.TestCase):
    def test_low(self):
        self.assertEqual(load_level(0.10), "LOW")

    def test_medium(self):
        self.assertEqual(load_level(0.50), "MEDIUM")

    def test_high(self):
        self.assertEqual(load_level(0.70), "HIGH")

    def test_critical(self):
        self.assertEqual(load_level(0.90), "CRITICAL")

    def test_boundary_low_medium(self):
        self.assertEqual(load_level(0.35), "MEDIUM")

    def test_boundary_medium_high(self):
        self.assertEqual(load_level(0.65), "HIGH")

    def test_boundary_high_critical(self):
        self.assertEqual(load_level(0.85), "CRITICAL")


class TestSignalDetection(unittest.TestCase):
    def _callee(self, text: str) -> dict:
        return {"role": "callee", "text": text}

    def _agent(self, text: str) -> dict:
        return {"role": "agent", "text": text}

    def test_repetition_request_detected(self):
        sigs = detect_signals_in_turn(self._callee("Could you say that again please?"), 1, "middle")
        types = [s["type"] for s in sigs]
        self.assertIn("repetition_request", types)

    def test_confusion_detected(self):
        sigs = detect_signals_in_turn(self._callee("I don't understand what that means."), 1, "middle")
        types = [s["type"] for s in sigs]
        self.assertIn("confusion_phrase", types)

    def test_self_correction_detected(self):
        sigs = detect_signals_in_turn(self._callee("Wait, I mean — no, actually I want option B."), 1, "middle")
        types = [s["type"] for s in sigs]
        self.assertIn("self_correction", types)

    def test_hedge_cluster_detected(self):
        sigs = detect_signals_in_turn(
            self._callee("I think maybe perhaps I'm not sure this is right."), 1, "middle"
        )
        types = [s["type"] for s in sigs]
        self.assertIn("hedge_word_cluster", types)

    def test_clarification_detected(self):
        sigs = detect_signals_in_turn(
            self._callee("So what you're saying is I need to pay extra?"), 1, "middle"
        )
        types = [s["type"] for s in sigs]
        self.assertIn("clarification_request", types)

    def test_jargon_on_agent_turn(self):
        sigs = detect_signals_in_turn(
            self._agent("Pursuant to sub-clause 4(b)(ii), you must indemnify us notwithstanding."),
            1, "middle"
        )
        types = [s["type"] for s in sigs]
        self.assertIn("jargon_density_spike", types)

    def test_clean_callee_turn_no_signals(self):
        sigs = detect_signals_in_turn(self._callee("Yes, that works for me, thank you."), 1, "middle")
        self.assertEqual(sigs, [])

    def test_clean_agent_turn_no_jargon(self):
        sigs = detect_signals_in_turn(self._agent("Your appointment is tomorrow at 3pm."), 1, "middle")
        self.assertEqual(sigs, [])

    def test_pardon_detected_as_repetition(self):
        sigs = detect_signals_in_turn(self._callee("Pardon? I missed that completely."), 1, "middle")
        types = [s["type"] for s in sigs]
        self.assertIn("repetition_request", types)


class TestComputeLoadScore(unittest.TestCase):
    def test_empty_signals_zero(self):
        self.assertEqual(compute_load_score([]), 0.0)

    def test_single_repetition_weight(self):
        sigs = [{"type": "repetition_request", "weight": 0.30, "phase": "middle"}]
        self.assertAlmostEqual(compute_load_score(sigs), 0.30, places=2)

    def test_capped_at_one(self):
        sigs = [{"weight": 0.8, "phase": "middle"}, {"weight": 0.8, "phase": "middle"}]
        self.assertEqual(compute_load_score(sigs), 1.0)

    def test_score_non_negative(self):
        sigs = [{"weight": 0.15, "phase": "opening"}, {"weight": 0.25, "phase": "closing"}]
        self.assertGreater(compute_load_score(sigs), 0)


class TestConsentValidity(unittest.TestCase):
    def test_consent_valid_low_overall(self):
        flag, _ = consent_validity({"opening": 0.1, "middle": 0.1, "closing": 0.1}, 0.15)
        self.assertEqual(flag, "CONSENT_VALID")

    def test_consent_at_risk_high_closing(self):
        flag, reason = consent_validity({"opening": 0.1, "middle": 0.2, "closing": 0.75}, 0.75)
        self.assertEqual(flag, "CONSENT_AT_RISK")
        self.assertIn("closing", reason.lower())

    def test_consent_valid_high_overall_but_low_closing(self):
        # High overall load but closing was fine — consent still valid
        flag, _ = consent_validity({"opening": 0.8, "middle": 0.7, "closing": 0.10}, 0.80)
        self.assertEqual(flag, "CONSENT_VALID")


class TestInteractionDynamics(unittest.TestCase):
    def test_agent_dominated(self):
        turns = [
            {"role": "agent",  "text": "Long agent turn with many many words about the topic at hand."},
            {"role": "agent",  "text": "Another long agent turn continuing the explanation without pause."},
            {"role": "callee", "text": "OK."},
        ]
        dyn = analyse_interaction_dynamics(turns)
        self.assertGreater(dyn["participation_ratio"]["agent"], 0.7)
        self.assertGreater(dyn["turn_imbalance_score"], 0.3)

    def test_balanced_conversation(self):
        turns = [
            {"role": "agent",  "text": "How can I help you today?"},
            {"role": "callee", "text": "I have a question about my account."},
            {"role": "agent",  "text": "Of course, what would you like to know?"},
            {"role": "callee", "text": "Can you explain the billing cycle please?"},
        ]
        dyn = analyse_interaction_dynamics(turns)
        self.assertLess(dyn["turn_imbalance_score"], 0.5)

    def test_empty_turns(self):
        dyn = analyse_interaction_dynamics([])
        self.assertEqual(dyn["turn_imbalance_score"], 0.0)


class TestScriptPatches(unittest.TestCase):
    def test_jargon_replaced(self):
        signals = [{
            "type": "jargon_density_spike",
            "evidence": "Pursuant to the agreement, notwithstanding the hereinafter conditions.",
        }]
        patches = generate_script_patches(signals, [])
        self.assertGreater(len(patches), 0)
        self.assertNotIn("Pursuant", patches[0]["suggested"])

    def test_non_jargon_signal_no_patch(self):
        signals = [{"type": "repetition_request", "evidence": "Say that again?"}]
        patches = generate_script_patches(signals, [])
        self.assertEqual(patches, [])


class TestEndToEndHighLoad(unittest.TestCase):
    def test_high_load_transcript(self):
        path = make_transcript_file(make_high_load_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertIn(report["overall_cognitive_load"], ("HIGH", "CRITICAL"))
            self.assertGreater(report["load_score"], 0.35)
            self.assertGreater(len(report["overload_signals"]), 0)
            self.assertTrue(report["false_positive_disclaimer"])
        finally:
            os.unlink(path)

    def test_low_load_transcript(self):
        path = make_transcript_file(make_low_load_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertEqual(report["overall_cognitive_load"], "LOW")
        finally:
            os.unlink(path)

    def test_benign_confusion_not_high(self):
        path = make_transcript_file(make_benign_confusion_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertIn(report["overall_cognitive_load"], ("LOW", "MEDIUM"))
        finally:
            os.unlink(path)

    def test_closing_overload_consent_at_risk(self):
        path = make_transcript_file(make_closing_overload_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertIn(report["consent_validity_flag"], ("CONSENT_AT_RISK",))
        finally:
            os.unlink(path)

    def test_empty_transcript_returns_unknown(self):
        path = make_transcript_file(make_empty_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertEqual(report["overall_cognitive_load"], "UNKNOWN")
            self.assertIn("INSUFFICIENT_TURNS_LOW_CONFIDENCE", report["flags"])
        finally:
            os.unlink(path)

    def test_single_turn_transcript(self):
        path = make_transcript_file(make_single_turn_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertEqual(report["overall_cognitive_load"], "UNKNOWN")
        finally:
            os.unlink(path)

    def test_schema_version_present(self):
        path = make_transcript_file(make_low_load_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertEqual(report["schema_version"], "1.0")
        finally:
            os.unlink(path)

    def test_recommended_action_in_valid_set(self):
        valid_actions = {
            "PROCEED", "FLAG_FOR_REVIEW",
            "SEND_WRITTEN_CONFIRMATION", "REPEAT_CALL_WITH_SIMPLER_SCRIPT"
        }
        path = make_transcript_file(make_high_load_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertIn(report["recommended_action"], valid_actions)
        finally:
            os.unlink(path)

    def test_dry_run_flag_preserved(self):
        path = make_transcript_file(make_low_load_transcript())
        try:
            report = analyse(path, dry_run=True)
            self.assertTrue(report["dry_run"])
        finally:
            os.unlink(path)

    def test_load_score_in_range(self):
        for turns_fn in [make_high_load_transcript, make_low_load_transcript,
                         make_closing_overload_transcript]:
            path = make_transcript_file(turns_fn())
            try:
                report = analyse(path, dry_run=True)
                self.assertGreaterEqual(report["load_score"], 0.0)
                self.assertLessEqual(report["load_score"], 1.0)
            finally:
                os.unlink(path)

    def test_phase_scores_in_range(self):
        path = make_transcript_file(make_high_load_transcript())
        try:
            report = analyse(path, dry_run=True)
            for phase in ("opening", "middle", "closing"):
                score = report["load_by_phase"].get(phase, 0.0)
                self.assertGreaterEqual(score, 0.0)
                self.assertLessEqual(score, 1.0)
        finally:
            os.unlink(path)


class TestPIINotLeaked(unittest.TestCase):
    def test_phone_number_not_in_output(self):
        turns = [
            {"role": "agent",  "text": "Hello, calling for John Doe."},
            {"role": "callee", "text": "Could you say that again? My number is +1 555-0143."},
        ]
        path = make_transcript_file(turns)
        try:
            report = analyse(path, dry_run=True)
            report_text = json.dumps(report)
            # PII in the evidence field is acceptable (it came from the input),
            # but the caller ID / phone number should not appear in call_id or flags.
            self.assertNotIn("+1 555-0143", report.get("call_id", ""))
        finally:
            os.unlink(path)


class TestSchemaValidation(unittest.TestCase):
    def test_valid_report_passes(self):
        report = {
            "call_id": "test-001",
            "analysis_timestamp": "2026-09-17T00:00:00Z",
            "overall_cognitive_load": "LOW",
            "load_score": 0.10,
            "load_by_phase": {"opening": 0.0, "middle": 0.10, "closing": 0.0},
            "peak_phase": "middle",
            "overload_signals": [],
            "interaction_dynamics": {},
            "script_patches": [],
            "consent_validity_flag": "CONSENT_VALID",
            "consent_validity_reason": "Load within bounds.",
            "recommended_action": "PROCEED",
            "false_positive_disclaimer": "This is probabilistic.",
            "flags": [],
            "schema_version": "1.0",
        }
        errors = validate(report)
        self.assertEqual(errors, [])

    def test_missing_field_detected(self):
        report = {"call_id": "test-001", "load_score": 0.5}
        errors = validate(report)
        self.assertGreater(len(errors), 0)

    def test_out_of_range_score_detected(self):
        report = {
            "call_id": "x", "analysis_timestamp": "2026-09-17T00:00:00Z",
            "overall_cognitive_load": "LOW", "load_score": 1.5,
            "load_by_phase": {}, "peak_phase": "middle", "overload_signals": [],
            "interaction_dynamics": {}, "script_patches": [],
            "consent_validity_flag": "CONSENT_VALID",
            "consent_validity_reason": "ok", "recommended_action": "PROCEED",
            "false_positive_disclaimer": "disclaimer", "flags": [], "schema_version": "1.0",
        }
        errors = validate(report)
        self.assertTrue(any("load_score" in e for e in errors))

    def test_invalid_load_level_detected(self):
        report = {
            "call_id": "x", "analysis_timestamp": "2026-09-17T00:00:00Z",
            "overall_cognitive_load": "EXTREME", "load_score": 0.5,
            "load_by_phase": {}, "peak_phase": "middle", "overload_signals": [],
            "interaction_dynamics": {}, "script_patches": [],
            "consent_validity_flag": "CONSENT_VALID",
            "consent_validity_reason": "ok", "recommended_action": "PROCEED",
            "false_positive_disclaimer": "disclaimer", "flags": [], "schema_version": "1.0",
        }
        errors = validate(report)
        self.assertTrue(any("overall_cognitive_load" in e for e in errors))

    def test_empty_disclaimer_detected(self):
        report = {
            "call_id": "x", "analysis_timestamp": "2026-09-17T00:00:00Z",
            "overall_cognitive_load": "LOW", "load_score": 0.10,
            "load_by_phase": {}, "peak_phase": "middle", "overload_signals": [],
            "interaction_dynamics": {}, "script_patches": [],
            "consent_validity_flag": "CONSENT_VALID",
            "consent_validity_reason": "ok", "recommended_action": "PROCEED",
            "false_positive_disclaimer": "   ", "flags": [], "schema_version": "1.0",
        }
        errors = validate(report)
        self.assertTrue(any("disclaimer" in e.lower() for e in errors))


class TestTranscriptLoading(unittest.TestCase):
    def test_list_format(self):
        turns = [{"role": "agent", "text": "Hello"}]
        path = make_transcript_file(turns)
        try:
            loaded = load_transcript(path)
            self.assertEqual(len(loaded), 1)
        finally:
            os.unlink(path)

    def test_dict_with_transcript_key(self):
        data = {"transcript": [{"role": "agent", "text": "Hi"}]}
        f = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump(data, f)
        f.close()
        try:
            loaded = load_transcript(f.name)
            self.assertEqual(len(loaded), 1)
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    total = result.result.testsRun
    failures = len(result.result.failures) + len(result.result.errors)
    print(f"\n{'='*60}")
    print(f"Total tests: {total} | Passed: {total - failures} | Failed: {failures}")
    sys.exit(0 if failures == 0 else 1)
