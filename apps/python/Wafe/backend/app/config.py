import os

from dotenv import load_dotenv


load_dotenv()


CALLE_API_KEY = os.getenv("CALLE_API_KEY")
EMERGENCY_CONTACT = os.getenv("EMERGENCY_CONTACT")


if not CALLE_API_KEY:
    raise RuntimeError(
        "CALLE_API_KEY is missing from backend/.env"
    )


if not EMERGENCY_CONTACT:
    raise RuntimeError(
        "EMERGENCY_CONTACT is missing from backend/.env"
    )