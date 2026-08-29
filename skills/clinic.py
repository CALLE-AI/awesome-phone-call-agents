import os
from calle import CalleClient

client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"]
)

CLINIC_NUMBER = "+919894277225"

def clinic_enquiry():

    call = client.calls.create_and_wait(
        task=f"""
        Call the clinic at {CLINIC_NUMBER}.

        You are calling as a patient.

        Find out:
        1. Can I book a token now?
        2. What is my token number?
        3. What time will the doctor arrive?
        4. How many patients are ahead of me?
        5. What is the estimated waiting time?

        Speak naturally and politely.
        If any information is unclear or missing, ask a follow-up.

        Return the final information clearly.
        """,

        result_schema={
            "type": "object",
            "properties": {
                "token_booked": {"type": "string"},
                "token_number": {"type": "string"},
                "doctor_arrival": {"type": "string"},
                "patients_ahead": {"type": "string"},
                "estimated_wait": {"type": "string"}
            },
            "required": [
                "token_booked",
                "token_number",
                "doctor_arrival",
                "patients_ahead",
                "estimated_wait"
            ]
        }
    )

    return call["structured_result"]