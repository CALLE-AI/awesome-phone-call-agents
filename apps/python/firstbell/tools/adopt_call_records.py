"""Run this entry's decision layer over call records another dialler produced.

A district that already owns a dialler does not want a second one. What it does not have is
the part of this entry that is worth anything: three outcomes instead of two, a consent gate
that refuses in a sentence an attendance officer can act on, and a structured reason a person
can work from. Act 07 of the reviewer page said so as a scoping statement, and a reader in
the buyer's seat asked for it to be the headline. It was not, because until this file existed
the sentence described nothing that ran.

This reads call records in the documented shape below, from any source, and prints what this
software would have done with them. Nothing is dialled, no key is needed, and the arithmetic
of the decision is not reimplemented here: `file_today` and `safeguarding_escalation` are
imported from the same modules the live pipeline calls, so the two paths cannot drift. That
constraint is the whole design. A second implementation of the rule would be a second rule.

## The input

One JSON object per line. Only `id` is required.

    id                  the district's own identifier for the pupil or the call
    numbers             the numbers the other system dialled, as a list
    answered            true, false, or absent when the record does not say
    consent_record      the id of a dated record in the consent register, if there is one
    consented           a bare boolean, for a district whose register predates this field
    result              the structured answer the other system extracted, if it extracted one
    transcript          the call transcript, as text

`result` accepts exactly the five fields in `firstbell.domain.RESULT_SCHEMA` and nothing else.

## The rule this file exists to hold

**A transcript is not a decision.** A record carrying prose and no structured result is filed
`undetermined` and goes on a person's desk. This tool does not read the transcript, does not
guess `parent_confirmed_aware` from a sentence that sounds reassuring, and does not treat the
absence of a field as a negative answer to it.

That is not a limitation, it is the product. The defect this entry was built around is a
schema-valid answer being closed automatically while saying nothing, and inferring a
guardian's confirmation out of free text is the same defect with a better vocabulary. A
district adopting this over its existing dialler gets a smaller closed pile and an honest one.

## The consent audit

These calls have already happened, so the consent gate here is retrospective and that makes it
more useful rather than less: it says which of the calls another system placed were ones the
district's own register covers. `dispatch.consent.refusal` is the same function the live path
uses, so a finding here is a finding there.

Every row is also counted by what it rested on, and the reason is a defect this file shipped
with. A bare `consented: true` is not a refusal, so it produced no finding; there was nowhere
to count it, so it produced no count; and the summary read the empty findings list and said the
call rested on a record the register covers. It rested on a column. The absence of a refusal is
not evidence of a dated record, and telling those two apart is the thing this entry argues
about most. So the report prints `on a record`, `on a boolean`, `on nothing` and `refused`,
the same distinction `ImpactSummary` prints for a live run, and the strong sentence is only
available when every row earned it.

Exit 0 when it measured, 3 when there is nothing to measure from, 2 when the arguments are
wrong. A consent finding is output and not an error, so it does not change the exit code
unless `--fail-on-uncovered` asks it to.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent
for _path in (APP, HERE):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from dispatch.consent import RegisterError, load_register, refusal  # noqa: E402
from dispatch.models import Escalation  # noqa: E402
from firstbell.domain import RESULT_SCHEMA, safeguarding_escalation  # noqa: E402
from replay_escalation import file_today  # noqa: E402

# The five the schema allows, read off the schema so a field added there arrives here.
ALLOWED = tuple(RESULT_SCHEMA.get("properties") or ())

# The CSV form of the same record: the envelope fields, then the five schema fields flat.
# Derived from ALLOWED rather than typed out, so a field added to the schema becomes a
# readable column without anybody remembering to add it in two places.
CSV_COLUMNS = ("id", "numbers", "answered", "consent_record", "consented",
               "transcript") + ALLOWED

NO_RESULT = ("no structured result on the record. A transcript is not a decision, so this "
             "goes to a person rather than being read by software that would have to guess.")
NOT_ANSWERED = ("the record says nobody answered, so there is nothing to close and nothing "
                "to escalate.")


class RecordError(Exception):
    """A line that cannot be read as a call record, named so the reader can fix it."""


# The three states `answered` has, spelled the ways a spreadsheet spells them. An empty cell
# is none of these on purpose: absent is not no, and a CSV export that simply has no column
# value must not be read as the record saying nobody picked up.
TRUE_WORDS = {"true", "yes", "y", "1", "answered"}
FALSE_WORDS = {"false", "no", "n", "0", "unanswered", "noanswer", "no answer"}


def parse_answered(value: object, where: str) -> bool | None:
    """Whether somebody picked up, out of whatever the export wrote there.

    The CSV path had this vocabulary and the JSONL path had `is False`, so a record whose
    `answered` was the string `"false"`, or `"no"`, or the number `0`, was read as somebody
    having picked up, and a call nobody answered was filed closed on whatever result sat
    beside it. A dialler exporting JSON out of a spreadsheet writes strings, and this is a
    tool for reading other people's exports.

    Absent stays absent. `answered` has three states and a record that does not say is not a
    record saying no, which is why this returns `None` rather than defaulting either way.

    Anything else refuses. A value this cannot read is a mapping mistake in the district's
    export, and guessing at it decides whether a family gets telephoned again.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value in (0, 1):
            return bool(value)
        raise RecordError(
            f"{where} says answered is {value!r}, and the only numbers that mean anything "
            "here are 0 and 1")
    if isinstance(value, str):
        word = value.strip().lower()
        if not word:
            return None
        if word in TRUE_WORDS:
            return True
        if word in FALSE_WORDS:
            return False
        raise RecordError(
            f"{where} says answered is {value!r}. This reads "
            f"{', '.join(sorted(TRUE_WORDS))} as yes and {', '.join(sorted(FALSE_WORDS))} "
            "as no, and an empty value as the export not saying")
    raise RecordError(
        f"{where} says answered is a {type(value).__name__}, which cannot say whether "
        "somebody picked up the telephone")


def parse_numbers(value: object, where: str) -> tuple[str, ...]:
    """The telephone numbers this call was placed to.

    A bare string is one number, not a sequence of characters. `tuple(str(n) for n in ...)`
    over `"+15550000101"` produced twelve numbers, one per character, and the consent audit
    then told an attendance officer that the record "covers 1 number(s) and this row carries
    12 the record does not name". That sentence is what somebody acts on.

    A scalar is one number too, because an export that writes the number as a JSON integer
    is wrong about the type and right about the fact. A mapping is neither and refuses.
    """
    if value is None:
        return ()
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return (str(value),)
    if isinstance(value, dict):
        raise RecordError(
            f"{where} gives numbers as an object. This reads a list of numbers, or one "
            "number as a string")
    if isinstance(value, (list, tuple)):
        out = []
        for one in value:
            if isinstance(one, (dict, list, tuple)):
                raise RecordError(
                    f"{where} has a {type(one).__name__} inside numbers, and a telephone "
                    "number is a string")
            text = str(one).strip()
            if text:
                out.append(text)
        return tuple(out)
    raise RecordError(
        f"{where} gives numbers as a {type(value).__name__}, which this cannot read as "
        "telephone numbers")


def read_csv_records(path: Path) -> list[dict]:
    """The same records as a spreadsheet, because that is what a dialler exports.

    A district's existing system produces a CSV and nothing else. Requiring JSONL to use this
    would put a scripting job between a district and the only part of this entry it can
    actually adopt, which is a barrier this file has no reason to impose.

    The five schema fields are flat columns here rather than a nested object, because that is
    how a spreadsheet can carry them. An empty cell means the field is absent, which is not
    the same as a field whose value is `unknown`: one is the export not saying, the other is
    the call not learning. Both end up on a person's desk and they are counted apart.

    `numbers` takes several numbers separated by a semicolon, not a comma, for the obvious
    reason.
    """
    found = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise RecordError(f"{path.name} has no header row, so no column can be named")
        named = [name.strip() for name in reader.fieldnames if name]
        # A duplicated column, before anything else. `csv.DictReader` keeps the last value
        # for a repeated header and says nothing, and putting the names in a set hid the
        # repeat from the check below as well, so a file with `parent_confirmed_aware`
        # twice carrying `no` and then `yes` was filed closed, and the same file with the
        # values the other way round was escalated. Two answers to one question is not a
        # record this tool may pick from.
        seen: set[str] = set()
        twice = sorted({name for name in named if name in seen or seen.add(name)})
        if twice:
            raise RecordError(
                f"{path.name} names the column(s) {', '.join(twice)} more than once. Each "
                "one would silently keep its last value, so a row answering the same "
                "question two ways would be filed on whichever came last.")
        headers = set(named)
        unknown = sorted(headers - set(CSV_COLUMNS))
        if unknown:
            raise RecordError(
                f"{path.name} carries the column(s) {', '.join(unknown)}, which this tool "
                f"does not read. It reads {', '.join(CSV_COLUMNS)}. A column this tool does "
                "not understand is not a column it may quietly ignore, because the record "
                "would be filed undetermined and read as a call that learned nothing.")
        for number, row in enumerate(reader, 2):  # 2: the header is line 1
            cells = {(key or "").strip(): (value or "").strip()
                     for key, value in row.items()}
            if not any(cells.values()):
                continue
            item: dict = {"_line": number}
            if not cells.get("id"):
                raise RecordError(f"line {number} of {path.name} has no id, so its outcome "
                                  "could not be filed against a pupil")
            item["id"] = cells["id"]
            if cells.get("numbers"):
                item["numbers"] = [one.strip() for one in cells["numbers"].split(";")
                                   if one.strip()]
            # Through the same reader the JSONL path uses. This block used to be the only
            # place that knew a spreadsheet writes "no" rather than `false`, and the JSONL
            # path tested `is False`, so the two formats disagreed about the one field that
            # decides whether a call is closed on a result nobody gave.
            said = parse_answered(cells.get("answered"),
                                  f"line {number} of {path.name}")
            if said is not None:
                item["answered"] = said
            if cells.get("consent_record"):
                item["consent_record"] = cells["consent_record"]
            consented = cells.get("consented", "").lower()
            if consented in TRUE_WORDS:
                item["consented"] = True
            elif consented in FALSE_WORDS:
                item["consented"] = False
            if cells.get("transcript"):
                item["transcript"] = cells["transcript"]
            result = {name: cells[name] for name in ALLOWED
                      if name in cells and cells[name]}
            if result:
                item["result"] = result
            found.append(item)
    return found


def read_records(path: Path) -> list[dict]:
    """One object per line, with the line number kept for every complaint.

    Blank lines are skipped and a comment line starting `#` is skipped, because a district
    exporting this from a spreadsheet will put a header comment at the top and failing on it
    would be a rule about text editors rather than about call records.
    """
    if path.suffix.lower() == ".csv":
        return read_csv_records(path)
    found = []
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as bad:
            raise RecordError(f"line {number} is not JSON: {bad.msg}") from bad
        if not isinstance(item, dict):
            raise RecordError(f"line {number} is a {type(item).__name__}, not an object")
        if not str(item.get("id") or "").strip():
            raise RecordError(f"line {number} has no id, so its outcome could not be filed "
                              "against a pupil")
        # Normalised here rather than where they are read, so the two formats cannot
        # disagree and nothing downstream has to know what a spreadsheet writes.
        item["answered"] = parse_answered(item.get("answered"), f"line {number}")
        if item["answered"] is None:
            del item["answered"]
        if "numbers" in item:
            item["numbers"] = list(parse_numbers(item.get("numbers"), f"line {number}"))
        item["_line"] = number
        found.append(item)
    return found


def structured(item: dict) -> tuple[dict | None, str | None]:
    """The structured answer on this record, and why there is none when there is none.

    Unknown keys are refused rather than dropped. A district mapping its own export into this
    shape will get a field name wrong, and silently ignoring it would file the record
    `undetermined` for a reason the reader cannot see, which is the worst of both.
    """
    result = item.get("result")
    if result is None:
        return None, NO_RESULT
    if not isinstance(result, dict):
        raise RecordError(f"line {item['_line']}: `result` is a "
                          f"{type(result).__name__}, not an object")
    if not result:
        return None, NO_RESULT
    unknown = sorted(set(result) - set(ALLOWED))
    if unknown:
        raise RecordError(
            f"line {item['_line']}: `result` carries {', '.join(unknown)}, which "
            f"firstbell.domain.RESULT_SCHEMA does not define. It allows "
            f"{', '.join(ALLOWED)}. A field this tool does not understand is not a field it "
            "may quietly ignore.")
    return result, None


def decide(item: dict) -> dict:
    """One record in, one filed outcome out, with the sentence that explains it.

    `answered is False` is checked before the result, because a call nobody picked up has no
    answer to judge and a record that carries one anyway is describing something else.
    """
    result, why_not = structured(item)
    if item.get("answered") is False:
        return {"id": item["id"], "outcome": "undetermined", "why": NOT_ANSWERED,
                "escalated": False, "had_result": result is not None}
    if result is None:
        return {"id": item["id"], "outcome": "undetermined", "why": why_not,
                "escalated": False, "had_result": False,
                "had_transcript": bool(str(item.get("transcript") or "").strip())}

    filed = file_today(result, with_escalation=True)
    escalation = safeguarding_escalation(result)
    if filed == "closed":
        why = ("the record answers every required field and a guardian confirmed they were "
               "already aware, so nothing here needs a person.")
    elif filed == "escalated":
        who = str(result.get("spoke_with", "")).strip().lower()
        if who and who != "guardian":
            why = (f"somebody answered and the record says it was {who}, not the child's "
                   "guardian. A record cannot be closed on an answer from somebody with no "
                   "authority to give it.")
        else:
            why = ("the record does not carry a guardian's confirmation that they were "
                   "already aware. Only an explicit yes closes an absence record, and an "
                   "absent field is not a reassuring one.")
    else:
        why = ("the answer does not satisfy the schema, or every required field came back "
               "uninformative, so this call learned nothing and the record stays open.")
    return {"id": item["id"], "outcome": filed, "why": why,
            "escalated": escalation is not Escalation.NONE, "had_result": True}


def audit_consent(items: list[dict], register: dict,
                  today: date) -> tuple[list[dict], dict[str, int]]:
    """Which of the calls another system already placed the district's register covers.

    Retrospective on purpose. The calls happened; what a district needs to know is which of
    them its own paperwork authorised, and that question has an answer even after the fact.

    Returns the refusals AND what every row rested on, which is the part this got wrong. It
    used to return refusals alone, so a row carrying a bare `consented: true` produced
    nothing at all: no refusal, because a boolean is not a refusal, and no count, because
    there was nowhere to put one. The summary then read the empty list and said the call
    rested on a record the register covers. It rested on a column.

    That is the one distinction this entry argues hardest about. `ImpactSummary` keeps
    `dialled_on_a_record` and `dialled_on_a_boolean` apart and prints the second as "a column
    that says yes, which is not a record", so this counts them apart for the same reason: the
    absence of a refusal is not evidence of a dated record, and a district's counsel is asking
    which of the two it was.
    """
    findings: list[dict] = []
    provenance = {"record": 0, "boolean": 0, "nothing": 0, "refused": 0}
    for item in items:  # noqa: PLR1702 - one branch per thing a row can rest on
        reference = str(item.get("consent_record") or "").strip()
        numbers = parse_numbers(item.get("numbers"),
                                f"record {item.get('id') or '?'}")
        if reference:
            said = refusal(register.get(reference), str(item["id"]), reference, today,
                           numbers)
            if said:
                findings.append({"id": item["id"], "on": f"record {reference}", "why": said})
                provenance["refused"] += 1
                continue
            # The record stands, and the column beside it still has to be read. This used to
            # `continue` here, which made the rule an OR where the live path is an AND:
            # `dial_refusal` reads the dated record and then the boolean and refuses if
            # either says no, for the reason written in its own docstring, that "a record
            # withdrawn last week sits beside a consent column that still says yes, and
            # reading the weaker of two answers is how somebody who asked not to be called
            # gets called." On a row with a valid record and `consented: false` this tool
            # answered "every call rests on a dated record" and exited 0 while firstbell
            # answered "no recorded consent to be called". A second copy of a gate with
            # fewer branches than the gate is the shape this project has now fixed three
            # times.
            if item.get("consented") is False:
                findings.append({
                    "id": item["id"], "on": f"record {reference} and a boolean",
                    "why": "the dated record covers this call and the consent column says "
                           "consent was not given. The live path refuses when either says "
                           "no, so this call would not have been placed today."})
                provenance["refused"] += 1
                continue
            provenance["record"] += 1
            continue
        if item.get("consented") is False:
            findings.append({"id": item["id"], "on": "a boolean",
                             "why": "the column says consent was not given, and the call was "
                                    "placed anyway."})
            provenance["refused"] += 1
        elif item.get("consented") is True:
            # Not a refusal and not a record. Counted, and named in the report, because this
            # is the row a district's counsel will ask about and it used to be invisible.
            provenance["boolean"] += 1
        else:
            findings.append({"id": item["id"], "on": "nothing",
                             "why": "the record names neither a dated consent record nor a "
                                    "boolean, so nothing here says the district was entitled "
                                    "to place this call."})
            provenance["nothing"] += 1
    return findings, provenance


def uncovered_count(findings: list[dict], provenance: dict[str, int]) -> int:
    """How many calls rest on no dated consent record the register covers.

    This was `len(findings) + boolean + nothing`, and the `else` branch above appends a
    finding *and* increments `nothing`, so every row resting on nothing was counted twice:
    two records could report three uncovered calls. It changed no exit code, because the
    number was only ever tested for truthiness and never printed, which is exactly why it
    survived. A count that cannot be read is a count nobody can check.

    `findings` already contains one entry per refused row and one per row resting on
    nothing. The only uncovered rows it does not contain are those resting on a bare
    boolean, which are not refusals and get no finding.
    """
    return len(findings) + provenance["boolean"]


def report(items: list[dict], filed: list[dict], findings: list[dict],
           provenance: dict[str, int]) -> str:
    counted = {"closed": 0, "escalated": 0, "undetermined": 0}
    for one in filed:
        counted[one["outcome"]] += 1
    # The three outcomes above partition the rows and must keep summing to the total, so
    # this is reported beside them rather than folded into one of them. A row whose every
    # required field came back unknown files as `undetermined`, and if a child answered it
    # is also escalated. The headline said "escalated 0" for a run whose own `--json`
    # marked the row escalated, and the `why` sentence blamed the schema without mentioning
    # who was on the line. This is the state of the committed receipt
    # `04-defect-a-refusal-scored-resolved.json`, so it is not a hypothetical input.
    alarming_but_not_filed_so = [one for one in filed
                                 if one["escalated"] and one["outcome"] != "escalated"]
    no_result = [one for one in filed if not one["had_result"]]
    transcript_only = [one for one in no_result if one.get("had_transcript")]

    out = [
        f"{len(items)} call record(s) read. This dialled nothing.",
        "",
        f"  closed        {counted['closed']:>3}  a guardian confirmed they were aware",
        f"  escalated     {counted['escalated']:>3}  answered, and a person has to see it",
        f"  undetermined  {counted['undetermined']:>3}  nothing here closes the record",
        *([f"  of those undetermined rows, {len(alarming_but_not_filed_so)} also carr"
           f"{'ies' if len(alarming_but_not_filed_so) == 1 else 'y'} a safeguarding "
           "signal and are marked !! in the queue below"]
          if alarming_but_not_filed_so else []),
        "",
    ]
    if transcript_only:
        out.append(f"{len(transcript_only)} of the undetermined carried a transcript and no "
                   "structured result. This tool does not read a transcript to decide: "
                   "inferring a guardian's confirmation from prose is the defect this "
                   "software exists to catch, wearing better clothes.")
        out.append("")
    # Two lists, because it was one and the closed rows were in it. Every row under a heading
    # reading "The queue, escalations first" is a row a clerk reads as work, and two of the
    # six carried the sentence "nothing here needs a person" while sitting in the queue. The
    # queue is what somebody has to do; the rest is what this filed and is printed after it,
    # under its own heading, because it is still the answer to what happened to that pupil.
    # One pupil, two records, opposite answers. An export with the same id twice is two
    # calls about one child, which is legitimate: a first attempt nobody answered and a
    # second that got through. Filing one of them closed is not, because the closed pile is
    # where a clerk stops reading, and `tools/replay_escalation.py` de-duplicates by call
    # id for this exact reason. So both records still print, the row needing a person is
    # the one that decides where the pupil sits, and the collision is named rather than
    # resolved out of sight.
    outcomes: dict[str, set[str]] = {}
    for one in filed:
        outcomes.setdefault(str(one["id"]), set()).add(one["outcome"])
    split = sorted(who for who, seen in outcomes.items() if len(seen) > 1)

    # Sorted on whether a person has to see it, not on the outcome word. A row can
    # be uninformative and alarming at once: every required field came back unknown
    # *and* a child answered. `decide` returns those two facts separately and this
    # read only the outcome, so such a row sorted below every ordinary undetermined
    # one, in a queue a clerk works top-down.
    order = {"escalated": 0, "undetermined": 1, "closed": 2}
    rows = sorted(filed, key=lambda f: (0 if f["escalated"] else 1,
                                        order[f["outcome"]], str(f["id"])))
    queue = [one for one in rows if one["outcome"] != "closed"
             or str(one["id"]) in split]
    closed = [one for one in rows if one["outcome"] == "closed"
              and str(one["id"]) not in split]

    def line(one: dict) -> str:
        # The legend defines `!!` as "a person has to see it", so it follows the
        # escalation flag and not the outcome word. It was withheld from exactly
        # the row that most needed it: undetermined, and a child on the line.
        mark = "!!" if (one["escalated"] or one["outcome"] == "escalated") else "  "
        return f"  {mark} {one['id']:<12} [{one['outcome']}] {one['why']}"

    if split:
        out.append("")
        out.append(
            f"{len(split)} id(s) appear more than once with different outcomes: "
            f"{', '.join(split)}. Two records for one pupil is two calls about one "
            "child, which an export may legitimately hold. Two different answers about "
            "one child is not something this can settle, so every record for those ids "
            "is in the queue below and none of them is in the closed pile.")

    if queue:
        out.append(f"The queue, escalations first. {len(queue)} of {len(filed)} record(s) "
                   "need a person:")
        out.extend(line(one) for one in queue)
    else:
        out.append(f"Nothing in these {len(filed)} record(s) needs a person.")
    out.append("")
    if closed:
        out.append(f"Closed, and needing nobody. {len(closed)} of {len(filed)}:")
        out.extend(line(one) for one in closed)
        out.append("")
    # What every row rested on, printed before the refusals and printed at zero, because an
    # omitted line reads as an absence of information about the good path rather than as a
    # count of nothing on it. `firstbell/domain.py` prints its own consent block the same way
    # and for the same reason.
    out.append("Consent, and what each call rested on. These calls were already placed.")
    out.append(f"     on a record   {provenance['record']:>3}   dated, voice, attendance, "
               "not withdrawn")
    if provenance["boolean"]:
        out.append(f"     on a boolean  {provenance['boolean']:>3}   a column that says yes, "
                   "which is not a record")
        out.append("                         docs/consent-record.md is the schema that "
                   "replaces it")
    if provenance["nothing"]:
        out.append(f"     on nothing    {provenance['nothing']:>3}   neither a record nor a "
                   "column")
    if provenance["refused"]:
        out.append(f"     refused       {provenance['refused']:>3}   a record the register "
                   "does not honour")
    out.append("")
    if findings:
        out.append(f"{len(findings)} of {len(items)} call(s) the register does not cover:")
        for finding in findings:
            out.append(f"     {finding['id']:<12} on {finding['on']}: {finding['why']}")
    elif provenance["record"] == len(items):
        # Only sayable when every row earned it. The old version inferred this from an empty
        # findings list, which is a different and weaker fact.
        out.append(f"Every one of the {len(items)} call(s) rests on a dated record the "
                   "register covers.")
    else:
        out.append("No call here is refused by the register, and not every one rests on a "
                   "dated record. The counts above say which.")
    return "\n".join(out)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Run firstbell's decision layer over call records another dialler "
                    "produced. Dials nothing and needs no account.")
    parser.add_argument("--records", type=Path, default=None,
                        help="JSONL of call records, one object per line")
    parser.add_argument("--consent-register", type=Path, default=None,
                        help="the district's consent register, as used by the live path")
    parser.add_argument("--today", default=None,
                        help="the date to judge consent dates against, as YYYY-MM-DD")
    parser.add_argument("--json", action="store_true",
                        help="machine-readable output instead of the report")
    parser.add_argument("--fail-on-uncovered", action="store_true",
                        help="exit 1 when a call rests on no consent record")
    args = parser.parse_args(argv)

    if args.records is None or not args.records.is_file():
        where = f" at {args.records}" if args.records else ""
        print(f"COULD-NOT-MEASURE  no call records{where}. Pass --records with a JSONL "
              "file, one object per line; examples/other-dialler-records.jsonl in this "
              "repository is a runnable one and the shape is documented at the top of "
              "this file.")
        return 3

    try:
        items = read_records(args.records)
    except RecordError as bad:
        print(f"COULD-NOT-MEASURE  {bad}")
        return 3
    except (UnicodeDecodeError, UnicodeError) as bad:
        # A file that is not UTF-8 raised out of `read_text` and exited 1, which this
        # tool's own contract reserves for a consent finding under --fail-on-uncovered. A
        # district exporting from a system with a Windows codepage hits this on the first
        # accented surname, and the third outcome is exactly what it is for.
        print(f"COULD-NOT-MEASURE  {args.records} is not UTF-8 text: {bad}. Re-export it "
              "as UTF-8, or as UTF-8 with a byte order mark, which this also reads.")
        return 3
    if not items:
        # Two messages, because one of them was wrong about half its inputs. A spreadsheet
        # has neither blank records nor comment lines, so a district whose export produced
        # a header and nothing under it was told its file held only those. The exit code
        # was right and the sentence is the whole of what the district has to work from.
        # str() first. argparse hands this back as a Path, so the first version of this
        # branch raised AttributeError on every empty input file and turned a
        # could-not-measure into a crash. Its own gate caught it on the first run.
        if str(args.records).lower().endswith(".csv"):
            print(f"COULD-NOT-MEASURE  {args.records} has a header row and nothing under "
                  "it, so there are no calls to audit. Export the rows as well as the "
                  "column names.")
        else:
            print(f"COULD-NOT-MEASURE  {args.records} holds no call records, only blank or "
                  "commented lines.")
        return 3

    today = date.today()
    if args.today:
        try:
            today = date.fromisoformat(args.today)
        except ValueError:
            parser.error(f"--today {args.today!r} is not a date as YYYY-MM-DD")

    register = {}
    if args.consent_register is not None:
        if not args.consent_register.is_file():
            print(f"COULD-NOT-MEASURE  no consent register at {args.consent_register}.")
            return 3
        # Both failures, and neither may exit 1. `RegisterError` and `JSONDecodeError`
        # escaped as tracebacks and took the exit code this tool reserves for a consent
        # finding, so a script checking the code could not tell "one of these calls rests
        # on nothing" from "your register file has a typo in it".
        try:
            register = load_register(
                json.loads(args.consent_register.read_text(encoding="utf-8")),
                str(args.consent_register))
        except json.JSONDecodeError as bad:
            print(f"COULD-NOT-MEASURE  {args.consent_register} is not JSON: {bad.msg} at "
                  f"line {bad.lineno}.")
            return 3
        except RegisterError as bad:
            print(f"COULD-NOT-MEASURE  {bad}")
            return 3
        except (UnicodeDecodeError, UnicodeError) as bad:
            print(f"COULD-NOT-MEASURE  {args.consent_register} is not UTF-8 text: {bad}.")
            return 3

    try:
        filed = [decide(item) for item in items]
    except RecordError as bad:
        print(f"COULD-NOT-MEASURE  {bad}")
        return 3
    findings, provenance = audit_consent(items, register, today)

    if args.json:
        print(json.dumps({
            "records": len(items),
            "filed": [{k: v for k, v in one.items() if not k.startswith("_")}
                      for one in filed],
            "consent_findings": findings,
            "consent_provenance": provenance,
            "dialled": 0,
        }, indent=2))
    else:
        print(report(items, filed, findings, provenance))

    # Every call that does not rest on a dated record, not only the ones that produced a
    # refusal. The flag's own help says "exit 1 when a call rests on no consent record",
    # and a bare `consented: true` column is not a record: this report says so itself, on
    # the line reading "on a boolean". It counted such a row, printed it, withheld the
    # strong sentence about it, and then exited 0, so the one machine-readable answer
    # disagreed with everything above it.
    uncovered = uncovered_count(findings, provenance)
    return 1 if (uncovered and args.fail_on_uncovered) else 0


if __name__ == "__main__":
    raise SystemExit(main())
