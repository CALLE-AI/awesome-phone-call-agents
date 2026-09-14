import sys

from app.calle.client import client


def main():
    if len(sys.argv) != 2:
        print("Usage:")
        print("python check_call.py <call_id>")
        return

    call_id = sys.argv[1]

    call = client.calls.get(call_id)

    print()
    print("=" * 60)
    print("CALL-E CURRENT STATE")
    print("=" * 60)

    print("ID:", call["id"])
    print("Status:", call["status"])
    print("Created:", call["created_at"])
    print("Completed:", call["completed_at"])

    print()
    print("Structured result:")
    print(call["structured_result"])

    print()
    print("Summary:")
    print(call["summary"])

    print()
    print("Failure:")
    print(call["failure_message"])


if __name__ == "__main__":
    main()