"""Dispatch: the only path from an approved plan to a real call.

Dry run is the default and it is not a stub - it runs the identical dispatcher,
reservation and idempotency logic, with a fixture provider instead of a phone
line. That is what makes `claimcall run` safe to put in a README.

External side effects, stated plainly:
  - dry run (default): none. No network, no spend, no phone rings.
  - `--live`: places ONE outbound phone call through CALL-E to the number in
    the claim file, consuming one call from your CALL-E allocation. It requires
    `CALLE_API_KEY`, `CLAIMCALL_ALLOW_LIVE=true`, an allowlist entry for the
    destination, and `--confirm <hash>` matching the plan you just previewed.

There is no rollback for a placed call. That is exactly why four independent
conditions have to line up before one happens.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from claimcall_core import (
    DispatchContext,
    DispatchOutcome,
    DispatchRefused,
    FixtureProvider,
    InMemoryIntentStore,
    dispatch,
    hash_phone,
    key_for_manifest,
)
from claimpilot_contracts import CallAuthorization, CallManifest, SafetyReport

# Bundled inside the package so they ship in the wheel. Resolving them
# relative to the parent directory worked from a checkout and broke for
# everyone who installed the tool.
FIXTURES = Path(__file__).resolve().parent / "fixtures"

__all__ = [
    "DispatchRefused",
    "LiveCallBlocked",
    "allowlisted",
    "authorize",
    "build_provider",
    "run",
]


class LiveCallBlocked(RuntimeError):
    """A live call was requested but a precondition is not satisfied."""


@dataclass
class Session:
    """Holds the reservation store for one CLI invocation."""

    store: InMemoryIntentStore = field(default_factory=InMemoryIntentStore)


def authorize(manifest: CallManifest, *, user_id: str = "cli-user", ttl_minutes: int = 15):  # noqa: ANN201
    """Record consent bound to this exact plan hash."""
    return CallAuthorization(
        claim_id=manifest.claim_id,
        manifest_id=manifest.id,
        manifest_hash=manifest.content_hash,
        user_id=user_id,
        expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
        session_label="claimcall-cli",
    )


def allowlisted(number: str) -> bool:
    """Live calls only go to a number you have explicitly allowlisted.

    CLAIMCALL_ALLOWED_PHONE_HASHES holds SHA-256 hashes of E.164 numbers, so a
    real phone number never has to sit in an environment variable or a shell
    history. Print one with: `claimcall hash-number +15005550006`.
    """
    allowed = {
        h.strip()
        for h in os.getenv("CLAIMCALL_ALLOWED_PHONE_HASHES", "").split(",")
        if h.strip()
    }
    return bool(allowed) and hash_phone(number) in allowed


def build_provider(*, live: bool, scenario: str = "claim-registered"):  # noqa: ANN201
    """Fixture provider unless every live precondition is met."""
    if not live:
        return FixtureProvider(fixtures_dir=FIXTURES, scenario=scenario)

    api_key = os.getenv("CALLE_API_KEY")
    if not api_key:
        raise LiveCallBlocked("CALLE_API_KEY is not set.")
    if os.getenv("CLAIMCALL_ALLOW_LIVE", "").strip().lower() not in {"1", "true", "yes"}:
        raise LiveCallBlocked(
            "Live calls are disabled. Set CLAIMCALL_ALLOW_LIVE=true to enable them."
        )
    try:
        from claimpilot_calle import build_provider as build_calle
    except ImportError as exc:  # pragma: no cover
        raise LiveCallBlocked(
            "The CALL-E adapter is not installed. Install with: pip install 'claimcall[live]'"
        ) from exc
    return build_calle(api_key, os.getenv("CALLE_BASE_URL", "https://api.heycall-e.com"))


def run(
    *,
    manifest: CallManifest,
    safety: SafetyReport,
    live: bool = False,
    scenario: str = "claim-registered",
    session: Session | None = None,
    provider: Any = None,
) -> DispatchOutcome:
    """Reserve idempotently, then submit at most once."""
    if live and not allowlisted(manifest.recipient_number_e164):
        raise LiveCallBlocked(
            "That destination is not allowlisted. Add its hash to "
            "CLAIMCALL_ALLOWED_PHONE_HASHES first (see `claimcall hash-number`)."
        )

    session = session or Session()
    provider = provider or build_provider(live=live, scenario=scenario)

    return dispatch(
        manifest=manifest,
        authorization=authorize(manifest),
        safety=safety,
        provider=provider,
        store=session.store,
        ctx=DispatchContext(
            live_calls_enabled=live,
            dry_run=not live,
            actor_role="team" if live else "user",
            call_budget_remaining=int(os.getenv("CLAIMCALL_BUDGET", "5")) if live else 0,
        ),
    )


def idempotency_key_for(manifest: CallManifest) -> str:
    return key_for_manifest(manifest)
