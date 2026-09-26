"""Response sanitization module (canonical name).

This module is the canonical home of the response sanitizer;
the older ``parcelbridge.sanitizer`` module is a thin
re-export shim kept for backwards compatibility with the
original prototype's import path.

The sanitizer walks a synthetic (or, in a future live
integration, real) ``plan_call`` response and produces a
:class:`SanitizedResponse` that contains **only** what is
safe to surface:

* boolean presence flags (``ready_to_run``, etc.),
* length-only fingerprints for any string value that could
  carry a secret (token-shaped, credential-shaped,
  identifier-shaped),
* the value of enumerated keys that the integrator
  explicitly names as safe (here: ``bridge_mode``,
  ``scenario``).

The sanitizer is **fail-closed**: any value it does not
recognise is replaced with an opaque length record
(``{_opaque: True, length: N}``). Any value shaped like a
secret (substring match) raises
:class:`~parcelbridge.exceptions.SanitizationViolationError`
rather than being silently leaked.

The canonical policy constants live in
:mod:`parcelbridge.policy` and are imported here so this
module's denylist cannot drift from the policy module's
denylist.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Mapping

from parcelbridge.exceptions import SanitizationViolationError
from parcelbridge.policy import BANNED_RESPONSE_SUBSTRINGS


# Field names whose scalar values are safe to surface verbatim.
# Anything not in this allow-list is replaced by a length record.
_SAFE_TOP_LEVEL_FIELDS = frozenset(
    {
        "bridge_mode",
        "scenario",
        "ready_to_run",
    }
)

# Field names whose scalar values are explicitly redacted to a
# length-only fingerprint. These are the field names that would
# carry the upstream SDK's capability values.
_REDACTED_CAPABILITY_FIELDS = frozenset(
    {
        "confirm_token",
        "plan_id",
        "run_id",
        "api_key",
        "authorization",
        "token",
        "refresh_token",
        "secret",
        "cookie",
        "password",
        "credential",
    }
)


@dataclass(frozen=True)
class SanitizedResponse:
    """A redacted, length-only representation of a plan_call response.

    Attributes
    ----------
    presence:
        Mapping of safe top-level boolean / enumerated fields and
        their surfaced values.
    fingerprints:
        Mapping of redacted capability fields to their
        length-only fingerprints (integer lengths).
    opaque:
        Mapping of unrecognised fields to their opaque length
        records.
    raw_response_shape_keys:
        Tuple of keys that appeared in the original response,
        in iteration order. The values themselves are not
        preserved.
    """

    presence: Dict[str, Any] = field(default_factory=dict)
    fingerprints: Dict[str, int] = field(default_factory=dict)
    opaque: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    raw_response_shape_keys: tuple = field(default_factory=tuple)

    def to_dict(self) -> dict:
        """Return a JSON-serialisable dict representation."""
        return {
            "presence": dict(self.presence),
            "fingerprints": dict(self.fingerprints),
            "opaque": {k: dict(v) for k, v in self.opaque.items()},
            "raw_response_shape_keys": list(self.raw_response_shape_keys),
        }


def length_fingerprint(value: Any) -> int:
    """Return the length fingerprint of a value.

    For strings, returns the number of characters. For
    mappings, returns the number of keys. For sequences,
    returns the number of items. For ``None``, returns zero.
    For other types, returns the length of the ``repr`` of
    the value.
    """

    if value is None:
        return 0
    if isinstance(value, str):
        return len(value)
    if isinstance(value, (list, tuple)):
        return len(value)
    if isinstance(value, Mapping):
        return len(value)
    return len(repr(value))


def _is_secret_like(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    lowered = value.lower()
    return any(token in lowered for token in BANNED_RESPONSE_SUBSTRINGS)


def sanitize_plan_response(raw_response: Mapping[str, Any]) -> SanitizedResponse:
    """Walk ``raw_response`` and return a :class:`SanitizedResponse`.

    Parameters
    ----------
    raw_response:
        The full plan_call response shape (synthetic in offline
        mode; would be the upstream SDK's response in a live
        integration that this reference app does not ship).

    Returns
    -------
    SanitizedResponse
        The redacted, length-only representation.

    Raises
    ------
    SanitizationViolationError
        If any value in the response looks secret-shaped (e.g.
        contains ``"bearer "`` or a JWT-style prefix). The error
        is raised **before** the offending value is surfaced.
    """

    presence: Dict[str, Any] = {}
    fingerprints: Dict[str, int] = {}
    opaque: Dict[str, Dict[str, Any]] = {}
    shape_keys: list = []

    for key, value in raw_response.items():
        shape_keys.append(key)

        # Hard fail on secret-shaped values, even if the key is
        # not in the redact list. This is the fail-closed
        # defence: a defensive integrator should reject the
        # response rather than risk leaking a value the key
        # allow-list forgot.
        if _is_secret_like(value):
            raise SanitizationViolationError(
                f"response field {key!r} contains a secret-shaped "
                f"value; refusing to surface the response."
            )

        if key in _SAFE_TOP_LEVEL_FIELDS:
            presence[key] = value
        elif key in _REDACTED_CAPABILITY_FIELDS:
            fingerprints[key] = length_fingerprint(value)
        elif key == "capability_values" and isinstance(value, Mapping):
            for sub_key, sub_value in value.items():
                if _is_secret_like(sub_value):
                    raise SanitizationViolationError(
                        f"capability_values.{sub_key!r} contains a "
                        f"secret-shaped value; refusing to surface "
                        f"the response."
                    )
                fingerprints[sub_key] = length_fingerprint(sub_value)
        else:
            opaque[key] = {
                "_opaque": True,
                "length": length_fingerprint(value),
            }

    return SanitizedResponse(
        presence=presence,
        fingerprints=fingerprints,
        opaque=opaque,
        raw_response_shape_keys=tuple(shape_keys),
    )


__all__ = [
    "SanitizedResponse",
    "length_fingerprint",
    "sanitize_plan_response",
]