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
from .e164 import canonical
from .models import WorkItem, redact


@runtime_checkable
class WorkSource(Protocol):
    """Anything that can produce the day's phone work."""

    def items(self) -> Iterable[WorkItem]:
        ...


class SourceError(Exception):
    pass


# The same seven-digit floor `models.redact` uses, and for the same reason: shorter than
# any diallable number, longer than an extension, a footnote marker or a SIP code. A floor
# existed on the path that decides what is masked and nowhere on the path that decides what
# is dialled.
_DIALLABLE_FLOOR = 7


def _ascii_digits(text: str) -> str:
    """Digits a telephone network can carry.

    `str.isdigit()` is true for superscripts and for Eastern Arabic numerals, so a cell of
    `٩٨٧٦٥٤٣٢١٠` was accepted as a number and dialled, and `unknown²` counted as carrying a
    digit. E.164 is ASCII.
    """
    return "".join(ch for ch in text if "0" <= ch <= "9")


def _split_phones(raw: str) -> tuple[str, ...]:
    """A person's numbers, in the order they should be tried.

    CALL-E models `phones` as a list per recipient, so the fallback chain is a first-class
    part of the request rather than something we have to orchestrate ourselves.

    An entry that is not a diallable number is dropped. `unknown`, `n/a` and `none` all
    arrive in the phone column of a real district export, and each one used to become an
    attempt: the dialler tried it, the platform refused it, and the row spent a place in the
    fallback chain on a word. Dropping it here rather than at the dialler keeps the count of
    numbers on the row equal to the count of numbers somebody could answer.

    Three things used to break that invariant. The filter was "contains a digit", so
    `ext. 4`, `unknown²` and `see note ⁵` all survived it. The split ran on commas as well as
    semicolons with no floor, so a single comma-grouped number, which `models.redact`'s own
    comment records as a format real vendors write, became four numbers: the row was then
    refused as `invalid_phone`, which is in `NEVER_CARRIED`, so the run reported that the
    platform refused the call when the cause was the district's formatting, and
    `households._key` reads the digits of `phones[0]`, which is `"1"` for every such row, so
    unrelated children were filed as one family and held behind a call about another child.
    And a number written twice on one row stayed twice, which rings one house twice inside a
    single call: the harm `dispatch/households.py` exists to prevent, reached from inside a
    row rather than across rows, while inflating `attempts_made` and so `calls_placed`.
    """
    parts = [p.strip() for p in raw.replace(";", ",").split(",")]
    numbers = [p for p in parts if len(_ascii_digits(p)) >= _DIALLABLE_FLOOR]
    if not numbers:
        # No part is diallable on its own. Either the cell holds one number grouped with
        # the same character this splits on, or it holds nothing worth dialling. Asking the
        # whole cell tells the two apart without guessing at a vendor's grouping style.
        whole = raw.strip()
        return (whole,) if len(_ascii_digits(whole)) >= _DIALLABLE_FLOOR else ()
    # Compared on digits, so the same telephone written two ways is one telephone, and the
    # first spelling wins because that is the order the district wrote them in.
    seen: dict[str, str] = {}
    for one in numbers:
        seen.setdefault(_ascii_digits(one), one)
    return tuple(seen.values())


# `_split_phones` answers a parser's question: does this cell hold something
# somebody could answer. It deliberately keeps the district's own spelling, so
# `+1, 800, 555, 0199` survives as one number written the way the export wrote it.
# That string then went to the platform as the destination, which is a different
# question with a worse failure: the filter is `seven ASCII digits somewhere inside`,
# so `ring mum on 5550100301 after three` was a diallable number too.
#
# So the spelling is resolved to the one address a telephone network carries before
# anything downstream can dial it, and a spelling that resolves to no address stops
# the file rather than being dropped. Dropping it would shorten a fallback chain
# without saying so, and a chain one number shorter than the office believes is how
# a family goes uncontacted while the receipt reports every number was tried.
def _diallable(spellings: tuple[str, ...]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    numbers: dict[str, None] = {}
    refused: list[str] = []
    for one in spellings:
        address = canonical(one)
        if address is None:
            refused.append(one)
        else:
            numbers.setdefault(address, None)
    return tuple(numbers), tuple(refused)


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
                # `reader.line_num` and not a counter. A quoted cell containing a newline is
                # one CSV record spread over several physical lines, so a counter and the
                # file diverge from that row onward and every refusal below sends an
                # operator to the wrong place: "line 3" landing in the middle of record 2.
                # The reader already carries the physical position; it was not being read.
                rows = [(reader.line_num, row) for row in reader]
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

                raw_phones = (row.get("phones") or "").strip()
                spellings = _split_phones(raw_phones)
                phones, unreachable = _diallable(spellings)
                if unreachable:
                    # Masked. This message names the cell the district wrote, and the
                    # reason the cell is being quoted at all is that it contains digits.
                    raise SourceError(
                        f"{self.path.name} line {line_number}: {item_id!r} has a phone "
                        f"entry that is not an E.164 number: {redact(unreachable[0])!r}. "
                        "A destination needs a leading +, a country code that does not "
                        "start with zero, and eight to fifteen ASCII digits. Fix the cell "
                        "or remove the entry; this run will not guess which number was "
                        "meant.")

                if not phones:
                    # Two different things a reader has to tell apart: an empty cell, and
                    # a cell holding a word. The second one looks filled in on a
                    # spreadsheet, so the message quotes it.
                    detail = (f"no phone number for {item_id!r}" if not raw_phones else
                              f"no phone number for {item_id!r}: the phones column holds "
                              f"{raw_phones!r}, which has no digits in it")
                    raise SourceError(
                        f"{self.path.name} line {line_number}: {detail}"
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
                 now: float | None = None, consent_register: dict | None = None,
                 today: date | None = None,
                 column_map: dict[str, tuple[str, ...]] | None = None) -> None:
        self.directory = Path(directory)
        self.pattern = pattern
        self.max_age_hours = max_age_hours
        self.encoding = encoding
        # Passed straight through to the `CsvSource` this builds per export. Without them
        # the unattended path could not use a dated consent register even once the caller
        # had loaded one, and it then refused every row that named a record with the words
        # "Pass --consent-records", which is the thing the operator had already done. Same
        # for a district's own column mapping: the drop is the path a district automates,
        # so it is the path most likely to be reading a vendor's own export shape.
        self.consent_register = consent_register
        self.today = today
        self.column_map = column_map
        # Injected rather than read where it is used, so a test can place a file at a known
        # age instead of sleeping, and so the age quoted in a refusal is the age this
        # actually decided on.
        self._now = now
        # The export this source read, held until a caller says calls went out from it.
        self._read: tuple[str, str] | None = None

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

        # Read, and record nothing. The ledger's own header says these are the exports this
        # has placed calls from, and reading a file places none. Recording here strands the
        # day's work on every refusal that comes after ingest, which is all of them: the
        # `--yes-i-mean-it` confirmation, the missing key, the credential origin, the call
        # ceiling, and every offline run. The caller says when calls were placed.
        #
        # An earlier fix moved this line below the parse, for the same reason one step
        # smaller: a file that fails validation places no calls either. Its comment said the
        # ledger is written once there is something to place calls from, which is not the
        # same thing as once calls have been placed.
        items = list(CsvSource(chosen, encoding=self.encoding,
                               consent_register=self.consent_register,
                               today=self.today, column_map=self.column_map).items())
        if not items:
            # The third failure mode, and the only one that looks like good news. A stale
            # export and a re-used one are both refused above. An overnight job that wrote
            # the header row and then died parsed to zero rows and returned cleanly, so the
            # school day passed with nobody telephoned and cron saw exit 0. The docstring on
            # this class already commits to this distinction for an empty directory; a
            # truncated file is the same claim about the same day.
            raise SourceError(
                f"{chosen.name} has a header row and nothing under it. An export with no "
                "rows is reported rather than treated as a day with no absences, because "
                "the two look identical from here and only one of them is good news. If "
                "the overnight job genuinely found no absences, there is nothing to call "
                "from and nothing to record."
            )
        self._read = (digest, chosen.name)
        return iter(items)

    def placed_calls_from(self) -> None:
        """Record the export this source read, now that a run has telephoned from it.

        Separate from `items()` because only the caller knows whether the account was
        billed. It is not enough that a dispatcher ran: a wave whose every row was held for
        a person dialled nobody, and recording that would refuse the export tomorrow when
        the held rows are ready to go.

        Refuses rather than guessing when nothing has been read. The digest belongs to the
        file this source chose, and choosing again could pick up an export that landed in
        the meantime, which is the wrong file to mark.
        """
        if self._read is None:
            raise SourceError(
                f"{self.directory} has not read an export in this run, so there is nothing "
                "to record as called from. Reading the drop directory again could choose a "
                "different file than the one the calls went out from."
            )
        digest, name = self._read
        self._record(digest, name)


class MemorySource:
    """An in-memory source, for tests and for whoever writes the real adapter next."""

    def __init__(self, items: Iterable[WorkItem]) -> None:
        self._items = list(items)

    def items(self) -> Iterator[WorkItem]:
        return iter(self._items)


__all__ = ["WorkSource", "CsvSource", "DropSource", "MemorySource", "SourceError"]
