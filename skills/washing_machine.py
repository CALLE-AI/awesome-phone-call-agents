import os
from calle import CalleClient

client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"]
)

WASHING_SYSTEM_NUMBER = "+919894277225"


def washing_machine():

    call = client.calls.create_and_wait(
        task=f"""
        Call the automated washing machine system at
        {WASHING_SYSTEM_NUMBER}.

        Find out:
        1. Which washing machines are currently available?
        2. Which machines are currently busy?
        3. If all are busy, when will the next machine become available?

        Listen carefully and return the status clearly.
        """,

        result_schema={
            "type": "object",
            "properties": {
                "available_machines": {
                    "type": "string"
                },
                "busy_machines": {
                    "type": "string"
                },
                "next_available": {
                    "type": "string"
                }
            },
            "required": [
                "available_machines",
                "busy_machines",
                "next_available"
            ]
        }
    )

    return call["structured_result"]