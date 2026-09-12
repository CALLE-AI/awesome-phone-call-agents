import time

from config import CALLE_API_KEY
from calle import CalleClient


class CallService:
    def __init__(self):
        self.client = CalleClient(
            api_key=CALLE_API_KEY,
            timeout=60.0,
        )
        self.calls = self.client.calls

    def prepare_call(self, follow_up):
        return {
            "task": follow_up.call_goal,
            "recipient": {
                "phone": follow_up.phone_number
            },
            "mode": "dry_run",
        }

    def create_call(self, follow_up):
        result_schema = {
            "type": "object",
            "properties": {
                "outcome": {"type": "string"},
                "notes": {"type": "string"},
                "next_action": {"type": "string"},
                "callback_at": {"type": "string"},
            },
            "required": [
                "outcome",
                "notes",
                "next_action",
            ],
        }

        return self.calls.create(
            task=follow_up.call_goal,
            recipient={
                "phone": follow_up.phone_number
            },
            result_schema=result_schema,
        )

    def wait_for_result(self, call_id, timeout_seconds=300):
        """
        Poll CALL-E for the call status.

        This avoids keeping one long HTTP request open,
        which previously caused the Streamlit app to time out.
        """

        start_time = time.time()

        while time.time() - start_time < timeout_seconds:
            call = self.calls.get(call_id)

            status = call.get("status")

            if status in {
                "completed",
                "failed",
                "cancelled",
                "canceled",
            }:
                return call

            time.sleep(5)

        raise TimeoutError(
            f"CALL-E call {call_id} did not finish within "
            f"{timeout_seconds} seconds."
        )

    def get_call(self, call_id):
        return self.calls.get(call_id)
