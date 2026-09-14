"""Configuration module for SmartRent Maintenance Coordinator."""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CalleConfig:
    """CALL-E API configuration."""
    api_key: str = field(default_factory=lambda: os.environ.get("CALLE_API_KEY", ""))
    base_url: str = field(default_factory=lambda: os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"))
    webhook_url: Optional[str] = field(default_factory=lambda: os.environ.get("CALLE_WEBHOOK_URL"))
    dry_run: bool = field(default_factory=lambda: os.environ.get("DRY_RUN", "true").lower() == "true")
    default_region: str = "US"
    default_locale: str = "en-US"


@dataclass
class AppConfig:
    """Application configuration."""
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    calle: CalleConfig = field(default_factory=CalleConfig)


def get_config() -> AppConfig:
    """Load configuration from environment variables."""
    return AppConfig()
