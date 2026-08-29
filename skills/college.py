import os
from calle import CalleClient

client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"]
)

COLLEGE_NUMBER = "+919894277225"
def tnea_enquiry():

    call = client.calls.create_and_wait(
        task=f"""
        Call the college office at {COLLEGE_NUMBER}.

        You are a student who received admission through TNEA.

        Ask:
        1. When should I come for the admission process?
        2. What documents should I bring?
        3. What is the complete fee structure?
        4. What is the fee payment deadline?
        5. When does college start for newly admitted students?
        6. Is hostel accommodation available?
        7. What is the hostel fee and application process?

        Speak naturally and politely.
        If an answer is unclear, ask a follow-up question.

        Return all information clearly.
        """,

        result_schema={
            "type": "object",
            "properties": {
                "admission_visit": {"type": "string"},
                "documents": {"type": "string"},
                "fees": {"type": "string"},
                "fee_deadline": {"type": "string"},
                "college_start": {"type": "string"},
                "hostel": {"type": "string"}
            },
            "required": [
                "admission_visit",
                "documents",
                "fees",
                "fee_deadline",
                "college_start",
                "hostel"
            ]
        }
    )

    return call["structured_result"]