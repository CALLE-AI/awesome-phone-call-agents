"""Cross-check against a death register.

Death data is used aggressively to stop paying people and lazily to start
paying them. A register entry can stop a pension in days; a person the register
has wrongly recorded as dead has, in practice, no channel to argue.

Muster reads the register in both directions. When the register says deceased
and a call confirms a live human who passes the challenges, that is not a pass
to be filed quietly -- it is a contradiction, and the correction belongs to the
register, not to the person.

The register is treated as a claim, exactly like a relative's claim. It is
never treated as fact.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from .models import Attestation, Grade


class RegisterStatus(str, Enum):
    ALIVE = "alive"
    DECEASED = "deceased"
    UNKNOWN = "unknown"


class Reconciliation(str, Enum):
    AGREED_ALIVE = "AGREED_ALIVE"
    REGISTER_CONTRADICTED = "REGISTER_CONTRADICTED"
    REGISTER_UNCORROBORATED = "REGISTER_UNCORROBORATED"
    CALL_SUPPORTS_REGISTER = "CALL_SUPPORTS_REGISTER"
    NO_SIGNAL = "NO_SIGNAL"


@dataclass(frozen=True)
class RegisterEntry:
    subject_id: str
    status: RegisterStatus
    recorded_on: date | None = None
    source: str = "national death register (demo feed)"


@dataclass(frozen=True)
class Reconciled:
    outcome: Reconciliation
    reasons: tuple[str, ...]
    opens_correction_case: bool = False

    @property
    def stops_payment(self) -> bool:
        """Nothing here stops a payment either. Not even a register entry."""
        return False


def reconcile(attestation: Attestation, entry: RegisterEntry | None) -> Reconciled:
    """Compare what the call established with what the register asserts."""
    if entry is None or entry.status is RegisterStatus.UNKNOWN:
        if attestation.grade is Grade.CONFIRMED_LIVE:
            return Reconciled(Reconciliation.AGREED_ALIVE, ("register_silent_call_confirmed",))
        return Reconciled(Reconciliation.NO_SIGNAL, ("register_silent_call_inconclusive",))

    if entry.status is RegisterStatus.DECEASED:
        if attestation.grade is Grade.CONFIRMED_LIVE:
            # The wrongly-declared-dead case. The person just answered and
            # passed a challenge minted seconds earlier.
            return Reconciled(
                Reconciliation.REGISTER_CONTRADICTED,
                (
                    "register_records_death",
                    "live_challenge_passed_after_that_date",
                    "correction_belongs_to_the_register_not_the_person",
                ),
                opens_correction_case=True,
            )
        if attestation.grade in (Grade.CONTRA, Grade.THIRD_PARTY_CLAIM, Grade.UNPROVEN):
            return Reconciled(
                Reconciliation.CALL_SUPPORTS_REGISTER,
                ("register_records_death", f"call_did_not_contradict_{attestation.grade.value.lower()}"),
            )
        return Reconciled(
            Reconciliation.REGISTER_UNCORROBORATED,
            ("register_records_death", "call_neither_confirmed_nor_contradicted"),
        )

    # Register says alive.
    if attestation.grade is Grade.CONFIRMED_LIVE:
        return Reconciled(Reconciliation.AGREED_ALIVE, ("register_alive_call_confirmed",))
    return Reconciled(Reconciliation.NO_SIGNAL, ("register_alive_call_inconclusive",))
