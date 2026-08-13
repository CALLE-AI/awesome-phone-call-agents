import os
import time
import httpx
from dotenv import load_dotenv

load_dotenv(override=True)

API_KEY = os.getenv("CALLE_API_KEY", "").strip()

CALL_ID = "call_64b_7igXoQH27ke7xy8TEw"

BASE_URL = "https://api.heycall-e.com"

if not API_KEY:
    raise RuntimeError("CALLE_API_KEY missing")

headers = {
    "Authorization": f"Bearer {API_KEY}"
}

print("Checking existing CALL-E call only...")
print("CALL ID:", CALL_ID)

with httpx.Client(timeout=30.0) as client:

    for i in range(30):

        response = client.get(
            f"{BASE_URL}/v1/calls/{CALL_ID}",
            headers=headers
        )

        print("\nCHECK", i + 1)
        print("HTTP:", response.status_code)

        response.raise_for_status()

        data = response.json()

        status = data.get("status")
        recipients = data.get("recipients", [])

        print("CALL STATUS:", status)

        if recipients:
            print(
                "RECIPIENT STATUS:",
                recipients[0].get("status")
            )

            print(
                "ATTEMPTS:",
                recipients[0].get("attempts")
            )

        if status in {
            "completed",
            "failed",
            "cancelled",
            "canceled"
        }:
            print("\nFINAL RESULT:")
            print(data)
            break

        print("Waiting 10 seconds...")
        time.sleep(10)