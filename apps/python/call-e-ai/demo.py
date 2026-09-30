"""CALL-E AI: safe, local phone-call workflow demo.

This demo never connects to a telephone network.
"""

import re
from datetime import datetime, timezone


def validate_number(number):
    """Accept an international E.164 phone number containing ASCII digits."""
    return bool(re.fullmatch(r"\+[1-9][0-9]{1,14}", number))


def mask_number(number):
    """Hide all but the final four digits."""
    return "*" * max(0, len(number) - 4) + number[-4:]


def main():
    print("CALL-E AI | Local Demo")
    print("No real phone calls will be made.\n")

    number = input("Enter an authorized E.164 phone number: ").strip()

    if not validate_number(number):
        print("Invalid number. Use E.164 format with ASCII digits.")
        return

    purpose = input("What is the purpose of the call? ").strip()

    if not purpose:
        print("A call purpose is required.")
        return

    consent = input("Are you authorized to contact this destination? (yes/no): ")
    if consent.strip().lower() != "yes":
        print("Cancelled: destination authorization is required.")
        return

    print("\n--- SIMULATED CALL ---")
    print("Number:", mask_number(number))
    print("Purpose:", purpose)
    print("Status: No real call placed")
    print("Time:", datetime.now(timezone.utc).isoformat())
    print("Agent: Hello! This is a simulated CALL-E AI conversation.")
    print("Agent: I understand your request and can help prepare a response.")
    print("Caller: Thank you.")
    print("Agent: You're welcome. Goodbye.")
    print("--- END OF DEMO ---")


if __name__ == "__main__":
    main()
