"""Privacy / disclosure policy module for the ParcelBridge reference app.

This module is the single source of truth for the privacy
contract that every other module in the package honours. It
exists so that ``workflow.validate_policy()`` can assert against
one canonical list rather than each module re-defining its own
denylist.

The policy has three parts:

1. :data:`BANNED_PAYLOAD_SUBSTRINGS` — the substrings that
   :func:`parcelbridge.payload.build_business_payload` rejects
   in user-supplied fields before constructing the
   :class:`BusinessPayload`.
2. :data:`BANNED_RESPONSE_SUBSTRINGS` — the substrings that
   :func:`parcelbridge.sanitization.sanitize_plan_response`
   rejects as fail-closed secrets.
3. :data:`SIDE_EFFECT_INVENTORY` — the canonical list of side
   effects the offline demo must NOT perform. The defensive
   test suite (see ``tests/test_defensive_invariants.py``)
   asserts each item.

The policy also exposes :func:`validate_policy` which returns
a dict of ``{check_name: passed}`` for self-audit. The CLI's
``validate`` subcommand surfaces this dict to operators.

This module is intentionally small. It must remain a static
data file: no I/O, no network, no subprocesses. It is imported
by every other module so the policy cannot be bypassed by a
lazy ``from parcelbridge import policy; policy = ...`` shim.
"""

from __future__ import annotations

from typing import Dict, Tuple


# Substrings that are forbidden in user-supplied fields. The
# match is case-insensitive (see :func:`_lower_contains`).
BANNED_PAYLOAD_SUBSTRINGS: Tuple[str, ...] = (
    "phone",
    "tel:",
    "e164",
    "card",
    "cvv",
    "iban",
    "ssn",
    "password",
    "secret",
    "bearer ",
    "oauth",
    "token=",
    "address-change",
)

# Substrings that are forbidden in *response* values; if any
# value contains one of these, the sanitizer raises
# :class:`parcelbridge.exceptions.SanitizationViolationError`
# (fail-closed).
BANNED_RESPONSE_SUBSTRINGS: Tuple[str, ...] = (
    "bearer ",
    "bearer\t",
    "oauth",
    "ey",  # JWT-style prefix
    "akia",  # AWS access key prefix
    "-----begin",
)

# Side-effect inventory the offline demo MUST NOT trigger. The
# defensive test suite asserts each invariant below using a
# sandboxed HOME / XDG / TMPDIR plus ``strace`` / ``lsof`` /
# ``psutil`` probes where available.
SIDE_EFFECT_INVENTORY: Tuple[str, ...] = (
    "network_access",  # no outbound TCP/UDP/DNS
    "oauth_cache_read",  # no read of ~/.cache, ~/.config, ~/.local/share, keyring
    "phone_in_argv",  # no E.164 / phone-shaped digit cluster in argv
    "phone_in_environment",  # no PHONE_NUMBER / DIAL_TO / CALL_RECIPIENT env vars
    "phone_in_disk",  # no write of phone-shaped value to disk
    "raw_response_persistence",  # no write of full sanitized response to disk
    "capability_value_persistence",  # no write of capability_values to disk
    "run_call_invocation",  # no function or subprocess named run_call exists
    "real_calls",  # no entry to the dial path of any kind
    "persistent_state_change",  # no write to the user's HOME or system dirs
)


def _lower_contains(haystack: str, needle: str) -> bool:
    """Case-insensitive substring containment check."""
    return needle.lower() in haystack.lower()


def is_payload_banned(value: str) -> bool:
    """Return True if ``value`` contains any banned payload substring."""
    if not isinstance(value, str):
        return False
    return any(_lower_contains(value, token) for token in BANNED_PAYLOAD_SUBSTRINGS)


def is_response_banned(value: str) -> bool:
    """Return True if ``value`` contains any banned response substring."""
    if not isinstance(value, str):
        return False
    return any(_lower_contains(value, token) for token in BANNED_RESPONSE_SUBSTRINGS)


def validate_policy() -> Dict[str, bool]:
    """Return a self-audit dict of the policy module's invariants.

    The CLI's ``validate`` subcommand surfaces this dict so an
    operator can confirm the policy module is well-formed without
    touching the network.
    """

    checks: Dict[str, bool] = {}

    # 1. The banned payload substring list is non-empty.
    checks["payload_substrings_non_empty"] = bool(BANNED_PAYLOAD_SUBSTRINGS)

    # 2. The banned response substring list is non-empty.
    checks["response_substrings_non_empty"] = bool(BANNED_RESPONSE_SUBSTRINGS)

    # 3. The side-effect inventory is non-empty.
    checks["side_effect_inventory_non_empty"] = bool(SIDE_EFFECT_INVENTORY)

    # 4. Every banned payload substring is lower-cased ASCII.
    checks["payload_substrings_are_lowercase"] = all(
        token == token.lower() and token.isascii()
        for token in BANNED_PAYLOAD_SUBSTRINGS
    )

    # 5. Every banned response substring is lower-cased ASCII.
    checks["response_substrings_are_lowercase"] = all(
        token == token.lower() and token.isascii()
        for token in BANNED_RESPONSE_SUBSTRINGS
    )

    # 6. The denied-substring lists do not overlap dangerously
    #    (a substring that is in both lists will be detected
    #    twice; that's fine, but if one list contained a
    #    substring of another, the longer one would shadow the
    #    shorter and the policy would be ambiguous).
    for short in BANNED_RESPONSE_SUBSTRINGS:
        for long in BANNED_RESPONSE_SUBSTRINGS:
            if short is long:
                continue
            if len(short) < len(long) and short in long:
                checks[f"response_substring_overlap:{short}⊂{long}"] = False

    # 7. The side-effect inventory covers all 10 categories from
    #    the spec; the defensive test suite asserts each one.
    expected = {
        "network_access",
        "oauth_cache_read",
        "phone_in_argv",
        "phone_in_environment",
        "phone_in_disk",
        "raw_response_persistence",
        "capability_value_persistence",
        "run_call_invocation",
        "real_calls",
        "persistent_state_change",
    }
    checks["side_effect_inventory_covers_spec"] = set(SIDE_EFFECT_INVENTORY) >= expected

    return checks


__all__ = [
    "BANNED_PAYLOAD_SUBSTRINGS",
    "BANNED_RESPONSE_SUBSTRINGS",
    "SIDE_EFFECT_INVENTORY",
    "is_payload_banned",
    "is_response_banned",
    "validate_policy",
]