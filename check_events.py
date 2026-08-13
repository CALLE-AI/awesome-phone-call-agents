import os
import httpx
from dotenv import load_dotenv

load_dotenv(override=True)

API_KEY = os.getenv("CALLE_API_KEY", "").strip()

CALL_ID = "call_64b_7igXoQH27ke7xy8TEw"

BASE_URL = "https://api.heycall-e.com"

headers = {
    "Authorization": f"Bearer {API_KEY}"
}

print("Checking CALL-E lifecycle events...")
print("CALL ID:", CALL_ID)

with httpx.Client(timeout=30.0) as client:

    response = client.get(
        f"{BASE_URL}/v1/calls/{CALL_ID}/events?limit=50",
        headers=headers
    )

    print("HTTP:", response.status_code)
    print("\nEVENTS:")
    print(response.text)

    response.raise_for_status()