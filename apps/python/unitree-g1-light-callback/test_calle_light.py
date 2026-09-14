import copy
import unittest
from calle_light import extract_command, phone

def call():
    return {"id": "call_example", "status": "completed", "structured_result": {
        "decision": "turn_off_demo_light", "human_reached": "yes", "confirmation_quote": "Yes, please."},
        "recipients": [{"attempts": [{"transcript_turns": [
            {"speaker": "bot", "text": "Turn off the demo light. Is that correct?"},
            {"speaker": "user", "text": "Yes, please."}]}]}]}

class ContractTests(unittest.TestCase):
    def test_confirmed_request_is_not_execution(self):
        result = extract_command(call())
        self.assertEqual(result["action"], "turn_off_light")
        self.assertEqual(result["execution_status"], "not_dispatched")
    def test_final_correction_blocks_old_yes(self):
        data = call()
        data["recipients"][0]["attempts"][0]["transcript_turns"].append({"speaker": "user", "text": "Actually, leave it on."})
        self.assertIsNone(extract_command(data))
    def test_negated_confirmation(self):
        data = call()
        data["structured_result"]["confirmation_quote"] = "No, don't do that."
        data["recipients"][0]["attempts"][0]["transcript_turns"][-1]["text"] = "No, don't do that."
        self.assertIsNone(extract_command(data))
    def test_voicemail_and_unfinished_call(self):
        data = call();data["structured_result"]["human_reached"] = "no"
        self.assertIsNone(extract_command(data))
        data = call();data["status"] = "in_progress"
        self.assertIsNone(extract_command(data))
    def test_missing_transcript(self):
        data = call();data["recipients"] = []
        self.assertIsNone(extract_command(data))
    def test_australian_trunk_prefix(self):
        self.assertEqual(phone("+61 0400 000 000"), "+61400000000")

if __name__ == "__main__":
    unittest.main()
