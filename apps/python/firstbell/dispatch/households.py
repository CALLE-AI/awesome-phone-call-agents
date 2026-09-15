"""One call per household, and the record that one call does not close.

Three children in a family are off with the same virus. The register has three rows, and
until this existed the run dialled the same mother three times inside a quarter of an
hour, each call opening with an automated-caller disclosure and asking her about one child
as though the other two calls had not happened. Nothing in the code was wrong. Every row
was a separate person to it, which is true of a row and false of a telephone.

The grouping is on the number that would be dialled first, because that is the thing the
harm is measured in: a second call to a different number is not a second call to the same
person. Rows sharing a first number are one household for this run, the first of them is
dialled, and the rest are held.

Held, and not closed. That distinction is the whole of this file.

It would be easy to say that a mother who confirms she knows all three children are at
home has answered for all three. She has, in the room. What comes back from the platform
is one structured result about one named child, and there is no repeated field in it for
the other two. So closing three records on one result means writing an answer this program
was not given, into a record about a child, which is the exact move it refuses everywhere
else. The held rows go to a person, with the reason naming the call that was placed.

That leaves the spoken instruction, and it does say all three names, because asking a
parent about one child while holding two more rows about her other children is a worse
call than asking about three. `also_absent_names` reaches the task text through the
dialled row's context, and `also_absent` beside it carries their ids for the ledger. She is asked once, about all of them, and a person spends thirty seconds
closing two records instead of a machine spending two calls opening them.

The missing piece is not in this repository. A structured result with one entry per
subject would let one answer close three records honestly, and `call-e-feedback.md` files
that as a platform finding rather than working around it here.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import replace

from .models import WorkItem

# What a held row's reason begins with. Matched by prefix everywhere, because the sentence
# after it names the row that was dialled and a bucket keyed on the whole string moves the
# row into the wrong total the first time that name changes.
HOUSEHOLD_HELD = "another absence in the same household is being called"


def _key(item: WorkItem) -> str:
    """The number this row would be dialled on first.

    Digits only, so a register holding `+1 555 0100` on one row and `+15550100` on another
    is one household rather than two. `WorkItem` refuses a row with no numbers at all,
    so there is no empty case to handle here. A number that is punctuation and nothing
    else keys on the row's own id instead, which makes it its own household rather
    than collecting every unparseable number in the file into one.
    """
    digits = "".join(ch for ch in item.phones[0] if ch.isdigit())
    return digits or f"unparseable-{item.id}"


def group(items: list[WorkItem]) -> tuple[list[WorkItem], dict[str, list[str]]]:
    """The same rows, with the second and later of each household held.

    Returns the rows in their original order and a map from the dialled row's id to the
    ids held behind it. Order is preserved because the first row of a household is the one
    dialled, and a district reading a receipt against its own export needs the run to have
    picked the row the export put first rather than one this program sorted to the top.

    Only rows that would actually be dialled are grouped. A row with no consent, or one the
    telephone cannot reach, is not a call, so holding a sibling behind it would hold a row
    behind a call nobody was going to make.
    """
    houses: OrderedDict[str, list[WorkItem]] = OrderedDict()
    for item in items:
        if not (item.consented and item.reachable_by_voice) or item.consent_refusal:
            continue
        houses.setdefault(_key(item), []).append(item)

    held: dict[str, list[str]] = {}
    held_names: dict[str, list[str]] = {}
    holds: dict[str, WorkItem] = {}
    for members in houses.values():
        if len(members) < 2:
            continue
        first, rest = members[0], members[1:]
        held[first.id] = [other.id for other in rest]
        # The ids are what the receipt and the held rows are keyed on. What a parent is
        # asked is a name, and this used to hand `also_absent` a list of ids, so the
        # sentence in this module's own docstring would have read "S-3102, S-3103" down
        # the telephone if anything had read it at all. A row with no name contributes
        # nothing rather than a placeholder, because "the student" beside two real names
        # is worse than two names.
        held_names[first.id] = [
            name for name in ((other.context.get("student_name") or "").strip()
                              for other in rest) if name]
        for other in rest:
            holds[other.id] = first

    if not held:
        return list(items), {}

    out: list[WorkItem] = []
    for item in items:
        siblings = held.get(item.id)
        dialled = holds.get(item.id)
        if siblings:
            context = dict(item.context)
            context["also_absent"] = ", ".join(siblings)
            names = held_names.get(item.id) or []
            if names:
                context["also_absent_names"] = ", ".join(names)
            out.append(replace(item, context=context))
        elif dialled is not None:
            out.append(replace(
                item,
                household_held_for=dialled.id,
                # Short on purpose. It prints on a console line beside six other rows,
                # and a reader scanning a morning's run needs the id and the reason in
                # one glance. Why an answer about one child does not close a record about
                # another is this module's docstring and `docs/district-ingest.md`, not
                # a sentence repeated on every held row. It used to send a reader to
                # `docs/households.md`, which has never existed in this tree: a path in a
                # Python comment is outside `tests/test_doc_links.py`, which reads
                # markdown links, so nothing could notice.
                held_reason=(
                    f"{HOUSEHOLD_HELD}: {dialled.id} is on the same number. One answer "
                    "closes one record, so a person closes this one."),
            ))
        else:
            out.append(item)
    return out, held


def calls_removed(held: dict[str, list[str]]) -> int:
    """How many calls the grouping did not place. The number a district is buying."""
    return sum(len(v) for v in held.values())
