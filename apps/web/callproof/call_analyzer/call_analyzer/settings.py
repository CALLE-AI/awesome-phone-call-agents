from __future__ import annotations

import os
from dataclasses import dataclass

# The signing secret has no default outside development. Falling back to a constant that
# lives in this repository would mean a deployment that simply forgot the variable still
# signs webhooks — with a value anyone can read here. Rails already refuses a blank
# secret on the receiving end; this makes the sending end refuse to start instead of
# quietly signing with something public.
DEVELOPMENT_ONLY_SECRET = "development-secret"


class MissingWebhookSecret(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    database_path: str
    webhook_secret: str
    deliver_webhooks: bool
    queue_mode: str = "inline"
    redis_url: str | None = None
    queue_name: str = "callproof"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_path=os.getenv("CALL_ANALYZER_DATABASE_PATH", "call_analyzer.db"),
            webhook_secret=cls._webhook_secret(),
            deliver_webhooks=os.getenv("CALL_ANALYZER_DELIVER_WEBHOOKS", "true").lower()
            not in {"0", "false", "no"},
            queue_mode=os.getenv("CALL_ANALYZER_QUEUE_MODE", "inline"),
            redis_url=os.getenv("REDIS_URL"),
            queue_name=os.getenv("CALL_ANALYZER_QUEUE_NAME", "callproof"),
        )

    @staticmethod
    def _webhook_secret() -> str:
        secret = os.getenv("CALLPROOF_WEBHOOK_SECRET")
        if secret:
            return secret

        environment = os.getenv("CALL_ANALYZER_ENV", "development").lower()
        if environment in {"development", "test"}:
            return DEVELOPMENT_ONLY_SECRET

        raise MissingWebhookSecret(
            "CALLPROOF_WEBHOOK_SECRET is required when CALL_ANALYZER_ENV is "
            f"'{environment}'. Refusing to sign webhooks with the development default, "
            "which is a public constant in this repository."
        )
