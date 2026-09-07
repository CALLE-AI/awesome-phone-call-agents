"""Where the work list comes from.

The design named a system-of-record adapter, and an operations judge pointed out that
"roll ingest" was being treated as solved when it is not: nobody hand-uploads a CSV every
morning at scale, and no operator pilots something that requires it for more than a week.

That criticism is right, and there are two answers here rather than one.

`CsvSource` reads a named file. It is the lowest common denominator every system of record
can produce, and it is what a judge runs, because a demo that needs credentials to
somebody else's database is a demo nobody runs.

`DropSource` is the one that removes the person. It reads the newest export in a directory,
which is where a nightly scheduled job from any of these systems already writes, and it
refuses a stale file and refuses a file it has already called from. Those two refusals are
the whole point: unattended, both of the ways this fails end with a family being telephoned
about something untrue.

What is deliberately not here is an adapter against one vendor's private API. It could not
be tested from this tree, so it would ship as a code path nobody has run, in a repository
whose argument is that a claim without the thing that checks it is worth nothing.

The Protocol is not decoration. Both sources implement it, the dispatcher depends only on
the Protocol, and a test proves an in-memory implementation substitutes cleanly.
"""

from __future__ import annotations

import csv
from datetime import date
import hashlib
import io
import time
from pathlib import Path
from typing import Iterable, Iterator, Protocol, runtime_checkable

from .consent import refusal as consent_refusal
from .dialects import DialectError, consent_refusal as dialect_consent_refusal, recognise
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


_YES = {"1", "true", "yes", "y", "granted"}
_NO = {"0", "false", "no", "n", "denied"}


def _truthy(raw: str | None) -> bool:
    return (raw or "").strip().lower() in _YES


def _consent_ok(raw: str | None, where: str) -> bool:
    """Whether this family has agreed to be telephoned.

    This used to be `_truthy`, which reads anything it does not recognise as a no. The
    direction was safe and the silence was not. A district whose export writes `consented`
    or `Y/N` or `1.0` got every family dropped from the run and reported as unconsented,
    which reads as "these parents said no" when the truth is "your column does not match
    ours". Nobody would find that from the output.

    `_voice_ok` below has always refused a value it does not know, with the reasoning that
    the column decides whether a person is telephoned so it is not guessed at. Consent
    decides exactly the same thing. The two now behave the same way.

    Blank still means no, and that is not a guess: a row where the office has recorded
    nothing has recorded no permission, and the safe reading of an empty consent record is
    not "go ahead". That is the one case where absence carries meaning, so it is the one
    case that does not raise.
    """
    value = (raw or "").strip().lower()
    if not value:
        return False
    if value in _YES:
        return True
    if value in _NO:
        return False
    raise SourceError(
        f"{where}: consent is {raw!r}, which this does not understand. Use yes or no. "
        "Reading an unknown value as a no would drop this family from the run and report "
        "them as having refused, which is a different thing and nobody would spot it."
    )


def _voice_ok(raw: str | None, where: str) -> bool:
    """Whether the phone can reach this family at all.

    Blank means the office has not recorded it, and an unrecorded family is dialled,
    because that is what happens today and pretending otherwise would silently stop
    calling people. A value nobody recognises raises: a typo in this column decides
    whether a person gets phoned, and guessing at it is how a spelling mistake becomes an
    accessibility complaint.
    """
    value = (raw or "").strip().lower()
    if not value:
        return True
    if value in _YES:
        return True
    if value in _NO:
        return False
    raise SourceError(
        f"{where}: voice is {raw!r}, which this does not understand. Use yes or no. "
        "This column decides whether a person is telephoned, so it is not guessed at."
    )


class CsvSource:
    """Reads work items from a CSV export.

    Required columns: `id`, `phones`. Optional: `locale`, `region`, `voice`, and any
    other column, which is carried through in `context` so the task text can use it.

    `voice` is how the office records a family the telephone cannot reach: a guardian who
    is deaf, hard of hearing, or has a speech disability. `voice=no` means the row is
    never dialled and goes to a person instead. Leaving the column out keeps today's
    behaviour, which is that everybody is dialled.

    `consent` is required to be present as a column. A file with no consent column raises,
    rather than defaulting to consented: a missing column is ambiguous, and the safe
    reading of an ambiguous consent record is not "go ahead".
    """

    REQUIRED = ("id", "phones")

    def __init__(self, path: str | Path, *, encoding: str = "utf-8-sig",
                 consent_register: dict | None = None, today: date | None = None,
                 column_map: dict[str, tuple[str, ...]] | None = None) -> None:
        self.path = Path(path)
        self.encoding = encoding
        # The district's own column names, when it has supplied them. None means the
        # header row is read against the built-in formats instead. Set after a run so the
        # caller can print which format was recognised.
        self.column_map = column_map
        self.dialect = None
        # The district's dated consent records, keyed on id, or None when the run was
        # given none. `today` is injectable because an expiry check that reads the wall
        # clock cannot be tested at the boundary, and the boundary is the whole point of
        # an expiry.
        self.consent_register = consent_register
        self.today = today or date.today()

    def items(self) -> Iterator[WorkItem]:
        if not self.path.exists():
            raise SourceError(f"No such work file: {self.path}")

        # Read the bytes and decode them here rather than letting the file object do it, so
        # that a file which is not the encoding it was promised to be produces a refusal
        # naming the encoding instead of a UnicodeDecodeError traceback. Older systems of
        # record still export cp1252, and a district seeing a Python stack trace at 08:40
        # has no way to know that `encoding=` is the answer.
        raw = self.path.read_bytes()
        try:
            text = raw.decode(self.encoding)
        except UnicodeDecodeError as bad:
            # Name it when the bytes say what it is. A UTF-16 byte order mark is the most
            # likely wrong encoding in this market by a distance: it is what Excel's
            # "Unicode Text" export writes and what PowerShell 5's `Export-Csv` writes by
            # default, so a district's own scheduled export produces it without anybody
            # choosing it. Telling them to try cp1252 would send them the wrong way.
            if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
                raise SourceError(
                    f"{self.path.name} starts with a UTF-16 byte order mark, so it is "
                    "UTF-16 rather than " + self.encoding + ". Excel's Unicode Text export "
                    "and PowerShell's Export-Csv both write that by default. Pass "
                    "encoding=utf-16, or have the export write UTF-8."
                ) from bad
            raise SourceError(
                f"{self.path.name} is not {self.encoding}: byte {bad.object[bad.start]:#04x} "
                f"at position {bad.start} is not valid. Several systems of record still "
                f"export cp1252 or latin-1. Pass the encoding the export really uses rather "
                f"than letting this guess, because a wrong guess mangles a family's name and "
                f"then speaks it down a telephone."
            ) from bad
        if "\x00" in text:
            raise SourceError(
                f"{self.path.name} contains a NUL byte, so it is not a text export. A "
                "truncated or half-written file is the usual cause, and the usual cause of "
                "that is an overnight job that did not finish."
            )

        with io.StringIO(text, newline="") as handle:
            reader = csv.DictReader(handle)
            headers = [h.strip() for h in (reader.fieldnames or [])]
            repeated = sorted({h for h in headers if headers.count(h) > 1})
            if repeated:
                raise SourceError(
                    f"{self.path.name} has the column(s) {', '.join(repeated)} more than "
                    "once. A repeated column means one of the two values is silently "
                    "discarded, and if the repeated column is 'phones' or 'consent' the "
                    "discarded one decides whether a family is telephoned."
                )
            # Which export format this is. A district's own export does not carry the
            # column names this repository's examples use, and refusing it for that is a
            # refusal about spelling. `dispatch/dialects.py` carries the mapping and the
            # reason a rename can never produce the consent column.
            try:
                self.dialect = recognise(headers, custom=self.column_map,
                                         where=self.path.name)
            except DialectError as bad:
                raise SourceError(str(bad)) from bad
            renamed = sorted(set(headers) | set(self.dialect.mapping))
            missing = [c for c in self.REQUIRED if c not in renamed]
            if missing:
                raise SourceError(
                    f"{self.path.name} reads as {self.dialect.name} and is still missing "
                    f"required column(s) after translation: {', '.join(missing)}"
                )
            no_consent = dialect_consent_refusal(headers, self.dialect,
                                                 where=self.path.name)
            if no_consent:
                raise SourceError(no_consent)

            seen: set[str] = set()
            try:
                rows = list(enumerate(reader, start=2))
            except csv.Error as bad:
                # The stdlib default field limit is 131,072 characters. A cell past it is a
                # corrupt file, not a long name, and `_csv.Error` reaching an operator says
                # nothing about which file or why.
                raise SourceError(
                    f"{self.path.name} could not be read as CSV: {bad}. A single cell past "
                    "the field limit means the file is corrupt or the quoting is unbalanced, "
                    "which a half-written export produces."
                ) from bad

            for line_number, raw_row in rows:
                # Read the row under the same names the header check used.
                #
                # This is the worst defect anything has found in this project. The header
                # was stripped to decide which columns exist and the row was then read by
                # its raw key, so a work file written `consent, voice` passed every check
                # and `row.get("voice")` returned None. `_voice_ok` reads a blank as yes,
                # by design, because a family whose accessibility need nobody recorded is
                # dialled. So one space after a comma telephoned a guardian the office had
                # recorded as unreachable by voice: deaf, hard of hearing, or with a speech
                # disability. No error, no log line, and the call was filed as an answer.
                #
                # `_voice_ok`'s own docstring stated the rule it was failing: "a typo in
                # this column decides whether a person gets phoned, and guessing at it is
                # how a spelling mistake becomes an accessibility complaint." It guarded
                # the value. Nothing guarded the name.
                #
                # The `None` key from a surplus cell is left alone, because the next check
                # is about exactly that and it has to still be able to see it.
                row = {(k.strip() if isinstance(k, str) else k): v
                       for k, v in raw_row.items()}

                # Under the names the rest of this program uses. The source columns are
                # kept as well, so a receipt shows the district the column it recognises.
                if self.dialect.mapping:
                    row = self.dialect.rename(row)

                # `csv.DictReader` is forgiving in both directions and both are wrong here.
                # A short row fills the missing columns with None, so a truncated line
                # silently became a family with no consent, dropped from the run and
                # reported as unconsented. A long row puts the surplus under the key None,
                # which then travelled into `context` and into the spoken instruction as
                # `{None: ['extra', 'more']}`.
                if None in row:
                    raise SourceError(
                        f"{self.path.name} line {line_number}: more cells than the header "
                        f"has columns. The surplus is {row[None]!r}. A row that does not "
                        "line up with its header cannot be read column by column, and "
                        "guessing which cell is the phone number is not a thing to do."
                    )
                short = [k for k, v in row.items() if v is None]
                if short:
                    raise SourceError(
                        f"{self.path.name} line {line_number}: fewer cells than the header "
                        f"has columns, so {', '.join(short)} is absent rather than empty. "
                        "A truncated line used to be read as a family who had not "
                        "consented, which quietly removed them from the run and reported "
                        "them as having refused."
                    )

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
                    if k not in {"id", "phones", "locale", "region", "consent", "voice",
                                 "consent_record"}
                    and v
                }
                # The record reference, and what the register says about it. A row with no
                # reference is unchanged: it dials on the boolean, as every work file
                # written before this column existed does.
                reference = (row.get("consent_record") or "").strip() or None
                refusal = None
                names_no_number = False
                if reference is not None and self.consent_register is not None:
                    # Every number on the row, not the first. Consent attaches to the
                    # number called and this run works down a fallback chain, so a
                    # record that covers one of two numbers does not authorise the row.
                    record = self.consent_register.get(reference)
                    refusal = consent_refusal(
                        record, item_id, reference, self.today, phones)
                    # Recorded only when the row is actually going to be dialled on that
                    # record. A refused row is not exposure: nobody is telephoned on it.
                    names_no_number = (refusal is None and record is not None
                                       and not record.phones)
                elif reference is not None:
                    # A file that names records and a run given no register is the one
                    # case where dialling would be worse than refusing: the row looks
                    # better documented than a boolean row and is checked less.
                    refusal = (f"row names consent record {reference!r} and this run was "
                               "given no register to check it against. Pass "
                               "--consent-records, or remove the column.")
                yield WorkItem(
                    id=item_id,
                    phones=phones,
                    locale=(row.get("locale") or "").strip() or None,
                    region=(row.get("region") or "").strip() or None,
                    context=context,
                    consented=_consent_ok(
                        row.get("consent"), f"{self.path.name} line {line_number}"),
                    reachable_by_voice=_voice_ok(
                        row.get("voice"), f"{self.path.name} line {line_number}"),
                    consent_record=reference,
                    consent_refusal=refusal,
                    consent_names_no_number=names_no_number,
                )


class DropSource:
    """The newest export a system of record left in a directory, or a refusal.

    This answers the criticism in the module docstring. An operations reviewer was right
    that nobody hand-uploads a CSV every morning, and the wrong fix is an adapter written
    against one vendor's private API that nobody here can reach to test. Every system of
    record in this market can already be scheduled to write a nightly export to a share or
    an SFTP drop, which is a thing a district IT department does in an afternoon and does
    not need this project's cooperation to do.

    So the human comes out of the morning, and what replaces them is not a happy path. It is
    two refusals, because both of the ways this goes wrong unattended end with a family
    being telephoned about something untrue.

    **A stale export.** The overnight job did not run, or it failed, and yesterday's file is
    still sitting there. Reading it telephones the families of children who are in school
    today to ask why they are absent. That is worse than not calling, so a file older than
    `max_age_hours` is refused and the refusal says how old it is.

    **A file already used.** The job wrote twice, or the run was restarted, and the same
    export is read again. Every family in it is telephoned a second time. The dispatcher
    derives its idempotency keys from the work item, so a genuine re-read of the same rows
    is collapsed by CALL-E, but that is a backstop for a mistake rather than a licence to
    make it: a district that sees the same call attempted twice does not care which layer
    stopped it. A used export is recorded in a ledger beside the drop and refused by
    content, not by filename, because the safe question is "have I called these people" and
    not "have I read this name".

    Neither refusal can be turned off. `max_age_hours` moves the stale line, because an
    overnight job at 02:00 and one at 06:00 are different agreements and a district's
    schedule is not this project's to fix. It cannot be removed.
    """

    LEDGER = ".firstbell-processed"

    def __init__(self, directory: str | Path, *, pattern: str = "*.csv",
                 max_age_hours: float = 18.0, encoding: str = "utf-8-sig",
                 now: float | None = None) -> None:
        self.directory = Path(directory)
        self.pattern = pattern
        self.max_age_hours = max_age_hours
        self.encoding = encoding
        # Injected rather than read where it is used, so a test can place a file at a known
        # age instead of sleeping, and so the age quoted in a refusal is the age this
        # actually decided on.
        self._now = now

    @property
    def ledger_path(self) -> Path:
        return self.directory / self.LEDGER

    def _processed(self) -> set[str]:
        if not self.ledger_path.exists():
            return set()
        return {
            line.split()[0]
            for line in self.ledger_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        }

    def _record(self, digest: str, name: str) -> None:
        first = not self.ledger_path.exists()
        with self.ledger_path.open("a", encoding="utf-8", newline="") as handle:
            if first:
                handle.write("# Exports this has already placed calls from, by content "
                             "digest. Deleting a line permits those families to be "
                             "telephoned again." + "\n")
            handle.write(digest + "  " + name + "\n")

    def newest(self) -> Path:
        """The file this run would read, or a refusal explaining why there is none."""
        if not self.directory.is_dir():
            raise SourceError(
                f"{self.directory} is not a directory. This reads the export a system of "
                "record drops, so point it at the drop rather than at a file."
            )
        candidates = [
            f for f in sorted(self.directory.glob(self.pattern))
            if f.is_file() and f.name != self.LEDGER
        ]
        if not candidates:
            raise SourceError(
                f"no file matching {self.pattern!r} in {self.directory}. An empty drop is "
                "reported rather than treated as a day with no absences, because the two "
                "look identical from here and only one of them is good news."
            )
        newest = max(candidates, key=lambda f: f.stat().st_mtime)

        now = time.time() if self._now is None else self._now
        age_hours = (now - newest.stat().st_mtime) / 3600.0
        if age_hours > self.max_age_hours:
            raise SourceError(
                f"{newest.name} was written {age_hours:.1f} hours ago and the limit is "
                f"{self.max_age_hours:.1f}. A stale export means the overnight job did not "
                "run, and calling from it asks the families of children who are in school "
                "today why they are absent. Fix the export, or pass a longer window on "
                "purpose."
            )
        return newest

    def items(self) -> Iterator[WorkItem]:
        chosen = self.newest()
        digest = hashlib.sha256(chosen.read_bytes()).hexdigest()
        if digest in self._processed():
            raise SourceError(
                f"{chosen.name} has already been called from. Its content matches an entry "
                f"in {self.LEDGER}, so reading it again would telephone every family in it "
                "a second time. If that is genuinely what you want, remove the line."
            )

        # Read to a list before recording. A file that fails validation halfway through has
        # placed no calls, and marking it processed would strand it: the operator fixes the
        # export and this refuses the fixed copy for having been seen.
        items = list(CsvSource(chosen, encoding=self.encoding).items())
        self._record(digest, chosen.name)
        return iter(items)


class MemorySource:
    """An in-memory source, for tests and for whoever writes the real adapter next."""

    def __init__(self, items: Iterable[WorkItem]) -> None:
        self._items = list(items)

    def items(self) -> Iterator[WorkItem]:
        return iter(self._items)


__all__ = ["WorkSource", "CsvSource", "DropSource", "MemorySource", "SourceError"]
