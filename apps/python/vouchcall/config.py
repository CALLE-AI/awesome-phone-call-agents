import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

CALLE_API_KEY = os.environ.get("CALLE_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
ENCRYPTION_KEY = os.environ.get("VOUCHCALL_ENCRYPTION_KEY", "")


def require_keys(*names):
    missing = [n for n in names if not globals().get(n)]
    if missing:
        raise SystemExit(f"Missing env vars: {', '.join(missing)}. See .env.example")


def validate_e164(phone: str) -> str:
    import re
    cleaned = re.sub(r"[\s\-\(\)]", "", phone)
    if not re.fullmatch(r"\+[1-9]\d{6,14}", cleaned):
        raise ValueError(f"Invalid E.164 phone number: {mask_phone(phone)}")
    return cleaned


def sanitize_name(name: str, max_len: int = 100) -> str:
    import re
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return cleaned[:max_len]


def mask_phone(phone: str) -> str:
    if len(phone) > 4:
        return "*" * (len(phone) - 4) + phone[-4:]
    return "****"


def encrypt_field(value: str) -> str:
    if not ENCRYPTION_KEY or not value:
        return value
    from cryptography.fernet import Fernet
    f = Fernet(ENCRYPTION_KEY.encode())
    return f.encrypt(value.encode()).decode()


def decrypt_field(value: str) -> str:
    if not ENCRYPTION_KEY or not value:
        return value
    from cryptography.fernet import Fernet, InvalidToken
    f = Fernet(ENCRYPTION_KEY.encode())
    try:
        return f.decrypt(value.encode()).decode()
    except (InvalidToken, Exception):
        return ""


GEMINI_MODEL = "gemini-3.5-flash"
DB_PATH = Path(__file__).resolve().parent / "vouchcall.db"

DIMENSIONS = [
    "collaboration",
    "technical_ability",
    "reliability",
    "communication",
    "leadership",
]

MIN_TRANSCRIPT_TURNS = 6
MIN_QUESTIONS_ANSWERED = 3
