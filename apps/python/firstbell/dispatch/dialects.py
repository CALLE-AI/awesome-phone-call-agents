"""The column names a district's export actually has, and the one it never has.

A district does not write a CSV with the headers `id, phones, consent`. It runs a
scheduled export out of PowerSchool, Infinite Campus, Skyward or Aspen, and what lands in
the directory carries whatever names that vendor's export format uses. Handing that file
to a reader that demands three literal names produces `missing required column(s): id,
phones` at 08:40, which is a refusal about spelling dressed up as a refusal about data.

So this translates. Three things about how, because each one is a decision somebody could
reasonably make the other way.

**A dialect is recognised, and the run says which.** Detection is on a header the other
dialects do not have, the recognised name is printed, and a file matching two dialects is
refused rather than resolved by order. Guessing which of two mappings a district meant is
guessing which cell is a telephone number.

**A rename never manufactures consent.** This is the part worth reading. No export format
here carries a column recording that a guardian agreed to be telephoned by an automated
system about an absence, because that permission is not a fact about a student and no
system of record was built to hold it. OneRoster has `sms` and `phone`, which are
contactability, not permission. Clever has the same. So a translated file still has to
carry consent, from a column the district added or from a dated record under
`docs/consent-record.md`, and the refusal when it does not says exactly that instead of
saying a column is missing. `docs/the-legal-surface.md` has argued since the first draft
that a boolean is not a consent record. This is where a real export proves the point: it
does not even have the boolean.

**The mapping is data, and a district can pass its own.** The two built-in dialects are
written from published field names, and a vendor's export is a thing this repository
cannot test against because it has none. `--column-map` takes the district's own mapping
so a format nobody here has seen does not need a code change.
"""
from __future__ import annotations

from dataclasses import dataclass, field


class DialectError(Exception):
    """The header row cannot be read as any one format."""


@dataclass(frozen=True)
class Dialect:
    """One export format, and how its columns line up with the three names used here.

    `signature` is the header that identifies the format. `mapping` is target name to the
    source columns tried in order, so a format holding two numbers under two names yields
    both, in that order, as the fallback chain CALL-E dials down.
    """

    name: str
    signature: tuple[str, ...]
    mapping: dict[str, tuple[str, ...]] = field(default_factory=dict)
    described_as: str = ""
    reference: str = ""

    def matches(self, headers: set[str]) -> bool:
        return all(column in headers for column in self.signature)

    # How each target's sources are joined. `phones` is a list the fallback chain walks,
    # so a comma is the separator that means "or". A name is one value spelled across two
    # columns, and "Marcus,Ellery" is not a name: it is what the pupil would have been
    # called down the telephone before this existed.
    JOINS = {"student_name": " "}

    def rename(self, row: dict[str, str]) -> dict[str, str]:
        """The row under the names the rest of this program uses.

        Source columns are kept as well as translated. A district looking at a receipt
        wants to see `sourcedId` in the context it recognises, and the task text can use
        any column, so dropping the original would remove data to save a key.
        """
        out = dict(row)
        for target, sources in self.mapping.items():
            found = [(row.get(name) or "").strip() for name in sources]
            values = [value for value in found if value]
            if values:
                out[target] = self.JOINS.get(target, ",").join(values)
        return out


# The format used by this repository's own examples, and the one a district gets when it
# writes the file by hand from the four columns `docs/` asks for.
NATIVE = Dialect(
    name="firstbell",
    signature=("id", "phones"),
    described_as="this repository's own four columns",
    reference="README.md",
)

# OneRoster v1.2 `users.csv`. The field names are the specification's: `sourcedId` is the
# stable identifier, and `phone` and `sms` are the two contact numbers a user record
# carries. `sms` is tried second because a number recorded only for text messages is the
# weaker of the two for a voice call, not because it will not work.
ONEROSTER = Dialect(
    name="oneroster-1.2",
    signature=("sourcedId",),
    mapping={"id": ("sourcedId",), "phones": ("phone", "sms"),
             "student_name": ("givenName", "familyName")},
    described_as="OneRoster v1.2 users.csv",
    reference=("1EdTech OneRoster v1.2 CSV binding, users.csv fields sourcedId, "
               "givenName, familyName, phone, sms"),
)

# A Clever-shaped export, where the student identifier and the guardian's number are named
# for what they are. `phone` is tried after `guardian_phone` because a student's own
# number is not the number to ring about that student's absence, and a file carrying both
# should dial the guardian first.
CLEVER = Dialect(
    name="clever",
    signature=("student_id",),
    mapping={"id": ("student_id",), "phones": ("guardian_phone", "phone"),
             "student_name": ("name", "student_name")},
    described_as="a Clever-shaped export keyed on student_id",
    reference="Clever SIS sync, student_id and guardian contact columns",
)

DIALECTS = (NATIVE, ONEROSTER, CLEVER)

# What no export in this list has, and what the run will not proceed without.
CONSENT_COLUMN = "consent"


def _catalogue() -> str:
    return "\n".join(
        f"      {d.name:<16} needs {', '.join(d.signature)}   ({d.described_as})"
        for d in DIALECTS
    )


def recognise(headers: list[str], *, custom: dict[str, tuple[str, ...]] | None = None,
              where: str = "the work file") -> Dialect:
    """Which format this header row is, or a refusal naming what would make it readable.

    A custom mapping wins outright, because a district that has written one has answered
    the question this function exists to ask.
    """
    if custom:
        return Dialect(name="column-map", signature=(), mapping=custom,
                       described_as="the mapping supplied on the command line",
                       reference="--column-map")

    present = {h for h in headers}
    found = [d for d in DIALECTS if d.matches(present)]

    if len(found) > 1:
        names = ", ".join(d.name for d in found)
        raise DialectError(
            f"{where}: the header row reads as {names} at the same time, so which column "
            "is the identifier depends on which format is picked and the two do not agree. "
            "Rename the column you do not mean, or pass --column-map to say outright.")
    if not found:
        raise DialectError(
            f"{where}: the header row is not a format this recognises. It has "
            f"{', '.join(sorted(present)) or 'no columns'}.\n"
            "    Recognised:\n" + _catalogue() + "\n"
            "    Or pass --column-map with your own, which is one JSON object of "
            "{target: [source, ...]}.")
    return found[0]


def consent_refusal(headers: list[str], dialect: Dialect, *,
                    where: str = "the work file") -> str | None:
    """Why a recognised file still cannot be dialled, or None when it can.

    Split out from `recognise` because the two failures are different conversations. An
    unrecognised header row is an integration problem somebody fixes in an hour. A
    recognised export with no consent column is the thing this software is about, and the
    sentence a district reads at that moment is the most useful one in the program.
    """
    if CONSENT_COLUMN in {h for h in headers}:
        return None
    if dialect.name == NATIVE.name:
        return (f"{where} has no 'consent' column. Add one. A missing consent record is "
                "not the same as consent, and this will not guess.")
    return (
        f"{where} reads as {dialect.described_as}, and that format has no column recording "
        "consent to be telephoned by an automated system about an absence. Nor does any "
        "other export here: contactability is a fact a system of record holds, and "
        "permission is not, so no rename can produce it.\n"
        "    Two ways forward, and a district picks one.\n"
        "      Add a 'consent' column to the export, which is a boolean, and the run will "
        "say so on every line.\n"
        "      Produce a dated register and pass --consent-records. "
        "docs/consent-record.md is the schema, and it is the defensible one.\n"
        "    The run stops here rather than dialling, because the reading of a missing "
        "permission that ends with a family being telephoned is the one this refuses to "
        "make.")
