from __future__ import annotations

import os
from dataclasses import dataclass


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
            webhook_secret=os.getenv("CALLPROOF_WEBHOOK_SECRET", "development-secret"),
            deliver_webhooks=os.getenv("CALL_ANALYZER_DELIVER_WEBHOOKS", "true").lower()
            not in {"0", "false", "no"},
            queue_mode=os.getenv("CALL_ANALYZER_QUEUE_MODE", "inline"),
            redis_url=os.getenv("REDIS_URL"),
            queue_name=os.getenv("CALL_ANALYZER_QUEUE_NAME", "callproof"),
        )
