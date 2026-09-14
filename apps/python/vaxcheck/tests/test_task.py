import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vaxcheck.task import Session, Student, build_task, display_goal, idempotency_key, preflight_goal

SESSION = Session.from_dict({
    "school_name": "Riverside Primary School", "vaccine_name": "HPV vaccine (dose 1)",
    "session_date": "2026-10-02", "nurse_contact": "the school office on +1 415 555 0100",
})
STUDENT = Student.from_dict({
    "student_id": "S-041", "student_name": "Aisha Rahman", "class_name": "P5-B",
    "guardian_name": "Nadia Rahman", "guardian_phone": "+14155550101",
})


class TestTask(unittest.TestCase):
    def test_script_never_contains_the_raw_number(self):
        self.assertNotIn(STUDENT.guardian_phone, build_task(SESSION, STUDENT))

    def test_display_goal_is_masked(self):
        self.assertNotIn(STUDENT.guardian_phone, display_goal(SESSION, STUDENT))
        self.assertIn("0101", display_goal(SESSION, STUDENT))

    def test_script_carries_the_safety_boundaries(self):
        # Collapse whitespace: the assertion is about content, not line wrapping.
        task = " ".join(build_task(SESSION, STUDENT).lower().split())
        for phrase in ("no medical advice", "hard boundaries", "automated assistant",
                       "do not diagnose", "decline is final"):
            self.assertIn(phrase, task, phrase)

    def test_script_confirms_identity_before_detail(self):
        task = build_task(SESSION, STUDENT)
        self.assertLess(task.index("CONFIRM IDENTITY"), task.index("COLLECT"))
        self.assertIn("Do not reveal any information about the student until", task)

    def test_script_discloses_first(self):
        task = build_task(SESSION, STUDENT)
        self.assertLess(task.index("DISCLOSE"), task.index("CONFIRM IDENTITY"))

    def test_preflight_goal_is_unambiguous_and_masked(self):
        goal = preflight_goal(SESSION, STUDENT)
        self.assertNotIn(STUDENT.guardian_phone, goal)
        self.assertNotIn("0101", goal)
        # The planner must read this as *collecting* a decision, not giving one.
        self.assertIn("collect the guardian's decision", goal)
        self.assertIn("on behalf of", goal)
        self.assertIn("Give no medical advice", goal)

    def test_idempotency_key_is_deterministic(self):
        self.assertEqual(idempotency_key(SESSION, STUDENT), idempotency_key(SESSION, STUDENT))

    def test_idempotency_key_differs_per_student_and_session(self):
        other = Student.from_dict({
            "student_id": "S-042", "student_name": "Marcus Tan", "class_name": "P5-B",
            "guardian_name": "Grace Tan", "guardian_phone": "+14155550102",
        })
        self.assertNotEqual(idempotency_key(SESSION, STUDENT), idempotency_key(SESSION, other))
        later = Session.from_dict({**SESSION.__dict__, "session_date": "2026-11-02"})
        self.assertNotEqual(idempotency_key(SESSION, STUDENT), idempotency_key(later, STUDENT))

    def test_missing_fields_are_rejected(self):
        with self.assertRaises(ValueError):
            Student.from_dict({"student_id": "S-1"})
        with self.assertRaises(ValueError):
            Session.from_dict({"school_name": "X"})


if __name__ == "__main__":
    unittest.main()
