import os
from dataclasses import dataclass
from typing import Optional


class ConfigError(Exception):
    pass


@dataclass
class CalleConfig:
    api_key: str
    base_url: Optional[str] = None


def load_calle_config() -> CalleConfig:
    api_key = os.environ.get("CALLE_API_KEY")
    base_url = os.environ.get("CALLE_BASE_URL") or os.environ.get("CALLE_API_BASE_URL")

    if not api_key:
        raise ConfigError("CALLE_API_KEY is not set")

    if base_url:
        base_url = base_url.rstrip("/")

    return CalleConfig(api_key=api_key, base_url=base_url)
