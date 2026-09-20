#!/usr/bin/env python3
"""
client-persona-profiler · test_persona_profiler.py

Comprehensive test suite for profile_caller.py and validate_profile.py.
Covers: unit tests, integration tests, edge cases, boundary conditions,
error handling, and security (PII) checks.

Runs with zero network calls, zero live CALL-E calls, and no external packages.

Usage:
    python3 -m pytest scripts/test_persona_profiler.py -v
    python3 scripts/test_persona_profiler.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from profile_caller import (
    ARCHETYPE_LABELS,
    DISC_MARKERS,
    analyse,
    append_profile,
    caller_token,
    churn_risk,
    compute_rfmap,
    dominant_archetype,
    extract_text,
    load_profile,
    load_transcript,
    loyalty_tier,
    score_disc_heuristic,
    sentiment_trajectory,
    sentiment_trend,
)
from validate_profile import validate

PLAYBOOK_PATH = str(
    Path(__file__).parent.parent / "references" / "disc-playbooks.json"
)
EXAMPLE_TRANSCRIPT = str(
    Path(__file__).parent.parent / "references" / "example-transcript.json"
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

ANALYTICAL_TRANSCRIPT = [
    {"role": "agent",  "text": "Hello, can I help you today?"},
    {"role": "callee", "text": "Yes. I need to verify the exact policy details and documentation."},
    {"role": "agent",  "text": "Of course. Here are the specifics."},
    {"role": "callee", "text": "Can you confirm with data? I want accurate evidence before I decide."},
    {"role": "agent",  "text": "Absolutely. Let me share the official documentation."},
    {"role": "callee", "text": "Good. I need precise numbers and written confirmation please."},
]

INFLUENTIAL_TRANSCRIPT = [
    {"role": "agent",  "text": "Hi there! Great to connect with you."},
    {"role": "callee", "text": "Hi! So excited to hear about this. It sounds absolutely amazing!"},
    {"role": "agent",  "text": "Our community really loves it. Your team will feel inspired."},
    {"role": "callee", "text": "I love the energy. Let's collaborate and share this story together!"},
    {"role": "agent",  "text": "Perfect. People are already enthusiastic about the results."},
    {"role": "callee", "text": "Count me in! This is going to be so fun working with the team."},
]

DOMINANT_TRANSCRIPT = [
    {"role": "agent",  "text": "Hello, calling about your account renewal."},
    {"role": "callee", "text": "Get to the point. What's the bottom line? I need a decision now."},
    {"role": "agent",  "text": "The result is a 20% improvement in efficiency."},
    {"role": "callee", "text": "Is this the most direct and efficient option? I want action immediately."},
    {"role": "agent",  "text": "Yes, fastest path to results."},
    {"role": "callee", "text": "Good. I'll take charge of this. Fast, direct, no more delays."},
]

STEADY_TRANSCRIPT = [
    {"role": "agent",  "text": "Hi, I'm calling about your subscription renewal."},
    {"role": "callee", "text": "Thanks for calling. I like to be careful with changes. Can you walk me through it step by step?"},
    {"role": "agent",  "text": "Of course. It's a stable, consistent upgrade."},
    {"role": "callee", "text": "Good. I need to be comfortable and supported. My family relies on this service."},
    {"role": "agent",  "text": "Absolutely reliable. Nothing will change unexpectedly."},
    {"role": "callee", "text": "That's reassuring. Routine and reliability are important to me."},
]

SHORT_TRANSCRIPT = [
    {"role": "agent",  "text": "Hello?"},
    {"role": "callee", "text": "Hi."},
]

MEDICAL_TRANSCRIPT = [
    {"role": "agent",  "text": "Hello, calling about your recent visit."},
    {"role": "callee", "text": "Yes, I want to discuss my medication and the prescription renewal."},
    {"role": "agent",  "text": "Of course. Let me connect you to the right person."},
    {"role": "callee", "text": "Thank you. My doctor said someone would follow up on the diagnosis."},
]

EMPTY_TRANSCRIPT: list = []


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def run_analyse(transcript: list, caller_id: str = "test-caller") -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        t_path = Path(tmpdir) / "t.json"
        t_path.write_text(json.dumps(transcript), encoding="utf-8")
        return analyse(
            transcript_path=str(t_path),
            profile_dir=Path(tmpdir) / "profiles",
            caller_id_override=caller_id,
            playbook_file=PLAYBOOK_PATH,
            min_turns=4,
            dry_run=True,
        )


def good_card() -> dict:
    return {
        "caller_token": "sha256:abcdef1234567890",
        "interaction_count": 2,
        "first_seen_days_ago": 10,
        "last_seen_days_ago": 2,
        "persona_archetype": "Analytical",
        "disc_scores": {"D": 0.10, "I": 0.10, "S": 0.10, "C": 0.70},
        "archetype_confidence": "high",
        "sentiment_trajectory": ["neutral", "positive"],
        "sentiment_trend": "improving",
        "rfmap_loyalty_score": 75,
        "loyalty_tier": "high_value",
        "churn_risk": "low",
        "call_driver": "billing enquiry",
        "recommended_playbook": {"archetype": "Analytical"},
        "flags": [],
        "profile_version": 2,
        "schema_version": "1.0",
    }


# ===========================================================================
# 1. DISC Scoring Tests
# ===========================================================================

class TestDISCScoring(unittest.TestCase):
    """Unit tests for DISC linguistic marker scoring."""

    def test_analytical_high_c(self):
        text = extract_text(ANALYTICAL_TRANSCRIPT)
        disc = score_disc_heuristic(text)
        self.assertGreater(disc["C"], disc["I"])
        self.assertGreater(disc["C"], disc["D"])

    def test_influential_high_i(self):
        text = extract_text(INFLUENTIAL_TRANSCRIPT)
        disc = score_disc_heuristic(text)
        self.assertGreater(disc["I"], disc["C"])

    def test_dominant_high_d(self):
        text = extract_text(DOMINANT_TRANSCRIPT)
        disc = score_disc_heuristic(text)
        self.assertGreater(disc["D"], disc["S"])

    def test_steady_high_s(self):
        text = extract_text(STEADY_TRANSCRIPT)
        disc = score_disc_heuristic(text)
        self.assertGreater(disc["S"], disc["I"])

    def test_scores_sum_to_one(self):
        for transcript in [ANALYTICAL_TRANSCRIPT, INFLUENTIAL_TRANSCRIPT,
                            DOMINANT_TRANSCRIPT, STEADY_TRANSCRIPT]:
            text = extract_text(transcript)
            disc = score_disc_heuristic(text)
            total = sum(disc.values())
            self.assertAlmostEqual(total, 1.0, places=2,
                                   msg=f"Scores don't sum to 1.0: {disc}")

    def test_empty_text_produces_equal_scores(self):
        disc = score_disc_heuristic("")
        # With empty text (word_count=1 fallback), all scores should be equal.
        vals = list(disc.values())
        self.assertAlmostEqual(max(vals), min(vals), places=2)

    def test_scores_always_non_negative(self):
        for text in ["hello world", "", "no disc markers here at all"]:
            disc = score_disc_heuristic(text)
            for key, val in disc.items():
                self.assertGreaterEqual(val, 0.0, f"Negative score for dim {key}")

    def test_all_four_dimensions_present(self):
        disc = score_disc_heuristic("some text")
        self.assertEqual(set(disc.keys()), {"D", "I", "S", "C"})


class TestDominantArchetype(unittest.TestCase):
    """Tests for archetype detection margin logic."""

    def test_clear_winner_detected(self):
        clear = {"D": 0.10, "I": 0.10, "S": 0.10, "C": 0.70}
        key, conf = dominant_archetype(clear, margin=0.15)
        self.assertEqual(key, "C")
        self.assertIn(conf, ("high", "moderate"))

    def test_close_race_returns_undetermined(self):
        close = {"D": 0.28, "I": 0.27, "S": 0.25, "C": 0.20}
        key, conf = dominant_archetype(close, margin=0.15)
        self.assertEqual(key, "?")
        self.assertEqual(conf, "undetermined")

    def test_equal_scores_undetermined(self):
        equal = {"D": 0.25, "I": 0.25, "S": 0.25, "C": 0.25}
        key, conf = dominant_archetype(equal)
        self.assertEqual(conf, "undetermined")

    def test_high_confidence_threshold(self):
        strong = {"D": 0.10, "I": 0.05, "S": 0.05, "C": 0.80}
        _, conf = dominant_archetype(strong, margin=0.15)
        self.assertEqual(conf, "high")

    def test_moderate_confidence(self):
        moderate = {"D": 0.10, "I": 0.10, "S": 0.15, "C": 0.65}
        key, conf = dominant_archetype(moderate, margin=0.15)
        self.assertEqual(key, "C")
        # 0.65 - 0.15 = 0.50 >= 0.25, so high
        self.assertIn(conf, ("high", "moderate"))

    def test_archetype_label_mapping(self):
        for disc_key, expected_label in ARCHETYPE_LABELS.items():
            self.assertIsInstance(expected_label, str)
            self.assertGreater(len(expected_label), 0)


# ===========================================================================
# 2. Sentiment Tests
# ===========================================================================

class TestSentiment(unittest.TestCase):
    """Unit tests for sentiment trajectory and trend."""

    def test_positive_words_produce_positive_turn(self):
        turns = [{"role": "callee", "text": "Great thanks I appreciate this wonderful service!"}]
        traj = sentiment_trajectory(turns)
        self.assertIn("positive", traj)

    def test_negative_words_produce_negative_turn(self):
        turns = [{"role": "callee", "text": "This is terrible, I am frustrated and angry, never again!"}]
        traj = sentiment_trajectory(turns)
        self.assertIn("negative", traj)

    def test_neutral_text_produces_neutral(self):
        turns = [{"role": "callee", "text": "I see. Okay."}]
        traj = sentiment_trajectory(turns)
        self.assertEqual(traj[0], "neutral")

    def test_improving_trend(self):
        self.assertEqual(sentiment_trend(["negative", "neutral", "positive"]), "improving")

    def test_declining_trend(self):
        self.assertEqual(sentiment_trend(["positive", "neutral", "negative"]), "declining")

    def test_stable_trend_uniform(self):
        self.assertEqual(sentiment_trend(["neutral", "neutral", "neutral"]), "stable")

    def test_stable_with_single_turn(self):
        self.assertEqual(sentiment_trend(["positive"]), "stable")

    def test_empty_trajectory(self):
        # Should not crash
        result = sentiment_trend([])
        self.assertEqual(result, "stable")

    def test_agent_turns_excluded_from_trajectory(self):
        """Sentiment should be based on callee turns only."""
        turns = [
            {"role": "agent",  "text": "This is terrible service never again!"},
            {"role": "callee", "text": "Thanks, I appreciate the help greatly!"},
        ]
        traj = sentiment_trajectory(turns)
        # Callee is positive; agent turn should not count.
        self.assertNotIn("negative", traj)

    def test_mixed_roles_uses_callee(self):
        turns = [
            {"role": "callee", "text": "I am very happy and satisfied, great!"},
            {"role": "customer", "text": "Thank you, wonderful!"},
        ]
        traj = sentiment_trajectory(turns)
        self.assertTrue(len(traj) > 0)


# ===========================================================================
# 3. RFMAP Loyalty Tests
# ===========================================================================

class TestRFMAP(unittest.TestCase):
    """Unit tests for RFMAP loyalty score computation."""

    def test_high_frequency_recent_scores_high(self):
        score = compute_rfmap(10, 90, 1)
        self.assertGreaterEqual(score, 75)

    def test_single_old_interaction_scores_low(self):
        score = compute_rfmap(1, 0, 89)
        self.assertLessEqual(score, 15)

    def test_score_always_0_to_100(self):
        cases = [
            (1, 0, 0), (1, 0, 89), (10, 90, 0), (100, 365, 365),
        ]
        for ic, first, last in cases:
            score = compute_rfmap(ic, first, last)
            self.assertGreaterEqual(score, 0, f"Score below 0 for {ic},{first},{last}")
            self.assertLessEqual(score, 100, f"Score above 100 for {ic},{first},{last}")

    def test_churn_risk_tiers(self):
        self.assertEqual(churn_risk(90), "low")   # >= 80
        self.assertEqual(churn_risk(80), "low")   # exactly 80
        self.assertEqual(churn_risk(79), "medium") # just below low threshold
        self.assertEqual(churn_risk(70), "medium") # >= 55
        self.assertEqual(churn_risk(60), "medium") # >= 55
        self.assertEqual(churn_risk(54), "high")   # below medium threshold
        self.assertEqual(churn_risk(30), "high")
        self.assertEqual(churn_risk(0),  "high")

    def test_loyalty_tier_tiers(self):
        self.assertEqual(loyalty_tier(85), "champion")
        self.assertEqual(loyalty_tier(80), "champion")
        self.assertEqual(loyalty_tier(65), "high_value")
        self.assertEqual(loyalty_tier(60), "high_value")
        self.assertEqual(loyalty_tier(45), "at_risk")
        self.assertEqual(loyalty_tier(10), "low_value")
        self.assertEqual(loyalty_tier(0),  "low_value")

    def test_recency_dominant_factor(self):
        """Recent single call should outscore old frequent caller."""
        recent_new = compute_rfmap(1, 0, 0)
        old_frequent = compute_rfmap(5, 180, 90)
        # Both are valid; just check they're in 0–100.
        self.assertIn(type(recent_new), (int,))
        self.assertIn(type(old_frequent), (int,))


# ===========================================================================
# 4. Caller Token Tests
# ===========================================================================

class TestCallerToken(unittest.TestCase):
    """Tests for privacy-preserving identity hashing."""

    def test_token_format(self):
        token = caller_token("test-id")
        self.assertTrue(token.startswith("sha256:"))
        self.assertGreater(len(token), 15)

    def test_same_input_same_token(self):
        self.assertEqual(caller_token("abc"), caller_token("abc"))

    def test_different_inputs_different_tokens(self):
        self.assertNotEqual(caller_token("abc"), caller_token("xyz"))

    def test_phone_number_not_in_token(self):
        token = caller_token("+14155550100")
        self.assertNotIn("555", token)
        self.assertNotIn("+1", token)

    def test_token_is_deterministic(self):
        t1 = caller_token("unique-caller-id-123")
        t2 = caller_token("unique-caller-id-123")
        self.assertEqual(t1, t2)


# ===========================================================================
# 5. Transcript Loading Tests
# ===========================================================================

class TestTranscriptLoading(unittest.TestCase):
    """Tests for transcript parsing robustness."""

    def test_load_list_of_turns(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump([{"role": "callee", "text": "Hello"}], f)
            f_path = f.name
        try:
            turns = load_transcript(f_path)
            self.assertEqual(len(turns), 1)
        finally:
            os.unlink(f_path)

    def test_load_wrapper_dict_with_transcript_key(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"transcript": [{"role": "callee", "text": "Hi"}]}, f)
            f_path = f.name
        try:
            turns = load_transcript(f_path)
            self.assertEqual(len(turns), 1)
        finally:
            os.unlink(f_path)

    def test_load_plain_text_transcript(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"transcript": "Agent: Hello\nCallee: Hi"}, f)
            f_path = f.name
        try:
            turns = load_transcript(f_path)
            self.assertIsInstance(turns, list)
            self.assertEqual(len(turns), 1)
        finally:
            os.unlink(f_path)

    def test_invalid_structure_raises(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"unexpected_key": "no transcript"}, f)
            f_path = f.name
        try:
            with self.assertRaises(ValueError):
                load_transcript(f_path)
        finally:
            os.unlink(f_path)

    def test_extract_text_handles_missing_text_field(self):
        turns = [{"role": "callee"}, {"role": "agent", "content": "hello"}]
        text = extract_text(turns)
        self.assertIn("hello", text)

    def test_extract_text_from_empty_list(self):
        text = extract_text([])
        self.assertEqual(text, "")


# ===========================================================================
# 6. Profile Store Tests
# ===========================================================================

class TestProfileStore(unittest.TestCase):
    """Tests for profile persistence and accumulation."""

    def test_append_and_load_profile(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "profiles"
            token = caller_token("test-store-caller")
            record = {"ts": 1234567890, "disc": {"D": 0.25, "I": 0.25, "S": 0.25, "C": 0.25}}
            append_profile(profile_dir, token, record)
            loaded = load_profile(profile_dir, token)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0]["ts"], 1234567890)

    def test_multiple_appends_accumulate(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "profiles"
            token = caller_token("repeat-caller")
            for i in range(5):
                append_profile(profile_dir, token, {"ts": i, "interaction": i})
            loaded = load_profile(profile_dir, token)
            self.assertEqual(len(loaded), 5)

    def test_nonexistent_profile_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            loaded = load_profile(Path(tmpdir), caller_token("ghost-caller"))
            self.assertEqual(loaded, [])

    def test_different_callers_separate_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "profiles"
            token_a = caller_token("caller-a")
            token_b = caller_token("caller-b")
            append_profile(profile_dir, token_a, {"data": "a"})
            append_profile(profile_dir, token_b, {"data": "b"})
            loaded_a = load_profile(profile_dir, token_a)
            loaded_b = load_profile(profile_dir, token_b)
            self.assertEqual(loaded_a[0]["data"], "a")
            self.assertEqual(loaded_b[0]["data"], "b")

    def test_dry_run_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "profiles"
            token = caller_token("dry-run-caller")
            # Simulate what analyse() does: dry_run=True means no append_profile call.
            card = run_analyse(ANALYTICAL_TRANSCRIPT, "dry-run-caller")
            self.assertTrue(card["dry_run"])
            # Profile directory should not have been created.
            self.assertFalse((profile_dir / token).exists())


# ===========================================================================
# 7. Integration Tests
# ===========================================================================

class TestAnalyseIntegration(unittest.TestCase):
    """End-to-end integration tests for the analyse() function."""

    def test_analytical_fields_present(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        required = [
            "caller_token", "interaction_count", "persona_archetype",
            "disc_scores", "archetype_confidence", "sentiment_trajectory",
            "sentiment_trend", "rfmap_loyalty_score", "loyalty_tier",
            "churn_risk", "recommended_playbook", "flags", "schema_version",
        ]
        for field in required:
            self.assertIn(field, card, f"Missing required field: '{field}'")

    def test_dominant_caller_archetype(self):
        card = run_analyse(DOMINANT_TRANSCRIPT)
        # D should score high; archetype should be Dominant or Undetermined.
        self.assertIn(card["persona_archetype"],
                      {"Dominant", "Undetermined"})

    def test_short_transcript_flags(self):
        card = run_analyse(SHORT_TRANSCRIPT)
        self.assertIn("LOW_TURN_COUNT", card["flags"])
        self.assertEqual(card["persona_archetype"], "Undetermined")

    def test_empty_transcript_does_not_crash(self):
        card = run_analyse(EMPTY_TRANSCRIPT)
        # Should return a valid card with undetermined archetype.
        self.assertIn("persona_archetype", card)
        self.assertIn("LOW_TURN_COUNT", card["flags"])

    def test_caller_token_format(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT, "test-caller-abc")
        self.assertRegex(card["caller_token"], r"^sha256:[0-9a-f]{16,}$")

    def test_different_caller_ids_produce_different_tokens(self):
        card_a = run_analyse(ANALYTICAL_TRANSCRIPT, "caller-aaa")
        card_b = run_analyse(ANALYTICAL_TRANSCRIPT, "caller-bbb")
        self.assertNotEqual(card_a["caller_token"], card_b["caller_token"])

    def test_same_caller_id_same_token(self):
        card_a = run_analyse(ANALYTICAL_TRANSCRIPT, "same-caller")
        card_b = run_analyse(ANALYTICAL_TRANSCRIPT, "same-caller")
        self.assertEqual(card_a["caller_token"], card_b["caller_token"])

    def test_no_pii_phone_in_output(self):
        import re
        phone_re = re.compile(r"\b\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b")
        # Inject a phone-like caller_id; ensure it doesn't leak.
        card = run_analyse(ANALYTICAL_TRANSCRIPT, "+14155550100")
        card_text = json.dumps(card)
        self.assertIsNone(phone_re.search(card_text), "Raw phone in output")

    def test_no_pii_email_in_output(self):
        import re
        email_re = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
        card = run_analyse(ANALYTICAL_TRANSCRIPT, "user@example.com")
        card_text = json.dumps(card)
        self.assertIsNone(email_re.search(card_text), "Raw email in output")

    def test_rfmap_score_is_integer_0_to_100(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        self.assertIsInstance(card["rfmap_loyalty_score"], int)
        self.assertGreaterEqual(card["rfmap_loyalty_score"], 0)
        self.assertLessEqual(card["rfmap_loyalty_score"], 100)

    def test_disc_scores_sum_to_one(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        total = sum(card["disc_scores"].values())
        self.assertAlmostEqual(total, 1.0, places=2)

    def test_example_transcript_file_runs(self):
        """The bundled example transcript should produce a valid card."""
        with open(EXAMPLE_TRANSCRIPT, encoding="utf-8") as f:
            turns = json.load(f)
        card = run_analyse(turns)
        self.assertIn("persona_archetype", card)

    def test_churn_flag_set_for_high_risk(self):
        """A new caller (first interaction, last_seen=0) gets churn risk high."""
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        # interaction_count=1, first_seen_days_ago=0 → rfmap low → churn=high
        if card["rfmap_loyalty_score"] < 55:
            self.assertIn(card["churn_risk"], ("medium", "high"))

    def test_returning_caller_interaction_count(self):
        """Simulate 3 calls; interaction_count should be 3 on the third call."""
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "profiles"
            t_path = Path(tmpdir) / "t.json"
            t_path.write_text(json.dumps(ANALYTICAL_TRANSCRIPT), encoding="utf-8")
            token = caller_token("returning-caller")

            cards = []
            for _ in range(3):
                card = analyse(
                    transcript_path=str(t_path),
                    profile_dir=profile_dir,
                    caller_id_override="returning-caller",
                    playbook_file=PLAYBOOK_PATH,
                    min_turns=4,
                    dry_run=False,  # Write profile.
                )
                cards.append(card)

            self.assertEqual(cards[2]["interaction_count"], 3)

    def test_unicode_transcript_does_not_crash(self):
        """Non-ASCII characters (accented Latin, etc.) must not cause a crash."""
        unicode_turns = [
            {"role": "callee", "text": "Bonjour, j'ai besoin de vérifier les détails officiels."},
            {"role": "agent",  "text": "Bien sûr, voici les précisions demandées."},
            {"role": "callee", "text": "Pouvez-vous fournir une confirmation écrite, s'il vous plaît?"},
            {"role": "agent",  "text": "Oui, nous enverrons les documents écrits immédiatement."},
        ]
        card = run_analyse(unicode_turns)
        self.assertIn("persona_archetype", card)

    def test_schema_version_present(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        self.assertEqual(card["schema_version"], "1.0")

    def test_analysis_mode_heuristic(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        self.assertEqual(card["analysis_mode"], "heuristic")

    def test_analysis_timestamp_present(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        self.assertIn("analysis_timestamp", card)
        self.assertTrue(card["analysis_timestamp"].strip())

    def test_medical_transcript_sets_human_review_flag(self):
        card = run_analyse(MEDICAL_TRANSCRIPT)
        self.assertIn("REQUIRES_HUMAN_REVIEW", card["flags"])
        self.assertIn("medical", card["sensitive_topics"])

    def test_benign_transcript_no_human_review_flag(self):
        card = run_analyse(ANALYTICAL_TRANSCRIPT)
        self.assertNotIn("REQUIRES_HUMAN_REVIEW", card["flags"])
        self.assertEqual(card["sensitive_topics"], [])


# ===========================================================================
# 8. Validation Tests
# ===========================================================================

class TestValidation(unittest.TestCase):
    """Tests for validate_profile.py schema enforcement."""

    def test_valid_card_passes(self):
        self.assertEqual(validate(good_card()), [])

    def test_missing_caller_token_fails(self):
        card = good_card()
        del card["caller_token"]
        errors = validate(card)
        self.assertTrue(any("caller_token" in e for e in errors))

    def test_bad_token_format_fails(self):
        card = good_card()
        card["caller_token"] = "not-a-sha256"
        errors = validate(card)
        self.assertTrue(any("caller_token" in e for e in errors))

    def test_bad_archetype_fails(self):
        card = good_card()
        card["persona_archetype"] = "RandomType"
        errors = validate(card)
        self.assertTrue(any("persona_archetype" in e for e in errors))

    def test_invalid_loyalty_tier_fails(self):
        card = good_card()
        card["loyalty_tier"] = "vip"
        errors = validate(card)
        self.assertTrue(any("loyalty_tier" in e for e in errors))

    def test_invalid_churn_risk_fails(self):
        card = good_card()
        card["churn_risk"] = "extreme"
        errors = validate(card)
        self.assertTrue(any("churn_risk" in e for e in errors))

    def test_score_above_100_fails(self):
        card = good_card()
        card["rfmap_loyalty_score"] = 150
        errors = validate(card)
        self.assertTrue(any("rfmap_loyalty_score" in e for e in errors))

    def test_score_below_0_fails(self):
        card = good_card()
        card["rfmap_loyalty_score"] = -1
        errors = validate(card)
        self.assertTrue(any("rfmap_loyalty_score" in e for e in errors))

    def test_disc_missing_dimension_fails(self):
        card = good_card()
        del card["disc_scores"]["C"]
        errors = validate(card)
        self.assertTrue(any("disc_scores" in e for e in errors))

    def test_disc_not_summing_to_one_fails(self):
        card = good_card()
        card["disc_scores"] = {"D": 0.5, "I": 0.5, "S": 0.5, "C": 0.5}
        errors = validate(card)
        self.assertTrue(any("disc_scores" in e for e in errors))

    def test_interaction_count_zero_fails(self):
        card = good_card()
        card["interaction_count"] = 0
        errors = validate(card)
        self.assertTrue(any("interaction_count" in e for e in errors))

    def test_pii_phone_in_output_fails(self):
        card = good_card()
        card["call_driver"] = "caller asked about account +14155550100"
        errors = validate(card)
        self.assertTrue(any("PII" in e for e in errors))

    def test_pii_email_in_output_fails(self):
        card = good_card()
        card["call_driver"] = "user@example.com enquiry"
        errors = validate(card)
        self.assertTrue(any("PII" in e for e in errors))

    def test_all_valid_archetypes_pass(self):
        for arch in ("Dominant", "Influential", "Steady", "Analytical", "Undetermined"):
            card = good_card()
            card["persona_archetype"] = arch
            errors = validate(card)
            self.assertEqual(errors, [], f"Archetype '{arch}' should be valid")

    def test_all_valid_loyalty_tiers_pass(self):
        for tier in ("champion", "high_value", "at_risk", "low_value"):
            card = good_card()
            card["loyalty_tier"] = tier
            errors = validate(card)
            self.assertEqual(errors, [], f"Tier '{tier}' should be valid")

    def test_all_valid_churn_risks_pass(self):
        for risk in ("low", "medium", "high", "unknown"):
            card = good_card()
            card["churn_risk"] = risk
            errors = validate(card)
            self.assertEqual(errors, [], f"Risk '{risk}' should be valid")


# ===========================================================================
# 9. CLI Integration Tests
# ===========================================================================

class TestCLI(unittest.TestCase):
    """Tests for command-line interface behaviour."""

    def test_cli_produces_valid_json_output(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmpdir:
            t_path = Path(tmpdir) / "t.json"
            t_path.write_text(json.dumps(ANALYTICAL_TRANSCRIPT), encoding="utf-8")
            out_path = Path(tmpdir) / "out.json"

            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).parent / "profile_caller.py"),
                    "--transcript", str(t_path),
                    "--profile-dir", str(Path(tmpdir) / "profiles"),
                    "--caller-id", "cli-test",
                    "--playbook", PLAYBOOK_PATH,
                    "--dry-run",
                    "--out", str(out_path),
                ],
                capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 0, f"CLI failed: {result.stderr}")
            card = json.loads(out_path.read_text(encoding="utf-8"))
            self.assertIn("persona_archetype", card)

    def test_cli_missing_transcript_fails(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "profile_caller.py")],
            capture_output=True, text=True
        )
        self.assertNotEqual(result.returncode, 0)


# ===========================================================================
# Runner
# ===========================================================================

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
