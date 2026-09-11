from __future__ import annotations

import json
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.utils.validators import validate_official_calle_origin


class Settings(BaseSettings):
    app_env: Literal["local", "test", "staging", "production"] = "local"
    database_url: str

    calle_api_key: str
    calle_base_url: str = "https://api.heycall-e.com"
    calle_webhook_secret: str | None = None
    calle_webhook_url: str | None = None
    calle_example_phone: str | None = None

    dry_run_default: bool = True
    scheduler_interval_minutes: int = Field(default=1, ge=1, le=1440)

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_minutes: int = Field(default=30, ge=1, le=1440)
    jwt_refresh_ttl_days: int = Field(default=14, ge=1, le=365)
   
    register_secret: str | None = None

    anthropic_api_key: str | None = None
    llm_model: str = "claude-sonnet-4-20250514"
    llm_enabled: bool = True

    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None

    openai_api_key: str | None = None
    agent_enabled: bool = True
    google_api_key: str | None = None
    agent_model: str | None = None

    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]
    )

    trusted_hosts: list[str] = Field(default_factory=lambda: ["*"])
    force_https: bool | None = None
    log_level: str = "INFO"
    enable_scheduler: bool | None = None
    enable_embedding_backfill: bool | None = None
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=10, ge=0, le=50)
    db_pool_timeout: int = Field(default=30, ge=1, le=300)
    db_pool_recycle: int = Field(default=1800, ge=60, le=7200)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"

    @property
    def is_deployed(self) -> bool:
        return self.app_env in {"staging", "production"}

    @property
    def scheduler_enabled(self) -> bool:
        if self.enable_scheduler is not None:
            return self.enable_scheduler
        return not self.is_test

    @property
    def embedding_backfill_enabled(self) -> bool:
        if self.enable_embedding_backfill is not None:
            return self.enable_embedding_backfill
        return not self.is_test

    @property
    def force_https_enabled(self) -> bool:
        if self.force_https is not None:
            return self.force_https
        return self.is_deployed

    @field_validator(
        "calle_webhook_secret",
        "calle_webhook_url",
        "calle_example_phone",
        "anthropic_api_key",
        "twilio_account_sid",
        "twilio_auth_token",
        "twilio_from_number",
        "smtp_host",
        "smtp_port",
        "smtp_username",
        "smtp_password",
        "openai_api_key",
        "google_api_key",
        "agent_model",
        "register_secret",
        mode="before",
    )
    @classmethod
    def empty_str_to_none(cls, value: object) -> object:
        if value == "":
            return None
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if value is None or value == "":
            return ["http://localhost:3000", "http://127.0.0.1:3000"]
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [part.strip() for part in text.split(",") if part.strip()]
        return value

    @field_validator("trusted_hosts", mode="before")
    @classmethod
    def parse_trusted_hosts(cls, value: object) -> object:
        if value is None or value == "":
            return ["*"]
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [part.strip() for part in text.split(",") if part.strip()]
        return value

    @field_validator("calle_base_url", mode="before")
    @classmethod
    def pin_calle_base_url(cls, value: object) -> str:
        if value is None or value == "":
            return validate_official_calle_origin(None)
        return validate_official_calle_origin(str(value))

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().upper() or "INFO"
        return value

    @model_validator(mode="after")
    def validate_for_environment(self) -> Settings:
        errors: list[str] = []

        if not self.database_url.startswith(
            ("postgresql://", "postgresql+psycopg://")
        ):
            errors.append("DATABASE_URL must be a PostgreSQL URL")

        if self.is_deployed:
            if len(self.jwt_secret.strip()) < 32:
                errors.append(
                    "JWT_SECRET must be at least 32 characters in staging/production"
                )

            if not self.register_secret or len(self.register_secret.strip()) < 16:
                errors.append(
                    "REGISTER_SECRET must be at least 16 characters in staging/production"
                )

            if not self.calle_api_key.strip():
                errors.append("CALLE_API_KEY is required in staging/production")

            if self.trusted_hosts == ["*"]:
                errors.append(
                    "TRUSTED_HOSTS must list real hostnames in staging/production "
                    "(do not use *)"
                )

            if not self.calle_webhook_url or not self.calle_webhook_url.startswith(
                "https://"
            ):
                errors.append(
                    "CALLE_WEBHOOK_URL must be a public HTTPS URL in staging/production"
                )

            if self.llm_enabled and not self.anthropic_api_key:
                errors.append(
                    "ANTHROPIC_API_KEY is required when LLM_ENABLED=true"
                )

            if self.agent_enabled and not self.anthropic_api_key:
                errors.append(
                    "ANTHROPIC_API_KEY is required when AGENT_ENABLED=true"
                )

            twilio_fields = (
                self.twilio_account_sid,
                self.twilio_auth_token,
                self.twilio_from_number,
            )
            if any(twilio_fields) and not all(twilio_fields):
                errors.append(
                    "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER "
                    "must all be set when any Twilio setting is provided"
                )

        if errors:
            joined = "; ".join(errors)
            raise ValueError(
                f"Invalid configuration for APP_ENV={self.app_env}: {joined}"
            )

        return self


settings = Settings()
