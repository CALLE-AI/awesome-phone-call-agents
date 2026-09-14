"""A dated consent record, and the seven ways a row fails to have one.

`docs/the-legal-surface.md` has said since the first draft that the largest open question
in this software is what a district's consent artifact actually is, and that a defensible
answer replaces the boolean column with a reference to a dated record. It called that a
schema change and a district conversation rather than a patch, which is true, and then did
the conversation half and left the schema half undone. A district reading the entry could
take home the argument and nothing else.

This is the schema half. It is not a consent management system and it does not collect
anything: the record is a document a district produces from whatever it already has, and
this file is the shape it has to be in and the checking that happens before a phone rings.

Two design decisions are worth arguing with.

The enums. `channel` and `purpose` exist so that a blanket "we may contact you about your
child" cannot be read as permission to telephone about an absence. A district that ticks
one box at enrolment has not consented to this specific call, and a schema that cannot
express the difference invites the reading that it has.

Every refusal is its own sentence. "No consent" over a record withdrawn last week and "no
consent" over a mistyped date are the same outcome and completely different conversations
with a family, and an attendance officer holding the queue is the person who has to have
them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .e164 import canonical

# What a record must carry, and what it may. `id` is what a work file points at;
# `student_id` is what stops one family's permission being read as another's.
REQUIRED = ("id", "student_id", "channel", "purpose", "given_at")
OPTIONAL = ("guardian_name", "expires_at", "withdrawn_at", "evidence",
            "recorded_by", "phones")

CHANNELS = ("voice", "sms", "email")
PURPOSES = ("attendance", "emergency", "general")

# This software telephones about an absence. Nothing else in either enum permits that, and
# widening either of these is a decision a district makes, not a convenience.
CHANNEL_REQUIRED = "voice"
PURPOSE_REQUIRED = "attendance"

# The subset of JSON Schema this checks, published so a district can validate a register
# with its own tooling rather than with this one. Kept beside the code that enforces it so
# the two cannot describe different documents.
RECORD_SCHEMA = {
    "type": "object",
    "required": list(REQUIRED),
    "properties": {
        "id": {"type": "string"},
        "student_id": {"type": "string"},
        "guardian_name": {"type": "string"},
        "channel": {"type": "string", "enum": list(CHANNELS)},
        "purpose": {"type": "string", "enum": list(PURPOSES)},
        "given_at": {"type": "string", "description": "ISO 8601 date, not in the future"},
        "expires_at": {"type": "string", "description": "ISO 8601 date, or absent"},
        "withdrawn_at": {"type": "string",
                         "description": "ISO 8601 date. Any value means withdrawn"},
        "evidence": {"type": "string"},
        "recorded_by": {"type": "string"},
        "phones": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The numbers this permission covers. Absent means the record "
                           "names a student and no number, which the run counts and "
                           "reports rather than treating as any number",
        },
    },
}


class RegisterError(Exception):
    """The register itself is unusable, so no row in the run has a checkable permission.

    Raised rather than reported per row. A register with one malformed record is a
    document somebody has to look at, and dialling the rows it happened to parse would be
    calling families on the strength of a file nobody trusts.
    """


@dataclass(frozen=True)
class ConsentRecord:
    """One permission: one guardian, one student, one channel, one purpose, one date."""

    id: str
    student_id: str
    channel: str
    purpose: str
    given_at: date
    expires_at: date | None = None
    withdrawn_at: date | None = None
    evidence: str = ""
    recorded_by: str = ""
    # Both kept out of the repr for the reason given on `WorkItem.phones`: a consent
    # record names a guardian and the numbers the permission covers, so its default
    # repr carries the same two things a receipt is forbidden to carry. The record id
    # and the student id stay visible, which is what a register bug is debugged from.
    guardian_name: str = field(default="", repr=False)
    # The numbers this permission covers, compared on digits. Empty means the record
    # names a student and no number.
    phones: tuple[str, ...] = field(default=(), repr=False)

    def covers_number(self, number: str) -> bool:
        """Whether this record names the number about to be dialled.

        The number about to be dialled has to be an address first. `canonical` returns
        None for anything that is not exact ASCII E.164, and a None here is False: this
        method answers "may we ring this", and there is nothing to ring.

        The register side is still compared on digits, so `+1 555 010 0301` in a register
        and `+15550100301` in a work file are one telephone. A record naming no numbers
        covers none of them and this returns False for every number, because the caller
        has to be able to tell "this record does not cover that number" from "this record
        names no numbers at all", and those are different sentences to a family.

        The digit comparison used `str.isdigit()`, which is true for Unicode decimal
        digits and, worse, for superscripts. A record holding `see note` with a superscript
        five stripped to a single character, a row carrying any other superscript five
        stripped to the same one, and the two compared equal: a permission for nothing at
        all covered a number nobody had checked. Both sides are ASCII digits now, and the
        dialled side cannot reach this comparison at all unless it is already an address,
        so the equality has nothing left to be accidental about.
        """
        address = canonical(number)
        if address is None:
            return False
        want = _ascii_digits(address)
        return any(_ascii_digits(held) == want for held in self.phones)



def _ascii_digits(text: str) -> str:
    """The digits a telephone network can carry, and only those.

    `str.isdigit()` is the same trap `sources._ascii_digits` documents: it is true for
    Eastern Arabic and Devanagari numerals and for superscripts, none of which are
    addresses. This is the register-side copy of that function, kept here rather than
    imported so `dispatch.consent` stays free of a cycle with `dispatch.sources`.
    """
    return "".join(ch for ch in text if "0" <= ch <= "9")


def _as_date(value: object, field: str, where: str) -> date:
    if not isinstance(value, str) or not value.strip():
        raise RegisterError(
            f"{where}: {field} is {value!r}, which is not a date. A consent record with "
            "no usable date is not dated, and an undated permission is the thing this "
            "schema exists to replace.")
    try:
        return date.fromisoformat(value.strip())
    except ValueError as err:
        raise RegisterError(
            f"{where}: {field} is {value!r} and does not parse as an ISO 8601 date "
            f"({err}). Use YYYY-MM-DD.") from err


def _as_phones(value: object, where: str) -> tuple[str, ...]:
    """The numbers on a record, or a refusal about the shape they arrived in.

    A bare string is refused rather than read as one number. `"+15550100301,+15550100302"`
    in a field declared as a list is a register somebody exported wrong, and reading it as
    a single telephone number produces a record that covers a number nobody has.
    """
    if value in (None, ""):
        return ()
    if isinstance(value, str):
        raise RegisterError(
            f"{where}: phones is a string. It has to be a list, even for one number, "
            "because a comma-joined string read as one number produces a record covering "
            "a telephone nobody has.")
    if not isinstance(value, list):
        raise RegisterError(f"{where}: phones has to be a list, not "
                            f"{type(value).__name__}")
    out = []
    for entry in value:
        if not isinstance(entry, str) or not entry.strip():
            raise RegisterError(f"{where}: phones contains {entry!r}, which is not a "
                                "telephone number")
        if not _ascii_digits(entry):
            raise RegisterError(
                f"{where}: phones contains {entry!r}, which has no digits in it. A "
                "district export writes 'unknown' and 'n/a' into a phone column, and a "
                "record holding one of those names no telephone while looking as though "
                "it names one.")
        out.append(entry.strip())
    return tuple(out)


def record_from(raw: object, where: str) -> ConsentRecord:
    """One record, or a refusal naming what is wrong with it.

    Unknown keys are refused rather than ignored. A register written against a later
    version of this schema, or with `witdrawn_at` misspelled, would otherwise be read as a
    record with no withdrawal on it, which is the one misreading that ends with a call to
    a family that asked not to be called.
    """
    if not isinstance(raw, dict):
        raise RegisterError(f"{where}: a consent record has to be an object, not "
                            f"{type(raw).__name__}")
    missing = [key for key in REQUIRED if not str(raw.get(key) or "").strip()]
    if missing:
        raise RegisterError(f"{where}: consent record is missing {', '.join(missing)}")
    unknown = sorted(set(raw) - set(REQUIRED) - set(OPTIONAL))
    if unknown:
        raise RegisterError(
            f"{where}: consent record carries {', '.join(unknown)}, which this schema does "
            "not define. A misspelled `withdrawn_at` would be read as a record nobody "
            "withdrew, so an unrecognised key is refused rather than ignored.")
    channel = str(raw["channel"]).strip().lower()
    purpose = str(raw["purpose"]).strip().lower()
    if channel not in CHANNELS:
        raise RegisterError(f"{where}: channel is {channel!r}, not one of "
                            f"{', '.join(CHANNELS)}")
    if purpose not in PURPOSES:
        raise RegisterError(f"{where}: purpose is {purpose!r}, not one of "
                            f"{', '.join(PURPOSES)}")
    withdrawn = raw.get("withdrawn_at")
    expires = raw.get("expires_at")
    return ConsentRecord(
        id=str(raw["id"]).strip(),
        student_id=str(raw["student_id"]).strip(),
        channel=channel,
        purpose=purpose,
        given_at=_as_date(raw["given_at"], "given_at", where),
        expires_at=(None if expires in (None, "") else _as_date(expires, "expires_at", where)),
        withdrawn_at=(None if withdrawn in (None, "")
                      else _as_date(withdrawn, "withdrawn_at", where)),
        evidence=str(raw.get("evidence") or "").strip(),
        recorded_by=str(raw.get("recorded_by") or "").strip(),
        guardian_name=str(raw.get("guardian_name") or "").strip(),
        phones=_as_phones(raw.get("phones"), where),
    )


def load_register(payload: object, where: str = "the consent register") -> dict[str, ConsentRecord]:
    """Every record in a register, keyed on its id.

    Accepts either a bare list or an object with a `records` list, because a district
    exporting this from a system will produce one or the other and refusing on that would
    be a refusal about punctuation.
    """
    if isinstance(payload, dict):
        records = payload.get("records")
        if records is None:
            raise RegisterError(
                f"{where}: an object register needs a `records` list. A file with no "
                "records in it cannot be told apart from a file that failed to load.")
    else:
        records = payload
    if not isinstance(records, list):
        raise RegisterError(f"{where}: records has to be a list, not "
                            f"{type(records).__name__}")
    if not records:
        raise RegisterError(
            f"{where}: the register is empty. A run pointed at an empty register would "
            "refuse every row and report a wave of consent refusals, which is a claim "
            "about families rather than about a file.")
    out: dict[str, ConsentRecord] = {}
    for i, raw in enumerate(records, start=1):
        record = record_from(raw, f"{where}, record {i}")
        if record.id in out:
            raise RegisterError(
                f"{where}: two records share the id {record.id!r}. One of them would be "
                "silently discarded, and there is no way to know which of the two a work "
                "file meant.")
        out[record.id] = record
    return out


def refusal(record: ConsentRecord | None, student_id: str, reference: str,
            today: date, numbers: tuple[str, ...] = ()) -> str | None:
    """Why this row may not be dialled on this record, or None if it may.

    Eight checks, in the order that puts the family's own decision first. Each returns a
    sentence an attendance officer can act on, because the person holding the queue is the
    one who has to have the conversation.

    The eighth is about the number, and it exists because a district's data protection
    officer asked for it and was right. Under the TCPA consent attaches to the number
    called and not to the person the number belongs to. A record naming a student says
    nothing about which of two numbers on a row may be dialled, and this software works a
    fallback chain, so a row with a good record and a second number nobody agreed to would
    have dialled the second number.

    `numbers` is every number on the row rather than the one about to be tried, because a
    row is either dialled or it is not, and refusing at the third number after two calls
    have gone out is a refusal that arrives too late to matter.

    A record naming no numbers passes this check. That is the open exposure rather than a
    decision: a register written before this field existed has no numbers in it, refusing
    every such row would stop every deployment that has one, and instead the run counts
    and prints how many rows rested on a record that named no number.
    """
    if record is None:
        return (f"consent record {reference!r} is not in the register. A reference to a "
                "record nobody can produce is not a record.")
    if record.student_id != student_id:
        return (f"consent record {reference!r} is for {record.student_id}, not "
                f"{student_id}. One family's permission is not another's.")
    if record.withdrawn_at is not None:
        return (f"consent record {reference!r} was withdrawn on "
                f"{record.withdrawn_at.isoformat()}.")
    if record.expires_at is not None and record.expires_at < today:
        return (f"consent record {reference!r} expired on "
                f"{record.expires_at.isoformat()}.")
    if record.given_at > today:
        return (f"consent record {reference!r} is dated {record.given_at.isoformat()}, "
                "which is in the future. A permission that has not been given yet is not "
                "a permission.")
    if record.channel != CHANNEL_REQUIRED:
        return (f"consent record {reference!r} covers {record.channel}, not "
                f"{CHANNEL_REQUIRED}. This software telephones people.")
    if record.purpose != PURPOSE_REQUIRED:
        return (f"consent record {reference!r} covers {record.purpose}, not "
                f"{PURPOSE_REQUIRED}. A general permission to make contact is not "
                "permission to telephone about an absence.")
    if record.phones and numbers:
        uncovered = [n for n in numbers if not record.covers_number(n)]
        if uncovered:
            return (f"consent record {reference!r} covers "
                    f"{len(record.phones)} number(s) and this row carries "
                    f"{len(uncovered)} the record does not name. Consent attaches to the "
                    "number called, and this software works down a fallback chain, so a "
                    "row is dialled only when the record covers every number on it.")
    return None
