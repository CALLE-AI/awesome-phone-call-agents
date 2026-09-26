from __future__ import annotations

from app.calls.provider import CallProvider
from app.config import Settings

_provider: CallProvider | None = None


def get_provider(settings: Settings) -> CallProvider:
    global _provider
    if _provider is None:
        _provider = _build(settings)
    return _provider


def set_provider(p: CallProvider | None) -> None:
    global _provider
    _provider = p


def _build(settings: Settings) -> CallProvider:
    if settings.CALL_PROVIDER == "mock":
        from app.calls.mock import MockCallProvider

        return MockCallProvider(delay_s=settings.MOCK_DELAY_S)
    if settings.CALL_PROVIDER == "calle_sdk":
        from app.calls.calle_sdk import CalleSdkProvider

        return CalleSdkProvider(settings)
    from app.calls.calle_mcp import CalleMcpProvider

    return CalleMcpProvider(settings)
