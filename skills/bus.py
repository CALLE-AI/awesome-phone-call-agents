import os
from calle import CalleClient

client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"]
)

BUS_SYSTEM_NUMBER = "+919894277225"

def bus_enquiry():

    call = client.calls.create_and_wait(
        task=f"""
        Call the automated bus tracking system at
        {BUS_SYSTEM_NUMBER}.

        You are a passenger trying to reach your destination.

        Find out:
        1. What bus is available next?
        2. Where is the bus currently located?
        3. How many minutes until it reaches my pickup point?
        4. If I miss this bus, what is the next available bus?
        5. What is the route?
        6. What time will it reach my destination?
        7. What is the current crowd level?

        Listen carefully to the system response.
        Ask for clarification if necessary.

        Return the information clearly.
        """,

        result_schema={
            "type": "object",
            "properties": {
                "next_bus": {"type": "string"},
                "current_location": {"type": "string"},
                "arrival_at_pickup": {"type": "string"},
                "next_bus_if_missed": {"type": "string"},
                "route": {"type": "string"},
                "destination_eta": {"type": "string"},
                "crowd_level": {"type": "string"}
            },
            "required": [
                "next_bus",
                "current_location",
                "arrival_at_pickup",
                "next_bus_if_missed",
                "route",
                "destination_eta",
                "crowd_level"
            ]
        }
    )

    return call["structured_result"]