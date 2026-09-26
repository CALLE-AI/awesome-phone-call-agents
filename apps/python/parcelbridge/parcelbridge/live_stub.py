"""Live-mode stub for the ParcelBridge reference app.

This module exists to make the omission explicit. When a reviewer
runs the CLI with ``--live-stub``, this module prints a refusal
message and exits. It does **not**:

* import the official client SDK,
* open a network socket,
* read an OAuth cache or credential file,
* contain a partial implementation of the dial path,
* carry a phone-number placeholder.

The live-mode stub is the public counterpart of the
``AUTHORIZATION_ALREADY_CONSUMED`` /
``RUN_CALL_NOT_PERMITTED`` gates in the originating prototype. It
is a refusal, not a partial implementation.
"""

from __future__ import annotations

from dataclasses import dataclass

from parcelbridge.exceptions import LiveModeRefusedError


_REFUSAL_MESSAGE = """\
[parcelbridge] LIVE MODE IS A DOCUMENTATION STUB.
[parcelbridge] This reference app does NOT contact a real endpoint.
[parcelbridge] To enable a real dial path, the upstream SDK must be
[parcelbridge] installed and an explicit authorization flow added
[parcelbridge] by the integrator. ParcelBridge does not include that
[parcelbridge] code path; the dial path is omitted by design.
"""


@dataclass(frozen=True)
class LiveStubResult:
    """Result of a live-stub invocation.

    Attributes
    ----------
    refused:
        Always ``True``.
    message:
        The refusal message printed to the operator.
    outcome:
        Always ``"STUB_NOT_EXECUTED"``.
    """

    refused: bool
    message: str
    outcome: str


def run_live_stub_plan_call() -> LiveStubResult:
    """Return the live-mode refusal message without executing anything.

    The function does not raise; it returns a
    :class:`LiveStubResult` so that programmatic callers can
    inspect the refusal. The CLI prints the message and exits
    with a non-zero status.

    For callers who prefer an exception, see
    :func:`raise_live_mode_refused`.
    """

    return LiveStubResult(
        refused=True,
        message=_REFUSAL_MESSAGE,
        outcome="STUB_NOT_EXECUTED",
    )


def raise_live_mode_refused() -> None:
    """Raise :class:`LiveModeRefusedError` with the refusal message."""

    raise LiveModeRefusedError(_REFUSAL_MESSAGE)


__all__ = [
    "LiveStubResult",
    "run_live_stub_plan_call",
    "raise_live_mode_refused",
]