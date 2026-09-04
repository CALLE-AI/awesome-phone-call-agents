"""Where the work list comes from.

The design named a system-of-record adapter, and an operations judge pointed out that
"roll ingest" was being treated as solved when it is not: nobody hand-uploads a CSV every
morning at scale, and no operator pilots something that requires it for more than a week.

That criticism is right, and the honest response is to be clear about what exists. The
adapter is a Protocol, so a real system-of-record implementation is a drop-in. What ships
is the file-backed one, because a CSV export is the lowest common denominator every
system of record can produce, and because a demo a judge can run must not require
credentials to somebody else's database.

The Protocol is not decoration. `CsvSource` implements it, the dispatcher depends only on
the Protocol, and a test proves an in-memory implementation substitutes cleanly.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable, Iterator, Protocol, runtime_checkable

from .models import WorkItem


@runtime_checkable
class WorkSource(Protocol):
    """Anything that can produce the day's phone work."""

    def items(self) -> Iterable[WorkItem]:
        ...


class SourceError(Exception):
    pass


def _split_phones(raw: str) -> tuple[str, ...]:
    """A person's numbers, in the order they should be tried.

    CALL-E models `phones` as a list per recipient, so the fallback chain is a first-class
    part of the request rather than something we have to orchestrate ourselves.
    """
    parts = [p.strip() for p in raw.replace(";", ",").split(",")]
    return tuple(p for p in parts if p)


def _truthy(raw: str | None) -> bool:
    return (raw or "").strip().lower() in {"1", "true", "yes", "y", "granted"}


class CsvSource:
    """Reads work items from a CSV export.

    Required columns: `id`, `phones`. Optional: `locale`, `region`, `consent`, and any
    other column, which is carried through in `context` so the task text can use it.

    `consent` is required to be present as a column. A file with no consent column raises,
    rather than defaulting to consented: a missing column is ambiguous, and the safe
    reading of an ambiguous consent record is not "go ahead".
    """

    REQUIRED = ("id", "phones")

    def __init__(self, path: str | Path, *, encoding: str = "utf-8-sig") -> None:
        self.path = Path(path)
        self.encoding = encoding

    def items(self) -> Iterator[WorkItem]:
        if not self.path.exists():
            raise SourceError(f"No such work file: {self.path}")

        with self.path.open("r", encoding=self.encoding, newline="") as handle:
            reader = csv.DictReader(handle)
            headers = [h.strip() for h in (reader.fieldnames or [])]
            missing = [c for c in self.REQUIRED if c not in headers]
            if missing:
                raise SourceError(
                    f"{self.path.name} is missing required column(s): {', '.join(missing)}"
                )
            if "consent" not in headers:
                raise SourceError(
                    f"{self.path.name} has no 'consent' column. Add one. A missing consent "
                    "record is not the same as consent, and this will not guess."
                )

            seen: set[str] = set()
            for line_number, row in enumerate(reader, start=2):
                item_id = (row.get("id") or "").strip()
                if not item_id:
                    raise SourceError(f"{self.path.name} line {line_number}: empty id")
                if item_id in seen:
                    raise SourceError(
                        f"{self.path.name} line {line_number}: duplicate id {item_id!r}. "
                        "Duplicate ids would share an idempotency key and silently "
                        "collapse into one call."
                    )
                seen.add(item_id)

                phones = _split_phones(row.get("phones") or "")
                if not phones:
                    raise SourceError(
                        f"{self.path.name} line {line_number}: no phone number for {item_id!r}"
                    )

                context = {
                    k: v for k, v in row.items()
                    if k not in {"id", "phones", "locale", "region", "consent"} and v
                }
                yield WorkItem(
                    id=item_id,
                    phones=phones,
                    locale=(row.get("locale") or "").strip() or None,
                    region=(row.get("region") or "").strip() or None,
                    context=context,
                    consented=_truthy(row.get("consent")),
                )


class MemorySource:
    """An in-memory source, for tests and for whoever writes the real adapter next."""

    def __init__(self, items: Iterable[WorkItem]) -> None:
        self._items = list(items)

    def items(self) -> Iterator[WorkItem]:
        return iter(self._items)


__all__ = ["WorkSource", "CsvSource", "MemorySource", "SourceError"]
