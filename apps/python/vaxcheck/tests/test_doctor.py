import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vaxcheck.doctor import FAIL, WARN, classify_blockers


class TestClassifyBlockers(unittest.TestCase):
    def test_corridor_refusal_is_a_hard_fail(self):
        status, _ = classify_blockers([
            "The recipient number is recognized as Indonesia, but calls in "
            "Indonesia / English are not currently supported."
        ])
        self.assertEqual(status, FAIL)

    def test_goal_question_is_a_warning_not_a_dead_corridor(self):
        status, detail = classify_blockers([
            "What should the bot do about the consent - give it or check it?"
        ])
        self.assertEqual(status, WARN)
        self.assertIn("corridor accepted", detail)

    def test_no_reason_fails_closed(self):
        self.assertEqual(classify_blockers([])[0], FAIL)


if __name__ == "__main__":
    unittest.main()
