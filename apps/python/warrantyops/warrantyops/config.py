"""Configuration and the gate that decides whether anything may leave the process.

Dry run is the default and it is not a flag a caller can forget to set: live
calling needs an explicit opt-in, an API key, an official CALL-E origin, and an
artifact directory that is outside this repository. Any one of those missing is
a refusal, not a warning.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.heycall-e.com"

#: Origins the client may send a credential to. A base URL outside this set is
#: refused rather than trusted, so a redirected or typo-ed host cannot receive
#: an API key.
OFFICIAL_ORIGINS = frozenset(
    {
        "https://api.heycall-e.com",
    }
)

REPOSITORY_MARKERS = ("CONTRIBUTING.md", "AGENTS.md", "SECURITY.md")


class ConfigRefusal(str, Enum):
    LIVE_NOT_ENABLED = "LIVE_NOT_ENABLED"
    MISSING_API_KEY = "MISSING_API_KEY"
    UNOFFICIAL_ORIGIN = "UNOFFICIAL_ORIGIN"
    ARTIFACT_DIR_MISSING = "ARTIFACT_DIR_MISSING"
    ARTIFACT_DIR_INSIDE_REPOSITORY = "ARTIFACT_DIR_INSIDE_REPOSITORY"


class ConfigError(RuntimeError):
    def __init__(self, refusals: tuple[ConfigRefusal, ...]) -> None:
        super().__init__(", ".join(refusal.value for refusal in refusals))
        self.refusals = refusals


@dataclass(frozen=True)
class RuntimeConfig:
    dry_run: bool
    base_url: str
    idempotency_namespace: str
    api_key: str | None = None
    artifact_dir: Path | None = None


def _origin(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def find_repository_root(start: Path | None = None) -> Path | None:
    """Return the repository root above ``start``, or None when there is none."""

    current = (start or Path(__file__)).resolve()
    for candidate in [current, *current.parents]:
        if candidate.is_dir() and all(
            (candidate / marker).exists() for marker in REPOSITORY_MARKERS
        ):
            return candidate
    return None


def artifact_dir_refusals(artifact_dir: Path | None) -> tuple[ConfigRefusal, ...]:
    """Refuse an artifact directory that would put real call data into git.

    Keeping real transcripts out of the repository is not something a
    ``.gitignore`` entry can guarantee, because an entry can be overridden by
    ``git add -f`` and a path can be added before the entry exists. The
    directory itself has to be somewhere the repository does not reach.
    """

    if artifact_dir is None:
        return (ConfigRefusal.ARTIFACT_DIR_MISSING,)
    resolved = artifact_dir.resolve()
    repo_root = find_repository_root()
    if repo_root is not None:
        try:
            resolved.relative_to(repo_root)
        except ValueError:
            return ()
        return (ConfigRefusal.ARTIFACT_DIR_INSIDE_REPOSITORY,)
    return ()


def load_config(env: Mapping[str, str] | None = None) -> RuntimeConfig:
    """Build a configuration from the environment. Never raises on dry run."""

    source: Mapping[str, str] = os.environ if env is None else env
    live_requested = source.get("CALLE_LIVE_CALLS_ENABLED", "").strip() == "1"
    artifact_value = source.get("WARRANTYOPS_ARTIFACT_DIR", "").strip()
    return RuntimeConfig(
        dry_run=not live_requested,
        base_url=source.get("CALLE_BASE_URL", DEFAULT_BASE_URL).strip()
        or DEFAULT_BASE_URL,
        idempotency_namespace=source.get(
            "CALLE_IDEMPOTENCY_NAMESPACE", "warrantyops"
        ).strip()
        or "warrantyops",
        api_key=source.get("CALLE_API_KEY") or None,
        artifact_dir=Path(artifact_value) if artifact_value else None,
    )


def live_call_refusals(config: RuntimeConfig) -> tuple[ConfigRefusal, ...]:
    """Every reason this configuration may not place a live call."""

    refusals: list[ConfigRefusal] = []
    if config.dry_run:
        refusals.append(ConfigRefusal.LIVE_NOT_ENABLED)
    if not config.api_key:
        refusals.append(ConfigRefusal.MISSING_API_KEY)
    if _origin(config.base_url) not in OFFICIAL_ORIGINS:
        refusals.append(ConfigRefusal.UNOFFICIAL_ORIGIN)
    refusals.extend(artifact_dir_refusals(config.artifact_dir))
    return tuple(refusals)
