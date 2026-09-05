"""Environment/settings handling. Zero-key demo mode by default."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_TRUTHY = {"1", "true", "yes", "on"}


def _load_dotenv(path: Path) -> None:
    """Tiny .env loader (KEY=VALUE lines); never overrides real env vars."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def _flag(name: str) -> bool | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in _TRUTHY


@dataclass(frozen=True)
class Settings:
    demo: bool
    fast: bool
    api_key: str | None
    base_url: str
    home: Path  # state dir for trip state + incident reports


def get_settings(cwd: Path | None = None) -> Settings:
    root = Path(cwd) if cwd else Path.cwd()
    _load_dotenv(root / ".env")

    api_key = os.environ.get("CALLE_API_KEY", "").strip() or None
    demo_flag = _flag("FIELDLINE_DEMO")
    # Demo mode when explicitly requested, or when there is no API key.
    demo = demo_flag if demo_flag is not None else api_key is None

    return Settings(
        demo=demo,
        fast=_flag("FIELDLINE_FAST") or False,
        api_key=api_key,
        base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"),
        home=Path(os.environ.get("FIELDLINE_HOME", root / ".fieldline")),
    )
