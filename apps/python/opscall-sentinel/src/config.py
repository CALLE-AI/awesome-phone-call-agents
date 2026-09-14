from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    calle_api_key: str = ""
    calle_mode: str = "mock"  # "mock" (offline zero-credit fixture) or "live" (real phone call)
    calle_base_url: str = "https://api.heycall-e.com/v1"
    
    primary_oncall_phone: str = "+15555550100"
    secondary_oncall_phone: str = "+15555550101"
    oncall_security_pin: str = "4829"
    
    host: str = "127.0.0.1"
    port: int = 8000
    
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
