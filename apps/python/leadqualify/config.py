import os
import logging
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("LeadQualify")

# Configs
CALLE_API_KEY = os.getenv("CALLE_API_KEY", "")
CALLE_BASE_URL = os.getenv("CALLE_BASE_URL", "https://api.heycall-e.com")
CALLE_CALL_RECIPIENT = os.getenv("CALLE_CALL_RECIPIENT", "+12763229632")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./leads.db")
PORT = int(os.getenv("PORT", 8000))
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")
CALL_TIMEOUT_SECONDS = int(os.getenv("CALL_TIMEOUT_SECONDS", 180))

# Agent Configuration
AGENT_NAME = os.getenv("AGENT_NAME", "Sarah")
COMPANY_NAME = os.getenv("COMPANY_NAME", "LeadQualify")

# Flag to run in Mock Mode if no API key is provided
MOCK_MODE = not bool(CALLE_API_KEY)

if MOCK_MODE:
    logger.warning("No CALLE_API_KEY found in environment variables. Starting in MOCK MODE.")
else:
    logger.info("CALLE_API_KEY detected. Initializing live CALL-E integration.")

# SDK Client initialization
calle_client = None
if not MOCK_MODE:
    try:
        from calle import CalleClient
        calle_client = CalleClient(
            api_key=CALLE_API_KEY,
            base_url=CALLE_BASE_URL
        )
    except ImportError:
        logger.error(
            "calle-ai package is not installed. Will fallback to mock calls. "
            "Please run 'pip install calle-ai' to use the live SDK."
        )
        MOCK_MODE = True