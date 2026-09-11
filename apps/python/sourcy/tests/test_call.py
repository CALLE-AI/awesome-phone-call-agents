import os
from calle import CalleClient

client = CalleClient(api_key=os.environ["CALLE_API_KEY"])

call = client.calls.create_and_wait(
    task="Call <+2349064207761> and say: Hello, this is a test call from my Sourcy project. Please say hello back.",
)

print(call)