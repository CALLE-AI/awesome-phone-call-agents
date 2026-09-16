"""AccessLine provider exceptions."""


class CallEUnavailable(Exception):
    """Raised when a real CALL-E provider is unavailable or unauthorized."""
