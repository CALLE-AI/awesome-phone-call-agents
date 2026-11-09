"""
CALL-E adapter. Everything in workflow/ that places a phone call goes through
`run.call_and_wait()`; nothing else touches the CALL-E SDK.

The SDK is used rather than MCP because the workflow is a deterministic state
machine (family match, proximity, rate ranking, yes/no confirms) that needs no
LLM choosing the next step. There is no plan/confirm split at the SDK level:
`calls.create()` creates and dispatches a call in one request, so consent is
handled by the caller (see api/server.py).

Set CALLE_MOCK_MODE=1 to return scripted results instead of hitting the real
API. That is how the whole workflow is exercised without placing a call.
"""

import os

MOCK_MODE = os.environ.get("CALLE_MOCK_MODE", "0") == "1"
