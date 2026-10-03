"""The one interface the rest of Callibrate knows about telephony.

Everything above this line reasons about contracts and evidence. Everything
below it dials. There are two implementations: CALL-E, which holds a real
conversation with a real person, and the pilot line, which replays a scripted
one so the evidence rules can be exercised without spending a call.

Both return the same `CallEvidence`, and both are judged by the same
deterministic reader afterwards. That is the point of the seam: the safety
argument does not depend on which one ran.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from callibrate.calling.models import CallEvidence
from callibrate.contracts.models import VerificationContract


class VerificationCaller(ABC):
    """Turn a Verification Contract into evidence about a phone conversation."""

    #: Short identifier stored on every run and shown in the ledger.
    name: str = "caller"

    #: Whether this caller can reach a real telephone. A caller that cannot must
    #: never produce evidence that is presented as if it had.
    is_live: bool = False

    @abstractmethod
    async def verify(self, contract: VerificationContract) -> CallEvidence:
        """Place one call for one contract and return what it established.

        Raises `CallError` when the call could not be placed or its result could
        not be read. Never raises to mean "the provider said no".
        """

    async def aclose(self) -> None:
        """Release any transport held open between calls."""
        return None
