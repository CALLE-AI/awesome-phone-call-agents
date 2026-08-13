import os
import time
import uuid
import httpx
from dotenv import load_dotenv

load_dotenv(override=True)

API_KEY = os.getenv("CALLE_API_KEY", "").strip()
PHONE = os.getenv("JOBRADAR_TEST_PHONE", "").strip()

BASE_URL = "https://api.heycall-e.com"

if not API_KEY:
    raise RuntimeError("CALLE_API_KEY missing from .env")

if not PHONE:
    raise RuntimeError("JOBRADAR_TEST_PHONE missing from .env")

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Idempotency-Key": f"jobradar-{uuid.uuid4()}",
}

payload = {
    "task": (
        "Call the recipient as JobRadar Voice AI. "
        "Speak in Hindi. "
        "Clearly identify yourself as an AI assistant. "
        "Ask permission to continue. "
        "If permission is granted, ask whether they are currently hiring "
        "for a Warehouse Assistant. "
        "If yes, ask for the number of openings, monthly salary range, shift, "
        "skills required, experience required, and joining timeline. "
        "If they are not hiring, record that clearly. "
        "Do not invent or assume any information. "
        "Keep the call short and polite."
    ),
    "recipients": [
        {
            "phones": [PHONE],
            "region": "IN",
            "locale": "hi-IN"
        }
    ]
}

print("======================================")
print("JobRadar Voice - Direct CALL-E Test")
print("======================================")
print("API KEY FOUND:", bool(API_KEY))
print("PHONE FOUND:", bool(PHONE))
print("\n1. Creating real CALL-E call...")

try:
    with httpx.Client(timeout=30.0) as client:

        response = client.post(
            f"{BASE_URL}/v1/calls",
            headers=headers,
            json=payload
        )

        print("\nHTTP STATUS:", response.status_code)
        print("CREATE RESPONSE:")
        print(response.text)

        response.raise_for_status()

        data = response.json()

        call_id = (
            data.get("call_id")
            or data.get("id")
        )

        if not call_id:
            print("\nCall request accepted, but no call_id found.")
            print("Full response:")
            print(data)
            raise RuntimeError("CALL-E returned no call_id.")

        print("\n✅ CALL CREATED")
        print("CALL ID:", call_id)
        print("\nYour phone should receive the CALL-E call shortly.")

        print("\nWaiting 15 seconds before first status check...")
        time.sleep(15)

        for i in range(18):

            print(f"\nSTATUS CHECK {i + 1}...")

            status_response = client.get(
                f"{BASE_URL}/v1/calls/{call_id}",
                headers={
                    "Authorization": f"Bearer {API_KEY}"
                },
                timeout=30.0
            )

            print("STATUS HTTP:", status_response.status_code)
            print(status_response.text)

            status_response.raise_for_status()

            result = status_response.json()

            status = (
                result.get("status")
                or result.get("state")
                or ""
            ).lower()

            if status in {
                "completed",
                "complete",
                "failed",
                "cancelled",
                "canceled"
            }:
                print("\n======================================")
                print("FINAL CALL RESULT")
                print("======================================")
                print(result)
                break

            print("Call still running...")
            time.sleep(10)

        else:
            print(
                "\nCall is still pending after polling. "
                "Do not create another call until you verify this call's status."
            )

except httpx.HTTPStatusError as e:
    print("\n❌ CALL-E HTTP ERROR")
    print("STATUS:", e.response.status_code)
    print("RESPONSE:", e.response.text)

except httpx.RequestError as e:
    print("\n❌ NETWORK ERROR")
    print(str(e))

except Exception as e:
    print("\n❌ ERROR")
    print(type(e).__name__)
    print(str(e))