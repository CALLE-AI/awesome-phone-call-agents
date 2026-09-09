"""Read-only access to the case files the server is willing to serve.

No database, no cache, no resolution state - a case is read from disk
each time it is asked for, which for a handful of small JSON files is
both simpler and always current.

The name allowlist is the point of this module. Globbing cases/*.json
would have been shorter and is what this deliberately does not do: that
directory is also where an operator keeps local, untracked fixtures
holding real phone numbers for live CLI testing, and a glob would put
those in an HTTP response the moment they appeared on disk. Exposure is
therefore opt-in by name, in code, the same fail-closed shape as
dispatcher.UnknownJurisdictionError and use_cases.UnknownUseCaseError.

It doubles as the path-traversal defence: `name` is compared against a
fixed tuple before it is ever used to build a path, so no request can
reach outside cases/ regardless of what it contains.
"""

from __future__ import annotations

import secrets
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

from evidence.model import Case, load_case

DEFAULT_CASES_DIR = Path(__file__).resolve().parent.parent / "cases"

# The shipped catalog. Adding a case means adding its name here as well
# as the JSON file - see README's "Adding a use case".
SERVED_CASE_NAMES: tuple[str, ...] = (
    "critical-service-escalation",
    "ghost-appointment",
)


class CaseNotFoundError(LookupError):
    """Raised for a name that is not served, whether because it does not
    exist or because it is not on the allowlist. The two are deliberately
    indistinguishable to a client: which local files exist is not
    something an HTTP response should reveal.
    """


class CaseStore:
    def __init__(
        self,
        cases_dir: Path | None = None,
        served_names: tuple[str, ...] = SERVED_CASE_NAMES,
    ) -> None:
        self._dir = Path(cases_dir) if cases_dir is not None else DEFAULT_CASES_DIR
        self._served = served_names

    def names(self) -> tuple[str, ...]:
        """Served names that actually have a file, in allowlist order."""
        return tuple(name for name in self._served if (self._dir / f"{name}.json").is_file())

    def path_for(self, name: str) -> Path:
        """The file backing a served case.

        pipeline.ResolutionRequest takes a path, not a Case, so this is
        the bridge - and it is the same allowlist check as get(), not a
        looser one. A name is compared against the fixed tuple before it
        is ever joined to a directory, so nothing a client sends can
        address a file outside cases/ or a local fixture inside it.
        """
        if name not in self._served:
            raise CaseNotFoundError(name)
        path = self._dir / f"{name}.json"
        if not path.is_file():
            raise CaseNotFoundError(name)
        return path

    def get(self, name: str) -> Case:
        return load_case(self.path_for(name))

    def all(self) -> tuple[Case, ...]:
        return tuple(self.get(name) for name in self.names())


class ResolutionNotFoundError(LookupError):
    """Raised for an id this process did not issue, whether it never
    existed or has been evicted. Indistinguishable on purpose: how full
    the store is, and how long entries live, are not facts a client
    should be able to probe.
    """


# Enough for a demo session; old entries fall off the front rather than
# growing without bound. Resolutions are not persisted anywhere: this
# process forgets everything when it stops, which is stated plainly
# rather than worked around with a database nobody asked for.
MAX_RESOLUTIONS = 200


class ResolutionStore:
    """In-memory, bounded, FIFO. Holds already-serialized payloads, not
    Resolution objects: what a client can see is decided once, by
    api/serialize.py, and never re-derived at read time.
    """

    def __init__(self, max_entries: int = MAX_RESOLUTIONS) -> None:
        self._entries: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._max = max_entries
        # ThreadingHTTPServer has always run each request in its own
        # thread, so this store has been shared from the day it was
        # written. put() is three statements - insert, move to end, evict
        # down to the cap - and while CPython's GIL makes each one atomic,
        # the sequence is not. Nothing has been observed to break; this
        # makes the compound operation actually indivisible instead of
        # incidentally so, which is a guarantee rather than a bug fix.
        self._lock = threading.Lock()

    @staticmethod
    def new_id() -> str:
        """Opaque and random. Not a counter, not derived from the case,
        the phone, the time, or anything else about the resolution - an
        id that encoded any of those would leak them to whoever sees it.
        """
        return f"res_{secrets.token_urlsafe(12)}"

    def put(self, resolution_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._entries[resolution_id] = payload
            self._entries.move_to_end(resolution_id)
            while len(self._entries) > self._max:
                self._entries.popitem(last=False)

    def get(self, resolution_id: str) -> dict[str, Any]:
        with self._lock:
            try:
                return self._entries[resolution_id]
            except KeyError:
                raise ResolutionNotFoundError(resolution_id) from None

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)
