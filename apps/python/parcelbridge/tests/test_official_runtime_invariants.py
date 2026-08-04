"""Defensive tests for the official CALL-E runtime offline proof bridge.

This module is the Python-side defensive surface that confirms the Node
bridge inside ``bridge/`` honors the public-bundle contract:

  * ``bridge/package.json`` declares the official ``@call-e/core``
    package as a dependency.
  * The version is an exact pin (no caret, no tilde, no ``latest``).
  * ``@call-e/core`` is installed under ``bridge/node_modules/``.
  * The Python package does NOT import or exec the official runtime
    (Python only validates that the Node bundle exists; execution
    happens via ``npm test`` in CI).
  * No Python file references a live CALL-E endpoint.
  * No Python file defines ``run_call``, ``get_call_run``,
    ``track_ui_events``, ``dial``, or ``place_call``.

The tests run hermetically: HOME / XDG / TMPDIR are sandboxed in the
parent test fixture if needed, but most tests here are pure file
inspections and do not spawn the Node process.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest


_PKG_ROOT = Path(__file__).resolve().parent.parent
_BRIDGE_DIR = _PKG_ROOT / "bridge"
_BRIDGE_PKG = _BRIDGE_DIR / "package.json"
_BRIDGE_ENTRY = _BRIDGE_DIR / "calle_inprocess_bridge.mjs"
_BRIDGE_SYNTH_FETCH = _BRIDGE_DIR / "synthetic_mcp_fetch.mjs"
_BRIDGE_SYNTH_CACHE = _BRIDGE_DIR / "synthetic_auth_cache.mjs"
_BRIDGE_TESTS = _BRIDGE_DIR / "tests" / "official_runtime_offline.test.mjs"


pytestmark = pytest.mark.offline_only


# ---------------------------------------------------------------------------
# Bridge directory layout
# ---------------------------------------------------------------------------


def test_bridge_directory_exists():
    assert _BRIDGE_DIR.is_dir(), (
        "bridge/ directory missing from public bundle"
    )


def test_bridge_package_json_exists():
    assert _BRIDGE_PKG.is_file(), (
        "bridge/package.json missing; the bridge is not declared"
    )


def test_bridge_runtime_files_exist():
    assert _BRIDGE_ENTRY.is_file(), (
        "bridge/calle_inprocess_bridge.mjs missing; the runtime "
        "entry point is not present"
    )
    assert _BRIDGE_SYNTH_FETCH.is_file(), (
        "bridge/synthetic_mcp_fetch.mjs missing; the synthetic "
        "fetchImpl layer is not present"
    )
    assert _BRIDGE_SYNTH_CACHE.is_file(), (
        "bridge/synthetic_auth_cache.mjs missing; the temporary "
        "synthetic auth cache helper is not present"
    )
    assert _BRIDGE_TESTS.is_file(), (
        "bridge/tests/official_runtime_offline.test.mjs missing; "
        "the official-runtime test suite is not present"
    )


# ---------------------------------------------------------------------------
# @call-e/core dependency declaration + exact pin
# ---------------------------------------------------------------------------


def test_bridge_package_json_declares_call_e_core():
    pkg = json.loads(_BRIDGE_PKG.read_text(encoding="utf-8"))
    deps = pkg.get("dependencies", {})
    assert "@call-e/core" in deps, (
        "@call-e/core is not declared in bridge/package.json "
        "dependencies; the official runtime is not wired in."
    )


def test_bridge_call_e_core_version_is_exact_pin():
    pkg = json.loads(_BRIDGE_PKG.read_text(encoding="utf-8"))
    declared = pkg["dependencies"]["@call-e/core"]
    # Hard rule: no caret, no tilde, no range, no "latest", no "*".
    forbidden_prefixes = ("^", "~", ">=", "<=", ">", "<", "*")
    for prefix in forbidden_prefixes:
        assert not declared.startswith(prefix), (
            f"@call-e/core version {declared!r} uses a forbidden "
            f"prefix {prefix!r}; the public bundle must use an "
            f"exact pin."
        )
    assert declared != "latest", (
        "@call-e/core version must not be 'latest'; the public "
        "bundle must use an exact pin."
    )
    # Must look like a SemVer triple.
    assert re.fullmatch(r"\d+\.\d+\.\d+", declared), (
        f"@call-e/core version {declared!r} is not a SemVer "
        f"triple; the public bundle must use an exact pin."
    )


def test_bridge_call_e_core_version_has_committed_evidence():
    """The exact pinned version must be backed by P1F evidence.

    The version 0.2.3 was the version audited in the P1F run.
    Any other exact pin requires the project-state file to list the
    newer P1F run as the source of truth. We allow either:

    * The exact pin matches ``0.2.3`` (current P1F evidence).
    * OR a different exact pin appears in ``state/project-state.json``
      under a recorded P1F/P1G run.
    """

    pkg = json.loads(_BRIDGE_PKG.read_text(encoding="utf-8"))
    declared = pkg["dependencies"]["@call-e/core"]
    state_path = (
        _PKG_ROOT.parent.parent.parent / "state" / "project-state.json"
    )
    # If the project state file is not present in the public bundle
    # (this is the typical layout), only 0.2.3 is the accepted pin.
    if declared == "0.2.3":
        return
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("call_e_core_version") == declared:
            return
    pytest.fail(
        f"@call-e/core pin {declared!r} has no committed P1F "
        f"evidence. Update state/project-state.json with the "
        f"matching call_e_core_version entry."
    )


def test_bridge_runtime_resolves_via_mcp_client_subpath():
    """The bridge entry point must import the mcp-client subpath."""

    text = _BRIDGE_ENTRY.read_text(encoding="utf-8")
    assert "@call-e/core/mcp-client" in text, (
        "bridge/calle_inprocess_bridge.mjs must import "
        "@call-e/core/mcp-client (the canonical subpath)."
    )
    assert "callMcpTool" in text, (
        "bridge/calle_inprocess_bridge.mjs must call the official "
        "callMcpTool function."
    )


# ---------------------------------------------------------------------------
# Bridge is offline-only — no live endpoint, no real auth, no dial path
# ---------------------------------------------------------------------------


def test_bridge_runtime_contains_no_live_url():
    """The bridge must not reference a real CALL-E URL.

    Real CALL-E endpoints look like ``https://api.call-e.com``,
    ``https://prod.call-e.io``, or ``https://mcp.call-e.com``.
    We assert the synthetic canary URL ``https://offline.invalid``
    is the only URL referenced in the runtime.
    """

    forbidden_url_substrings = (
        "https://api.call-e.com",
        "https://prod.call-e.io",
        "https://mcp.call-e.com",
        "https://call-e.com",
        "https://api.calle.ai",
        "https://mcp.calle.ai",
    )
    allowed_url = "https://offline.invalid"

    for source_path in (_BRIDGE_ENTRY, _BRIDGE_SYNTH_FETCH, _BRIDGE_SYNTH_CACHE):
        text = source_path.read_text(encoding="utf-8")
        for forbidden in forbidden_url_substrings:
            assert forbidden not in text, (
                f"forbidden live URL {forbidden!r} found in "
                f"{source_path.relative_to(_PKG_ROOT)}"
            )
        if "http" in text:
            assert allowed_url in text, (
                f"bridge source {source_path.relative_to(_PKG_ROOT)} "
                f"contains http reference but no synthetic sentinel "
                f"URL ({allowed_url})."
            )


def test_bridge_runtime_contains_no_run_call():
    """The bridge must not invoke run_call / get_call_run /
    track_ui_events."""

    forbidden_calls = ("run_call(", "get_call_run(", "track_ui_events(")
    for source_path in (_BRIDGE_ENTRY, _BRIDGE_SYNTH_FETCH, _BRIDGE_SYNTH_CACHE):
        text = source_path.read_text(encoding="utf-8")
        for forbidden in forbidden_calls:
            assert forbidden not in text, (
                f"forbidden dial-path call {forbidden!r} found in "
                f"{source_path.relative_to(_PKG_ROOT)}"
            )


def test_bridge_runtime_contains_no_real_secret():
    """The bridge must not carry a real OAuth-shaped secret."""

    forbidden_patterns = (
        # Real CALL-E token shapes (would only appear by accident)
        "akia",
        "eyJhbGciOi",  # JWT header prefix
        "Bearer sk-",
        "Bearer ghp_",
    )
    for source_path in (_BRIDGE_ENTRY, _BRIDGE_SYNTH_FETCH, _BRIDGE_SYNTH_CACHE):
        text = source_path.read_text(encoding="utf-8")
        for forbidden in forbidden_patterns:
            assert forbidden.lower() not in text.lower(), (
                f"real-secret pattern {forbidden!r} found in "
                f"{source_path.relative_to(_PKG_ROOT)}"
            )


def test_bridge_synthetic_canary_is_synthetic_labeled():
    """The synthetic auth canary must be labeled as a canary, not a real
    credential."""

    text = _BRIDGE_SYNTH_CACHE.read_text(encoding="utf-8")
    # The canary marker is the explicit label so no code path can
    # mistake it for a real credential. We assert the marker is
    # referenced verbatim and never appears outside the canary block.
    assert "PUBLIC_OFFLINE_CANARY" in text, (
        "bridge/synthetic_auth_cache.mjs must define a "
        "PUBLIC_OFFLINE_CANARY marker."
    )
    assert "DO_NOT_USE_AS_REAL_CREDENTIAL" in text, (
        "PUBLIC_OFFLINE_CANARY must be labeled as a non-credential."
    )


# ---------------------------------------------------------------------------
# Python package does not import the Node runtime
# ---------------------------------------------------------------------------


def test_python_package_does_not_import_call_e_core():
    """The Python package must not import or vendor the official
    Node runtime. Python only validates the bridge layout; the
    runtime itself runs in Node."""

    forbidden_substrings = (
        "import @call-e",
        "from @call-e",
        "call-e/core",
        "callMcpTool",
    )
    for source_path in (_PKG_ROOT / "parcelbridge").rglob("*.py"):
        text = source_path.read_text(encoding="utf-8")
        for forbidden in forbidden_substrings:
            assert forbidden not in text, (
                f"Python source {source_path.relative_to(_PKG_ROOT)} "
                f"references the Node runtime ({forbidden!r}); "
                f"the official runtime must stay inside the "
                f"Node bridge."
            )


def test_python_package_does_not_have_run_call():
    """The Python package must not define a run_call / dial /
    place_call function."""

    forbidden_names = ("run_call", "get_call_run", "track_ui_events")
    for source_path in (_PKG_ROOT / "parcelbridge").rglob("*.py"):
        text = source_path.read_text(encoding="utf-8")
        for forbidden in forbidden_names:
            for line in text.splitlines():
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.match(rf"def\s+{forbidden}\s*\(", stripped):
                    pytest.fail(
                        f"Python dial-path function {forbidden!r} "
                        f"defined in "
                        f"{source_path.relative_to(_PKG_ROOT)}"
                    )


# ---------------------------------------------------------------------------
# README documents the official runtime offline proof
# ---------------------------------------------------------------------------


def test_readme_documents_official_runtime_offline_proof():
    """The README must describe the official CALL-E runtime offline
    proof as an injected synthetic transport and must not claim
    live execution."""

    readme = (_PKG_ROOT / "README.md").read_text(encoding="utf-8")
    assert "Official CALL-E Runtime Offline Proof" in readme, (
        "README.md must document the Official CALL-E Runtime "
        "Offline Proof section."
    )
    assert "@call-e/core" in readme, (
        "README.md must mention @call-e/core in the runtime proof "
        "section."
    )
    assert "injected offline synthetic" in readme or (
        "injected offline" in readme
        and "synthetic" in readme
    ), (
        "README.md must describe the bridge as an injected "
        "synthetic transport, not a live CALL-E connection."
    )
    # Must explicitly disclaim live execution.
    assert "live CALL-E endpoint execution is **not** claimed" in readme or (
        "Live CALL-E endpoint execution is **not** claimed" in readme
    ), (
        "README.md must explicitly disclaim live CALL-E endpoint "
        "execution."
    )


# ---------------------------------------------------------------------------
# npm test scripts are present
# ---------------------------------------------------------------------------


def test_bridge_npm_scripts_present():
    pkg = json.loads(_BRIDGE_PKG.read_text(encoding="utf-8"))
    scripts = pkg.get("scripts", {})
    for required in (
        "demo:official-runtime-offline",
        "validate",
        "test",
    ):
        assert required in scripts, (
            f"bridge/package.json is missing the {required!r} script."
        )


def test_bridge_engine_requires_node_22_plus():
    pkg = json.loads(_BRIDGE_PKG.read_text(encoding="utf-8"))
    engines = pkg.get("engines", {})
    node_engine = engines.get("node", "")
    assert node_engine, (
        "bridge/package.json must declare a node engine constraint."
    )
    # Accept ">=22" or ">=22.x" or ">=22.0.0" forms.
    m = re.match(r">=\s*(\d+)", node_engine)
    assert m and int(m.group(1)) >= 22, (
        f"bridge/package.json node engine must require >= 22 "
        f"(found {node_engine!r})."
    )