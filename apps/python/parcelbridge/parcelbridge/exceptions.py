"""Domain errors raised by the ParcelBridge reference app.

All exceptions inherit from :class:`ParcelBridgeError` so that callers
can catch the family in one place. The errors are deliberately
distinct so that an integrator who wires this app into a larger
system can choose which failures to handle and which to propagate.
"""

from __future__ import annotations


class ParcelBridgeError(Exception):
    """Base class for every error raised by this package."""


class LiveModeRefusedError(ParcelBridgeError):
    """Raised when an attempted live mode is refused by design.

    The reference app's live-mode entry point prints a refusal message
    rather than executing any dial path. Raising this exception is
    how the library surfaces that refusal to programmatic callers.
    """


class ArgumentViolationError(ParcelBridgeError):
    """Raised when a CLI argument or payload field violates the
    refusal-first contract.

    Examples include:

    * a phone-number-like value appearing in a payload field,
    * a non-whitelisted CLI flag,
    * a secret-shaped string (``Bearer ...``, ``token=...``) in any
      printable context.
    """


class SanitizationViolationError(ParcelBridgeError):
    """Raised when the sanitizer cannot safely redact a response field.

    A sanitization violation is **not** a "leak the value anyway"
    signal. It is a hard failure: the caller must treat the response
    as untrusted and refuse to surface the violating field.
    """