"""
create_test_patient.py

Creates ONE synthetic, clearly-fake test patient on the public HAPI FHIR
test server (https://hapi.fhir.org/baseR4) for SentinelCall demo purposes.

This is NOT real patient data and must never be. Do not adapt this script
to point at a real hospital FHIR server or insert any real person's
identifying details.
"""

import httpx
import asyncio

FHIR_BASE = "https://hapi.fhir.org/baseR4"

# Deliberately fake, obviously-synthetic demo patient.
TEST_PATIENT = {
    "resourceType": "Patient",
    "active": True,
    "name": [{"use": "official", "given": ["SentinelCall"], "family": "DemoPatient"}],
    "gender": "female",
    "birthDate": "1998-04-12",
    "address": [{
        "line": ["Demo Address - Not Real"],
        "city": "Demo City",
        "country": "Test",
    }],
}


async def create_test_patient():
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{FHIR_BASE}/Patient",
            json=TEST_PATIENT,
            headers={"Content-Type": "application/fhir+json", "Accept": "application/fhir+json"},
        )
        response.raise_for_status()
        data = response.json()
        print(f"Created test patient. FHIR Patient ID: {data.get('id')}")
        print(f"Full resource URL: {FHIR_BASE}/Patient/{data.get('id')}")
        return data.get("id")


if __name__ == "__main__":
    asyncio.run(create_test_patient())