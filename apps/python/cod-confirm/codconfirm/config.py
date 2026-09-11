"""Runtime configuration, read once from the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    api_key: str
    store_name: str
    currency: str
    max_attempts: int
    call_timeout_seconds: float
    demo_phone: str

    @classmethod
    def from_env(cls) -> "Settings":
        api_key = os.environ.get("CALLE_API_KEY", "")
        return cls(
            api_key=api_key,
            store_name=os.environ.get("STORE_NAME", "Nokshi Home"),
            currency=os.environ.get("STORE_CURRENCY", "BDT"),
            max_attempts=int(os.environ.get("MAX_CALL_ATTEMPTS", "2")),
            call_timeout_seconds=float(os.environ.get("CALL_TIMEOUT_SECONDS", "300")),
            demo_phone=os.environ.get("DEMO_PHONE", ""),
        )
