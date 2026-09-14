"""The judge-facing proof page: a saved instance of the review renderer.

D3 (locked): one deterministic renderer produces the live review screen and
the static proof page. This module owns the static side: it reads the
checked-in sanitized fixture (``proof/w1042-proof.json``), converts it into
a :class:`~warrantyops.review_screen.ReviewScreenModel` carrying the
Recorded CALL-E result marker, and renders it with the shared renderer.
The file a judge opens is exactly the file the tests verify: no network, no
server, no credential, no live-call affordance. The single interaction —
"Reveal recorded result" — reveals the saved, sanitized runtime result
locally; it never starts a call, and the page contains no fetch, no XHR and
no external resource. Evidence quotes are verbatim from the verified
receipt and are never polished or normalized for display.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .review_screen import ReviewScreenModel, build_static_model, render_review_screen

__all__ = [
    "DEFAULT_FIXTURE",
    "DEFAULT_OUTPUT",
    "build_proof_model",
    "render_proof_screen",
    "write_proof_screen",
]

PROOF_DIR = Path(__file__).resolve().parents[1] / "proof"
DEFAULT_FIXTURE = PROOF_DIR / "w1042-proof.json"
DEFAULT_OUTPUT = PROOF_DIR / "w1042-proof.html"


def build_proof_model(fixture_path: Path = DEFAULT_FIXTURE) -> ReviewScreenModel:
    """Load the checked-in fixture and build the static page's model."""

    fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    return build_static_model(fixture)


def render_proof_screen(fixture: dict[str, Any]) -> str:
    """Render the deterministic, self-contained proof page for a fixture."""

    return render_review_screen(build_static_model(fixture))


def write_proof_screen(
    fixture_path: Path = DEFAULT_FIXTURE, output_path: Path = DEFAULT_OUTPUT
) -> Path:
    """Write (or deterministically rewrite) the checked-in proof page."""

    page = render_proof_screen(
        json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    )
    output = Path(output_path)
    output.write_text(page, encoding="utf-8")
    return output
