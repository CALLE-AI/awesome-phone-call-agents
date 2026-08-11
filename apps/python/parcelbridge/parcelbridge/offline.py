"""Backwards-compatibility shim for :mod:`parcelbridge.offline`.

The canonical home of the inline fake MCP server is
:mod:`parcelbridge.fake_mcp`. This module re-exports the
public surface so existing imports (``from parcelbridge.offline
import run_offline_plan_call, OfflinePlanCallResult``) continue
to work after the rename.

New code should import from :mod:`parcelbridge.fake_mcp`.
"""

from parcelbridge.fake_mcp import (  # noqa: F401
    FakeMcpPlanCallResult as OfflinePlanCallResult,
    InlineFakeMcpServer,
    run_fake_mcp_plan_call as run_offline_plan_call,
)

__all__ = [
    "OfflinePlanCallResult",
    "InlineFakeMcpServer",
    "run_offline_plan_call",
]