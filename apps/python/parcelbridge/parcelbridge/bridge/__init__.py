"""Integration-pattern bridge Python hooks.

The :mod:`parcelbridge.bridge` Python package contains the
Python-side re-exports that a Node-based CALL-E bridge would
import across a subprocess boundary. The actual Node-side
bridge module (``bridge/calle_inprocess_bridge.mjs``) lives
at the bundle root and is shipped as **documentation only**;
it is a comment-and-stub template explaining how the wiring
would work, not vendored runtime code.
"""

from parcelbridge.fake_mcp import (  # noqa: F401
    InlineFakeMcpServer,
    run_fake_mcp_plan_call,
)
from parcelbridge.payload import build_business_payload  # noqa: F401
from parcelbridge.sanitization import sanitize_plan_response  # noqa: F401
from parcelbridge.workflow import run_offline_demo  # noqa: F401

__all__ = [
    "InlineFakeMcpServer",
    "run_fake_mcp_plan_call",
    "build_business_payload",
    "sanitize_plan_response",
    "run_offline_demo",
]