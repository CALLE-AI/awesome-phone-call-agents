import os
from dotenv import load_dotenv
from calle import CalleClient

load_dotenv(override=True)

client = CalleClient(
    api_key=os.getenv("CALLE_API_KEY")
)

call = client.calls.create_and_wait(
    task=(
        "Call +916386351022. "
        "This is an authorized test call. "
        "Speak in Hindi. "
        "Introduce yourself as JobRadar Voice AI. "
        "Ask if they can hear you clearly, then end the call politely."
    )
)

print(call)