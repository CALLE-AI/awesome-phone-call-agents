"""App-only configuration; never load credentials from sibling projects."""
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    db_path: str = "var/estate.sqlite3"
    analysis_mode: str = "replay"
    preview_only: bool = True
    doubao_analysis_authorized: bool = False
    doubao_key: str = ""
    doubao_model: str = ""
    doubao_base: str = "https://ark.cn-beijing.volces.com/api/v3"
    enable_live: bool = False
    calle_key: str = ""
    live_phone: str = ""
    live_locale: str = ""

    @classmethod
    def from_env(cls):
        # Only this app's .env is read, and only when it actually exists.
        app_root = Path(__file__).resolve().parents[2]
        if (app_root / ".env").is_file():
            from dotenv import load_dotenv
            load_dotenv(app_root / ".env", override=False)
        return cls(
            db_path=os.getenv("ESTATE_DB", str(app_root / "var/estate.sqlite3")),
            analysis_mode=os.getenv("ESTATE_ANALYSIS_MODE", "doubao"),
            doubao_analysis_authorized=os.getenv('ESTATE_DOUBAO_ANALYSIS_AUTHORIZED','false').lower()=='true',
            doubao_key=os.getenv("DOUBAO_API_KEY", ""),
            doubao_model=os.getenv("DOUBAO_MODEL", ""),
            doubao_base=os.getenv("DOUBAO_BASE_URL", cls.doubao_base),
            enable_live=os.getenv("ESTATE_ENABLE_LIVE", "false").lower() == "true",
            calle_key=os.getenv("CALLE_API_KEY", ""),
            live_phone=os.getenv("ESTATE_LIVE_PHONE", ""),
            live_locale=os.getenv("ESTATE_LIVE_LOCALE", ""))
