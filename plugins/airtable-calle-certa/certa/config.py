"""Where credentials live, and how the panel learns about them.

An operator on a verification desk should not have to export environment
variables in a shell. So the panel asks for the three values it needs on first
run and writes them to a local `.env` with owner-only permissions.

Rules that do not bend:

  * Credentials are never written into the Airtable base, never logged, never
    returned by any endpoint, and never rendered into the page. `redacted()`
    is the only shape that leaves this module.
  * The file is created 0600. If it already exists with looser permissions
    that is reported, because a token readable by every account on the machine
    is a finding, not a detail.
  * Environment variables still win, so a deployment that injects secrets
    properly is never overridden by a file.
"""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path

SECRET_KEYS = ("AIRTABLE_TOKEN", "CALLE_API_KEY")
PLAIN_KEYS = ("AIRTABLE_BASE_ID", "CERTA_REQUESTER_NAME")
ALL_KEYS = SECRET_KEYS + PLAIN_KEYS

DEFAULT_ENV_PATH = Path(".env")


class ConfigError(Exception):
    """Configuration could not be read or written safely."""


@dataclass(frozen=True, slots=True)
class Config:
    airtable_token: str = ""
    airtable_base_id: str = ""
    calle_api_key: str = ""
    requester_name: str = ""

    @property
    def can_read_table(self) -> bool:
        return bool(self.airtable_token and self.airtable_base_id)

    @property
    def can_place_calls(self) -> bool:
        return bool(self.can_read_table and self.calle_api_key and self.requester_name)

    def missing(self) -> list[str]:
        gaps = []
        if not self.airtable_token:
            gaps.append("AIRTABLE_TOKEN")
        if not self.airtable_base_id:
            gaps.append("AIRTABLE_BASE_ID")
        if not self.requester_name:
            gaps.append("CERTA_REQUESTER_NAME")
        if not self.calle_api_key:
            gaps.append("CALLE_API_KEY")
        return gaps

    def redacted(self) -> dict[str, object]:
        """The only representation that may leave this process.

        Says whether a secret is set and shows its last four characters, so an
        operator can tell one key from another without the key being readable.
        """

        def tail(value: str) -> str:
            return f"set (…{value[-4:]})" if value else ""

        return {
            "airtable_token": tail(self.airtable_token),
            "calle_api_key": tail(self.calle_api_key),
            "airtable_base_id": self.airtable_base_id,
            "requester_name": self.requester_name,
            "can_read_table": self.can_read_table,
            "can_place_calls": self.can_place_calls,
            "missing": self.missing(),
        }


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def load(env_path: Path | str = DEFAULT_ENV_PATH) -> Config:
    """Environment first, then the local file. Placeholders count as unset."""
    path = Path(env_path)
    from_file = parse_env(path.read_text(encoding="utf-8")) if path.exists() else {}

    def get(key: str) -> str:
        value = (os.environ.get(key) or from_file.get(key) or "").strip()
        # .env.example ships placeholders; treating them as real would send a
        # meaningless token to Airtable and produce a baffling 401.
        return "" if "replace_me" in value.lower() else value

    return Config(
        airtable_token=get("AIRTABLE_TOKEN"),
        airtable_base_id=get("AIRTABLE_BASE_ID"),
        calle_api_key=get("CALLE_API_KEY"),
        requester_name=get("CERTA_REQUESTER_NAME"),
    )


def save(config: Config, env_path: Path | str = DEFAULT_ENV_PATH) -> Path:
    """Write credentials to a 0600 file, preserving unrelated keys."""
    path = Path(env_path)
    existing = parse_env(path.read_text(encoding="utf-8")) if path.exists() else {}
    existing.update(
        {
            "AIRTABLE_TOKEN": config.airtable_token,
            "AIRTABLE_BASE_ID": config.airtable_base_id,
            "CALLE_API_KEY": config.calle_api_key,
            "CERTA_REQUESTER_NAME": config.requester_name,
        }
    )
    body = "\n".join(f"{k}={v}" for k, v in existing.items() if v) + "\n"

    # Create with 0600 from the outset rather than writing then chmod-ing,
    # which would leave a window where the token is world-readable.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(body)
    os.chmod(path, 0o600)
    return path


def permission_warning(env_path: Path | str = DEFAULT_ENV_PATH) -> str:
    """Non-empty when the credentials file is readable beyond its owner."""
    path = Path(env_path)
    if not path.exists():
        return ""
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        return (
            f"{path} is mode {mode:04o} and is readable beyond its owner. "
            f"Run: chmod 600 {path}"
        )
    return ""
