"""Backwards-compatibility shim for :mod:`parcelbridge.sanitizer`.

The canonical home of the response sanitizer is
:mod:`parcelbridge.sanitization`. This module re-exports the
public surface so existing imports (``from parcelbridge.sanitizer
import sanitize_plan_response, SanitizedResponse, length_fingerprint``)
continue to work after the rename.

New code should import from :mod:`parcelbridge.sanitization`.
"""

from parcelbridge.sanitization import (  # noqa: F401
    SanitizedResponse,
    length_fingerprint,
    sanitize_plan_response,
)

__all__ = [
    "SanitizedResponse",
    "length_fingerprint",
    "sanitize_plan_response",
]