"""No runtime failover: one provider, chosen before the run, ever.

The locked position: runtime provider selection is a preflight and
configuration-time act. Once a run begins, the workflow holds exactly one
provider, a failed creation is terminal (the reservation suppresses the
retry; a human reconciles), and the only post-create continuation that
exists anywhere is a read (``calls.get``) — never a second placement,
through this provider or any other. These tests pin that position
structurally, because behavior alone cannot prove the absence of a surface.
"""

from __future__ import annotations

import inspect
from pathlib import Path

from warrantyops.providers.base import CallProvider
from warrantyops.workflow import run_exception

PACKAGE = Path(__file__).resolve().parent.parent / "warrantyops"


def test_the_provider_protocol_offers_exactly_one_operation():
    members = set(CallProvider.__annotations__) | {
        name
        for name in dir(CallProvider)
        if not name.startswith("_") and callable(getattr(CallProvider, name, None))
    }
    assert members == {"name", "requires_durable_ledger", "place_call"}


def test_the_workflow_takes_exactly_one_provider_argument():
    """One provider, supplied before the run — not a list, not a fallback."""

    parameters = inspect.signature(run_exception).parameters
    provider_parameters = [
        name
        for name, parameter in parameters.items()
        if "provider" in name or "Provider" in str(parameter.annotation)
    ]
    assert provider_parameters == ["provider"]


def test_no_failover_or_fallback_surface_exists_in_the_package():
    """A failover seam would have to be named; nothing is so named.

    The scan covers the provider seam — the workflow, the providers and the
    runtime-proof path, where a failover would have to live — so introducing
    the vocabulary there (a ``fallback_provider`` parameter, a ``failover()``
    method, a retry-with-other-provider loop) fails this test at the moment
    it is written, not the first time it misbehaves. Presentation modules
    (the proof screen's CSS "fallback text") are out of scope on purpose.
    """

    seam = [
        PACKAGE / "workflow.py",
        PACKAGE / "runtime_proof.py",
        *sorted((PACKAGE / "providers").glob("*.py")),
    ]
    forbidden = ("failover", "fallback", "switch_provider", "retry_with")
    offenders: list[str] = []
    for path in seam:
        source = path.read_text(encoding="utf-8")
        for token in forbidden:
            if token in source:
                offenders.append(f"{path.name}: {token}")
    assert offenders == []


def test_the_provider_is_constructed_before_the_run_and_never_replaced():
    """``execute_live_call`` builds one provider, then runs; nothing after.

    The provider construction and the run are two statements in sequence —
    there is no loop, no exception handler that re-selects, and no second
    construction. Pinned by reading the function's own structure: exactly
    one ``CalleCallProvider(`` occurrence, before the ``run_exception(``
    occurrence, and no second occurrence of either.
    """

    source = (PACKAGE / "runtime_proof.py").read_text(encoding="utf-8")
    execute_body = source.split("def execute_live_call(")[1]
    assert execute_body.count("CalleCallProvider(") == 1
    assert execute_body.count("run_exception(") == 1
    assert execute_body.index("CalleCallProvider(") < execute_body.index(
        "run_exception("
    )
