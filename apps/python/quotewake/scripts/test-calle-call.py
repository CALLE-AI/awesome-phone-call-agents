"""Place one CALL-E audio check call."""

import argparse
import os
from pathlib import Path

from calle import CalleClient
from dotenv import load_dotenv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phone", help="Authorized destination in E.164 format")
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise SystemExit("CALLE_API_KEY is missing from .env")

    client = CalleClient(api_key=api_key)
    call = client.calls.create_and_wait(
        task=f"Call {args.phone} and ask whether they can hear clearly.",
        result_schema={
            "type": "object",
            "required": ["can_hear_clearly"],
            "properties": {
                "can_hear_clearly": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                }
            },
        },
    )

    print(call["status"])
    print(call["structured_result"])


if __name__ == "__main__":
    main()
