"""The offline default runs CALL-E's own code, and the README is allowed to say so.

The claim is worth a gate because it is the one a reader is most likely to disbelieve. A run
that announces itself as offline reads as a run with the vendor's SDK swapped out for a fake,
and for most projects that is exactly what it would be. Here the double is mounted on the
client's transport instead of replacing the client, so `calls.create`, `calls.get` and the
SDK's own exception types are all executed by the default command with no account and no call
placed.

That distinction is the difference between "CALL-E is imported" and "CALL-E is called", and
nothing else in the suite was holding it. Swap `build_client` for a hand-rolled fake and
every other test would still pass, because every other test only cares that the responses
have the right shape.
"""
from __future__ import annotations

import re
from pathlib import Path

import calle
from calle_double import CalleDouble, build_client

APP = Path(__file__).resolve().parent.parent


def test_the_offline_client_is_the_sdks_own_client():
    """Not a subclass, not a look-alike, not a mock that satisfies the same calls."""
    client = build_client(CalleDouble())

    assert isinstance(client, calle.CalleClient), (
        f"the offline default is holding {type(client)!r}, which is not the CALL-E client; "
        "the README's claim that the default run executes CALL-E's own code is then false"
    )
    assert type(client).__module__.startswith("calle."), (
        f"the client class comes from {type(client).__module__}, not from the SDK"
    )


def test_the_calls_api_the_offline_run_uses_comes_from_the_sdk():
    """`calls.create` and `calls.get` are the two lines the README anchors."""
    calls = build_client(CalleDouble()).calls

    assert type(calls).__module__.startswith("calle."), (
        f"the offline run reaches {type(calls).__module__}.{type(calls).__name__} rather than "
        "the SDK's calls resource, so the two anchored lines are not CALL-E's code"
    )
    for method in ("create", "get"):
        assert callable(getattr(calls, method, None)), (
            f"the SDK's calls resource has no {method}, so the README anchors a line that "
            "cannot run"
        )


def test_the_sdk_is_a_runtime_dependency_and_pinned():
    """A test-only dependency would make the claim above true and irrelevant.

    The README says `calle-ai==0.7.0` is a runtime dependency and gives that as the reason
    the offline default can execute CALL-E's code. If it moved to the dev requirements the
    sentence would still read correctly and would have stopped being the point.
    """
    runtime = (APP / "requirements.txt").read_text(encoding="utf-8")
    pin = re.search(r"^calle-ai==([\d.]+)", runtime, re.MULTILINE)

    assert pin, "calle-ai is not a pinned runtime dependency; the README says it is"

    readme = (APP / "README.md").read_text(encoding="utf-8")
    assert f"calle-ai=={pin.group(1)}" in readme, (
        f"requirements.txt pins calle-ai=={pin.group(1)} and the README cites a different "
        "version, so one of the two is telling a reader something that is not so"
    )


def test_the_readme_does_not_undersell_the_offline_path_again():
    """This sentence was in the README and it cost the project the claim above.

    "The offline default never reaches it" was written about the client construction line and
    read, reasonably, as "the offline default does not use CALL-E". Everything after that
    sentence had to fight it. The gate is here because the sentence is the kind of thing that
    comes back during an edit for brevity.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")

    assert "The offline default never reaches it" not in readme, (
        "the README is telling a reader the offline default does not reach CALL-E; three of "
        "the four anchored lines are executed by it"
    )
    assert "The offline default stubs none of that" in readme, (
        "the sentence that states what the offline run actually executes has gone, so the "
        "anchors above it are back to reading as live-path-only"
    )
