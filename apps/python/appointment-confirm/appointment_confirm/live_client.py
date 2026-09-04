"""Live CALL-E client. Imports calle-ai at execute time only."""

from __future__ import annotations

from typing import Any

from . import TRUSTED_BASE_URL


def validate_trusted_base_url(base_url: str) -> str:
    value = (base_url or "").strip().rstrip("/")
    if value != TRUSTED_BASE_URL:
        raise ValueError(
            f"base URL must be {TRUSTED_BASE_URL} (got {base_url!r}). "
            "Refusing to send CALLE_API_KEY to any other origin."
        )
    return value


class LiveCalleClient:
    """Thin wrapper so tests can swap in a fake with the same create_and_wait."""

    def __init__(self, api_key: str, base_url: str = TRUSTED_BASE_URL):
        if not api_key or not api_key.strip():
            raise ValueError("CALLE_API_KEY is required for live calls")
        if api_key.strip().startswith("calle_test") and "example" in api_key:
            raise ValueError("refusing a placeholder API key")
        self.base_url = validate_trusted_base_url(base_url)
        try:
            from calle import CalleClient
        except ImportError as exc:
            raise RuntimeError(
                "Live mode needs the official Python SDK: pip install 'calle-ai>=0.7.0'. "
                "The import name is `calle`. Without a key, use --mock instead."
            ) from exc
        self._client = CalleClient(api_key=api_key.strip(), base_url=self.base_url)

    def create_and_wait(self, **kwargs: Any) -> dict[str, Any]:
        return self._client.calls.create_and_wait(**kwargs)
