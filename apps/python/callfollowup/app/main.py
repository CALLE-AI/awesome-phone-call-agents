from app.models import FollowUp
from app.call_service import CallService


def main():
    follow_up = FollowUp(
        contact_name="Test Contact",
        phone_number="+10000000000",
        call_goal="Follow up about our service",
    )

    print("CallFollowUp ready")
    print(f"Contact: {follow_up.contact_name}")
    print(f"Goal: {follow_up.call_goal}")
    print(f"Status: {follow_up.status}")
    print("Mode: DRY RUN")
    print("No phone call will be made.")


if __name__ == "__main__":
    main()
