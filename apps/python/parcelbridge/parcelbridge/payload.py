"""Business-payload builder for the ParcelBridge reference app.

The payload is the structured description of a delivery exception.
It is intentionally **business-only**: it names what the agent is
allowed to discuss with the recipient and which deliverable targets
exist. It does **not** include:

* phone numbers (the recipient's number is held in a separate
  sandbox file outside this public bundle, and never reaches the
  payload builder),
* payment, credential, or address-change fields (these are
  forbidden by the offline interceptor and would be rejected even
  if they were present),
* OAuth tokens, plan IDs, confirm tokens, or run IDs (these are
  produced by the provider, not the caller, and only appear in the
  sanitized response — never in the request payload).

The :func:`build_business_payload` function is the only public entry
point. The output is a frozen :class:`BusinessPayload` dataclass so
that no caller can mutate the payload after construction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import FrozenSet, Mapping

from parcelbridge.exceptions import ArgumentViolationError


# A canonical set of business scenarios. The CLI accepts any string
# from this set; unknown scenarios raise ArgumentViolationError.
SCENARIOS: FrozenSet[str] = frozenset(
    {
        "gate-code-failure",
        "recipient-unavailable",
        "neighbor-delegation",
        "building-access-failed",
        "unsupported-address-change",
    }
)


# Forbidden substrings. Any payload value that contains any of these
# tokens (case-insensitive) is rejected. The list is small and
# explicit so the contract is auditable.
_FORBIDDEN_SUBSTRINGS: FrozenSet[str] = frozenset(
    {
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
    }
)


@dataclass(frozen=True)
class BusinessPayload:
    """The structured business payload sent to the plan_call tool.

    Attributes
    ----------
    scenario:
        One of the values in :data:`SCENARIOS`.
    language:
        BCP-47 language tag (e.g. ``"en-US"``).
    region:
        ISO 3166-1 alpha-2 region code (e.g. ``"US"``).
    deliverable_targets:
        A tuple of high-level capabilities the agent may exercise.
        Must not contain any payment, credential, or address-change
        targets.
    notes:
        Optional business notes; must not contain phone numbers,
        secrets, or any forbidden substrings.
    """

    scenario: str
    language: str
    region: str
    deliverable_targets: tuple = field(default_factory=tuple)
    notes: str = ""

    def to_dict(self) -> dict:
        """Return a JSON-serialisable dict representation."""
        return {
            "scenario": self.scenario,
            "language": self.language,
            "region": self.region,
            "deliverable_targets": list(self.deliverable_targets),
            "notes": self.notes,
        }


def _validate_text(value: str, *, field_name: str) -> None:
    lowered = value.lower()
    for forbidden in _FORBIDDEN_SUBSTRINGS:
        if forbidden in lowered:
            raise ArgumentViolationError(
                f"{field_name} contains forbidden substring {forbidden!r}; "
                f"refusing to build payload."
            )


def build_business_payload(
    scenario: str,
    *,
    language: str = "en-US",
    region: str = "US",
    deliverable_targets: Mapping[str, object] | None = None,
    notes: str = "",
) -> BusinessPayload:
    """Build a frozen :class:`BusinessPayload` from primitive inputs.

    Parameters
    ----------
    scenario:
        One of the values in :data:`SCENARIOS`.
    language:
        BCP-47 language tag. Defaults to ``"en-US"``.
    region:
        ISO 3166-1 alpha-2 region code. Defaults to ``"US"``.
    deliverable_targets:
        Optional mapping of high-level capabilities. The values are
        coerced to a tuple of strings.
    notes:
        Optional business notes. Must not contain phone numbers,
        secrets, or any forbidden substrings.

    Raises
    ------
    ArgumentViolationError
        If ``scenario`` is not in :data:`SCENARIOS`, or if any text
        field contains a forbidden substring.
    """

    if scenario not in SCENARIOS:
        raise ArgumentViolationError(
            f"unknown scenario {scenario!r}; "
            f"expected one of {sorted(SCENARIOS)!r}."
        )

    _validate_text(language, field_name="language")
    _validate_text(region, field_name="region")
    _validate_text(notes, field_name="notes")

    targets: tuple = ()
    if deliverable_targets is not None:
        targets = tuple(str(t) for t in deliverable_targets)
        for t in targets:
            _validate_text(t, field_name="deliverable_targets")

    return BusinessPayload(
        scenario=scenario,
        language=language,
        region=region,
        deliverable_targets=targets,
        notes=notes,
    )