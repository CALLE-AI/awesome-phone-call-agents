import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

CALLE_API_KEY = os.environ.get("CALLE_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

if not CALLE_API_KEY:
    raise SystemExit("CALLE_API_KEY not set in .env")
if not GEMINI_API_KEY:
    raise SystemExit("GEMINI_API_KEY not set in .env")
GEMINI_MODEL = "gemini-3.5-flash"
DB_PATH = Path(__file__).resolve().parent / "vouchcall.db"

DIMENSIONS = [
    "collaboration",
    "technical_ability",
    "reliability",
    "communication",
    "leadership",
]
