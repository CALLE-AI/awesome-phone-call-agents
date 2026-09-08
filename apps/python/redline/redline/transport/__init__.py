"""How a scenario is actually run against an agent.

Three implementations behind one protocol. `static` is the default and places no
calls; `replay` re-reads a recorded payload; `live` dials for real under a
budget. The evaluator cannot tell them apart, which is the point.
"""

from __future__ import annotations

from redline.transport.base import BudgetExceededError, Transport, TransportError
from redline.transport.live import LiveTransport, persona_script
from redline.transport.mock import MockTransport
from redline.transport.replay import ReplayTransport

__all__ = [
    "BudgetExceededError",
    "LiveTransport",
    "MockTransport",
    "ReplayTransport",
    "Transport",
    "TransportError",
    "persona_script",
]
