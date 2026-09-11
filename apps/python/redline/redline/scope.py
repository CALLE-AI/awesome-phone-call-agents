"""Who you are allowed to call, written down and signed.

Every other guard in REDLINE is technical: an exact-match allowlist, a budget,
an idempotency key, a confirmation per call. This one is not. It is the
question a penetration test answers before it starts and a hobby project never
does -- *who said you could dial this number, and when does that stop being
true?*

A scope file is that answer, in the repository, in the reviewer's diff:

.. code-block:: yaml

    authorised_by: "A Name, Head of Support"
    contact: "someone@example.com"
    expires: 2026-12-31
    targets:
      - number: "+14155550142"
        owner: "Test handset in the support office"

Four properties are enforced, and each one exists because of a way this goes
wrong:

* **A name and a way to reach them.** An authorisation nobody signed is not an
  authorisation, and the contact is who you call when the phone that should
  not have rung, rang.
* **An expiry, in the future.** Permission granted once in March is not
  permission in November. There is no way to write "forever" in this file.
* **Exact numbers, strict E.164.** No prefixes, no ranges, no wildcards --
  a prefix is how one entry quietly authorises a million phones.
* **An owner per number**, so a reviewer can tell a test handset from
  somebody's mobile without asking.

The file holds real telephone numbers by design. The package ignores it, live
mode refuses an unignored copy inside Git, and the supplied staged-file guard
rejects a force-added copy by filename without reading it. :mod:`redline.scope`
never prints a number unmasked. What ships instead is
``redline.scope.example.yaml``, filled with standards-reserved fiction.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from redline.redact import mask_number

__all__ = [
    "SCOPE_EXAMPLE_FILENAME",
    "SCOPE_FILENAME",
    "Scope",
    "ScopeError",
    "Target",
    "find_scope",
    "load_scope",
]

SCOPE_FILENAME = "redline.scope.yaml"
SCOPE_EXAMPLE_FILENAME = "redline.scope.example.yaml"

#: Strict E.164, the same pattern the CALL-E contract applies to recipients.
E164 = re.compile(r"^\+[1-9][0-9]{6,14}$")


class ScopeError(RuntimeError):
    """The scope file is missing, malformed, expired, or does not cover this."""


@dataclass(frozen=True, slots=True)
class Target:
    """One number, and who owns the phone it rings."""

    number: str
    owner: str
    note: str = ""

    @property
    def masked(self) -> str:
        return mask_number(self.number)


@dataclass(frozen=True, slots=True)
class Scope:
    """A written, dated, signed authorisation to place calls."""

    authorised_by: str
    contact: str
    expires: date
    targets: tuple[Target, ...]
    source_path: Path | None = None

    def expired_on(self, today: date) -> bool:
        """Whether the authorisation has run out.

        The expiry day itself still counts: somebody who wrote 31 December
        meant to be covered on 31 December.
        """
        return today > self.expires

    def target_for(self, number: str) -> Target | None:
        """The entry authorising this exact number, if there is one.

        Exact string comparison after trimming, and nothing else. No prefix
        match, no normalisation of formatting, no "close enough". A number the
        operator typed differently from the way they wrote it down is a number
        REDLINE has not been authorised to call.
        """
        wanted = number.strip()
        for target in self.targets:
            if target.number == wanted:
                return target
        return None

    @property
    def numbers(self) -> tuple[str, ...]:
        return tuple(target.number for target in self.targets)


def find_scope(start: Path) -> Path | None:
    """Look for a scope file beside the config, then upwards to the repo root.

    Stops at a directory containing ``.git``, for the same reason
    :func:`redline.env.find_dotenv` does: walking past the project boundary is
    how a tool picks up somebody else's file and calls it consent.
    """
    current = start if start.is_dir() else start.parent
    for directory in [current, *current.parents]:
        candidate = directory / SCOPE_FILENAME
        if candidate.is_file():
            return candidate
        if (directory / ".git").exists():
            break
    return None


def load_scope(path: Path, *, today: date | None = None) -> Scope:
    """Read and validate a scope file, or explain exactly what is wrong with it.

    Every failure here stops a real call from being placed, so every message
    says what to write rather than merely what is missing.
    """
    if not path.is_file():
        raise ScopeError(
            f"no {SCOPE_FILENAME} at {path}. Copy {SCOPE_EXAMPLE_FILENAME} and "
            "fill it in with the numbers you are authorised to call. REDLINE "
            "will not dial a number nobody has signed for."
        )

    _refuse_trackable_scope(path)

    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:  # pragma: no cover - message passthrough
        raise ScopeError(f"{path.name} is not valid YAML: {error}") from error

    if not isinstance(document, dict):
        raise ScopeError(
            f"{path.name} must be a mapping, not {type(document).__name__}"
        )

    authorised_by = _required_text(document, "authorised_by", path)
    contact = _required_text(document, "contact", path)
    expires = _required_date(document, "expires", path)
    targets = _required_targets(document, path)

    scope = Scope(
        authorised_by=authorised_by,
        contact=contact,
        expires=expires,
        targets=targets,
        source_path=path,
    )

    reference = today or date.today()
    if scope.expired_on(reference):
        raise ScopeError(
            f"the authorisation in {path.name} expired on {expires.isoformat()}. "
            "Get it renewed and update the file. An expired authorisation is "
            "not a formality: it is the difference between a test and a call "
            "nobody agreed to."
        )
    return scope


def _refuse_trackable_scope(path: Path) -> None:
    """Refuse a scope file that Git could add from inside its repository.

    The file intentionally contains real phone numbers and authoriser contact
    data. A nested `.gitignore` protects normal adds; this runtime check also
    makes a missing or broken ignore rule a live-call blocker. Files outside a
    Git worktree are allowed because there is no public-history path to close.
    """
    try:
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=path.parent,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return
    if root.returncode != 0:
        return

    ignored = subprocess.run(
        ["git", "check-ignore", "-q", "--", str(path.resolve())],
        cwd=path.parent,
        capture_output=True,
        check=False,
        timeout=10,
    )
    if ignored.returncode != 0:
        raise ScopeError(
            f"{path.name} is inside a Git worktree but is not ignored. Add "
            f"{SCOPE_FILENAME} to the nearest .gitignore before using --live."
        )


# --- Field readers ------------------------------------------------------------


def _required_text(document: dict[str, Any], key: str, path: Path) -> str:
    value = document.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ScopeError(f"{path.name} needs a non-empty {key!r}. " + _WHY[key])
    return value.strip()


_WHY = {
    "authorised_by": (
        "Name the person who authorised this, and their role. An "
        "authorisation nobody signed is not one."
    ),
    "contact": (
        "Give a way to reach whoever can stop this -- an address or a number. "
        "It is what somebody needs when a phone rings that should not have."
    ),
}


def _required_date(document: dict[str, Any], key: str, path: Path) -> date:
    value = document.get(key)
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip())
        except ValueError:
            pass
    raise ScopeError(
        f"{path.name} needs {key!r} as a date, written YYYY-MM-DD. There is "
        "deliberately no way to write 'no expiry': permission granted once is "
        "not permission for ever."
    )


def _required_targets(document: dict[str, Any], path: Path) -> tuple[Target, ...]:
    raw = document.get("targets")
    if not isinstance(raw, list) or not raw:
        raise ScopeError(
            f"{path.name} needs at least one entry under 'targets', each with "
            "a 'number' and an 'owner'."
        )

    targets: list[Target] = []
    seen: set[str] = set()
    for index, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            raise ScopeError(f"{path.name}: targets[{index}] must be a mapping")

        number = entry.get("number")
        if not isinstance(number, str) or not E164.match(number.strip()):
            raise ScopeError(
                f"{path.name}: targets[{index}] needs a strict E.164 'number' "
                "-- a plus sign, a country code, digits only. No spaces, no "
                "punctuation, no prefixes: a prefix is how one line quietly "
                "authorises a million phones."
            )
        number = number.strip()

        owner = entry.get("owner")
        if not isinstance(owner, str) or not owner.strip():
            raise ScopeError(
                f"{path.name}: targets[{index}] ({mask_number(number)}) needs "
                "an 'owner'. A reviewer has to be able to tell a test handset "
                "from somebody's mobile without asking you."
            )

        if number in seen:
            raise ScopeError(
                f"{path.name}: {mask_number(number)} is listed twice. Two "
                "entries for one phone means two different people think they "
                "authorised it."
            )
        seen.add(number)

        note = entry.get("note")
        targets.append(
            Target(
                number=number,
                owner=owner.strip(),
                note=note.strip() if isinstance(note, str) else "",
            )
        )
    return tuple(targets)
