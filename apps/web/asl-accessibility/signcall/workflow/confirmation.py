"""
The user's go/no-go, asked once: after a clinic slot and an interpreter have
been lined up and before anything is booked.

`run_interpreter_mesh()` takes an `approve` callback, shows it a
`BookingProposal`, and books only if the callback returns True. How the
question reaches the user is the caller's business (see api/server.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


class BookingDeclined(Exception):
    """The user said no to the proposed appointment, or never answered. An
    approval callback may raise this itself to give a more specific reason."""


class NoMatchFound(RuntimeError):
    """The search finished and nobody said yes (no clinic, or no interpreter),
    so there is nothing to book. That is an ordinary outcome, not a failure:
    api/server.py ends the run as "declined" with this message."""


class CancellationUnresolved(RuntimeError):
    """The clinic did not confirm a cancellation, so the appointment may still
    exist. Nobody else is told it is off, and nothing is retried: the person
    has to settle it with the clinic directly."""


class CommitmentUnresolved(RuntimeError):
    """The answer to a binding confirmation is unknown: the call did not
    finish, or it gave no clear yes or no. That is different from a completed,
    explicit "no". The interpreter may or may not be committed, so nothing
    further is done (no other interpreter is called and the clinic booking is
    not cancelled) and the person is told to follow up."""


def explicit_answer(result, key: str = "confirmed") -> bool:
    """The yes or no a completed call gave. Raises CommitmentUnresolved when
    the call did not complete or `key` is not a clear true or false, even if
    an unfinished result happens to carry confirmed=true."""
    answer = result.structured_result.get(key)
    if not result.task_completed or not isinstance(answer, bool):
        raise CommitmentUnresolved("The binding confirmation gave no clear answer.")
    return answer


@dataclass
class BookingProposal:
    """What the user is asked to approve. Plain data, so it serializes as-is."""

    clinic_name: str
    clinic_zipcode: str
    clinic_distance_miles: float | None
    clinic_address: str | None
    date: str  # YYYY-MM-DD
    time: str  # HH:MM, 24-hour
    # Same shape as AppointmentResult.interpreter, e.g. {"tier": "user_arranged"}
    # or {"tier": "freelance", "name", "rate_per_hour", "minimum_hours", ...}.
    interpreter: dict
    # Freelancers who named the same time and take over, cheapest first, if the
    # first one declines the final confirmation. Approving covers them too.
    alternates: list[dict] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)  # what the clinic said is required
    notes: list[str] = field(default_factory=list)  # concerns raised so far, prefixed with who said them


ApprovalFn = Callable[[BookingProposal], bool]
