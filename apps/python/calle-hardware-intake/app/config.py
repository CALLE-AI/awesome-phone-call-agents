"""Environment & API configuration (loaded from .env)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Google AI Studio key -> https://aistudio.google.com/apikey
    gemini_api_key: str = ""
    # Newer models are retired for new accounts; use the -latest alias.
    gemini_model: str = "gemini-flash-latest"

    # Shared secret required to plan/run live calls (X-API-Key header).
    # Live-call endpoints fail closed when this is empty.
    api_key: str = ""

    # SQLite file created next to the app.
    database_url: str = "sqlite:///./calle_agent.db"

    # CALL-E is driven through the `calle` CLI (installed via npm, authed
    # via `calle auth login`). OAuth, not an API key.
    calle_cli: str = "calle"

    # How long to poll a running call before giving up (seconds).
    call_poll_timeout: int = 600


settings = Settings()
