import os
from dotenv import load_dotenv

load_dotenv()

APP_NAME = "CallFollowUp"
CALLE_API_KEY = os.getenv("CALLE_API_KEY")
