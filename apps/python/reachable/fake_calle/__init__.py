"""A scripted fake CALL-E, in-process and over loopback HTTP.

Written to the OpenAPI 0.7.0 contract, not to any fixture: transcript turns are
nested at ``recipients[].attempts[].transcript_turns`` with speaker labels of
``bot``, ``user`` or ``unknown``.

Not a CALL-E SDK and not a supported API. A test double, and the backup demo.
"""

from .scripts import SCRIPTS, script_names
from .server import FakeCalleClient, FakeCalleState, serve

__all__ = ["SCRIPTS", "script_names", "FakeCalleClient", "FakeCalleState", "serve"]
