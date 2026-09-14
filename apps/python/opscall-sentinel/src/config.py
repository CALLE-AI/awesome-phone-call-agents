from __future__ import annotations

import re
from pathlib import Path
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent


def validate_ascii_e164(phone: str, allow_synthetic: bool = True) -> str:
    """Validate phone string as strictly ASCII E.164 format and gate synthetic defaults."""
    if not phone or not isinstance(phone, str):
        raise ValueError("Phone destination must be a non-empty string.")
    
    clean_phone = phone.strip()
    if not clean_phone.isascii():
        raise ValueError(f"Phone destination '{clean_phone}' contains non-ASCII characters.")
    
    # Strict E.164: + followed by 7 to 15 digits
    pattern = r"^\+[1-9]\d{6,14}$"
    if not re.match(pattern, clean_phone):
        raise ValueError(f"Destination '{clean_phone}' is not a valid ASCII E.164 phone number.")
    
    # Check synthetic default patterns (e.g. 555-0100..0199 or repeated zeros)
    is_synthetic = bool(re.search(r"55501\d{2}$|0000000|1234567", clean_phone))
    if is_synthetic and not allow_synthetic:
        raise ValueError(f"Synthetic default destination '{clean_phone}' is not authorized for live PSTN routing.")
    
    return clean_phone


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

    @field_validator("calle_base_url")
    @classmethod
    def validate_https_base_url(cls, v: str) -> str:
        if not v or not v.startswith("https://"):
            raise ValueError(f"CALLE base URL must use approved HTTPS protocol, received: {v}")
        return v

    @model_validator(mode="after")
    def validate_phone_destinations(self) -> Settings:
        allow_synth = (self.calle_mode != "live")
        self.primary_oncall_phone = validate_ascii_e164(self.primary_oncall_phone, allow_synthetic=allow_synth)
        self.secondary_oncall_phone = validate_ascii_e164(self.secondary_oncall_phone, allow_synthetic=allow_synth)
        return self


settings = Settings()
