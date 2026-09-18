from __future__ import annotations

from app.config import Settings, get_settings


def settings_dep() -> Settings:
    return get_settings()


def mask(phone: str) -> str:
    return ("*" * max(0, len(phone) - 4)) + phone[-4:] if len(phone) > 4 else "***"
