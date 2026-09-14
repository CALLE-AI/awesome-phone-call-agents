from app.calle.client import client
from app.calle.tasks import (
    WALK_ME_HOME_TASK,
    WALK_ME_HOME_RESULT_SCHEMA,
)


PHONE_NUMBER = "+918527067677"


def main():
    print("Creating CALL-E call...")

    call = client.calls.create(
        task=f"""
{WALK_ME_HOME_TASK}

Call this phone number:

{PHONE_NUMBER}
""",
        result_schema=WALK_ME_HOME_RESULT_SCHEMA,
    )

    print()
    print("=" * 50)
    print("CALL CREATED")
    print("=" * 50)

    print("Call ID:", call["id"])
    print("Status:", call["status"])


if __name__ == "__main__":
    main()