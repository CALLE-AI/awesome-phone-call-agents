"""Environment-bound settings. Mock mode needs no secrets; live mode fails closed."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Runtime configuration loaded from the environment."""

    mode: str = "mock"
    calle_api_key: str = ""
    calle_base_url: str = "https://api.heycall-e.com"
    api_port: int = 8001
    mock_port: int = 8788
    log_level: str = "info"

    def __post_init__(self) -> None:
        if self.is_live and not self.calle_api_key:
            raise RuntimeError(
                "CALL_E_MODE=live requires CALLE_API_KEY; refusing to boot live "
                "without credentials (fail-closed)."
            )

    @property
    def is_live(self) -> bool:
        """Whether this process may touch the real CALL-E API."""
        return self.mode.strip().lower() == "live"


def load_settings(env: dict[str, str] | None = None) -> Settings:
    """Build settings from the environment (injectable mapping for tests)."""
    source = env if env is not None else os.environ
    settings = Settings(
        mode=source.get("CALL_E_MODE", "mock"),
        calle_api_key=source.get("CALLE_API_KEY", ""),
        calle_base_url=source.get("CALLE_BASE_URL", "https://api.heycall-e.com"),
        api_port=int(source.get("API_PORT", "8001")),
        mock_port=int(source.get("MOCK_PORT", "8788")),
        log_level=source.get("LOG_LEVEL", "info"),
    )
    return settings
