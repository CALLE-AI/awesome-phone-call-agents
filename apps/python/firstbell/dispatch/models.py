"""The vocabulary the dispatcher works in.

The important idea here is that a phone call has **three** terminal outcomes, not two.
CALL-E can return a call whose status is `completed` while `structured_result` is null,
which means somebody answered, a conversation happened, and the schema still could not be
filled. Code that branches on status alone records that as contacted, and a person who
needed a callback never gets one.

So `Resolution` has RESOLVED, FAILED and UNDETERMINED, and nothing in this package is
allowed to collapse the third into either of the other two.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Resolution(str, Enum):
    RESOLVED = "resolved"          # schema-valid answer came back
    FAILED = "failed"              # the call did not happen, or was refused
    UNDETERMINED = "undetermined"  # the call happened and produced no usable answer
    SKIPPED = "skipped"            # never dispatched: cancelled, or blocked by a gate

    @property
    def needs_a_human(self) -> bool:
        """Whether the CALL itself came back short. Not the whole question.

        Read this on its own and it says a schema-valid answer never needs a person,
        which was true of the data and false of the world. Ask `ItemResult.needs_a_human`
        instead unless the resolution really is all you have.
        """
        return self in (Resolution.UNDETERMINED, Resolution.FAILED)


# The reason a row was never dialled, written once so that whoever counts the skips
# later is reading the same string the gate wrote. Counting skips by resolution alone
# reported a cancelled run as a wave of consent refusals.
NO_CONSENT = "no recorded consent to be called"
NO_VOICE_CHANNEL = ("this family is not reachable by a voice call; "
                    "nothing was dialled and somebody has to reach them another way")
CANCELLED = "cancelled before dispatch"


class Escalation(str, Enum):
    """Whether an answer, having arrived intact, is safe to close automatically.

    This is a second axis and not a fourth `Resolution`, because the two questions are
    genuinely different and collapsing them loses one. `Resolution` is about the call: did
    a usable answer come back. `Escalation` is about the answer: is what it says something
    a person has to see. An answer can be perfectly well-formed and still be the most
    urgent thing in the queue.

    Adding a fourth resolution instead would have quietly broken the rule this package is
    named for. Three outcomes are load-bearing here, and a caller counting `resolved`
    against a four-member enum would have started dropping the new one on the floor in
    exactly the way two-outcome code drops `undetermined` today.
    """

    NONE = "none"
    SAFEGUARDING = "safeguarding"


# Error codes where retrying the identical request is reasonable. Everything outside this
# set is treated as permanent, because retrying an `invalid_phone` just burns budget.
RETRYABLE_ERRORS = frozenset({
    "rate_limit_exceeded",
    "provider_unavailable",
    "internal_error",
    # The call this request refers to has not finished initialising on the platform
    # side. That is a clock problem, not a content problem: the identical request sent
    # again shortly after is expected to land once the platform catches up.
    "call_not_ready",
    # Same shape as call_not_ready, on the goal side. Not ready yet is still a timing
    # question, so it belongs with the codes worth trying again rather than with the
    # ones that need a person to change something first.
    "goal_not_ready",
})

# Error codes that mean this work item can never succeed as submitted.
PERMANENT_ERRORS = frozenset({
    "invalid_phone",
    "invalid_recipient",
    "no_recipients",
    "unsupported_region",
    "unsupported_language",
    "recipient_blocked",
    "policy_violation",
    "result_schema_invalid",
    "recipient_result_schema_invalid",
    "invalid_request",
    # The goal referenced is a draft that was never published. Retrying the identical
    # request cannot publish it; a person has to do that first.
    "goal_not_published",
    # The goal referenced is published but cannot run as configured (disabled,
    # archived, or similar). A configuration problem, not a timing one, so retrying
    # changes nothing.
    "goal_not_executable",
    # The request tried to override a result schema the account or goal does not allow
    # overriding. A caller-side configuration mistake, present in every retry.
    "schema_override_not_allowed",
    # The variables supplied for the task or template failed validation. Bad input
    # data, exactly like invalid_recipient, and identical on every retry.
    "variables_invalid",
    # The idempotency key collided with an earlier request whose body differs. This is
    # a bug in how this caller builds keys, not in the recipient or the call content,
    # and it will not clear until the key construction is fixed, so it belongs here
    # rather than with the codes worth retrying. `err.code` and the vendor message both
    # survive into the failure reason, so this reads as "idempotency_conflict" in a
    # queue, not as an anonymous permanent failure that looks like a bad phone number.
    "idempotency_conflict",
})

# Failure codes that mean no telephone ever rang.
#
# A failed row has two completely different meanings and one of them is a claim about a
# family. Either the network carried the call and nobody was reached, which is what an
# office acts on by calling again, or CALL-E refused or could not carry it, which no
# number of retries changes and which needs another channel or a person. Counting the
# second as the first files a platform problem on a child's record, and that is the exact
# move this package refuses on the call side.
#
# This is the set that can be proved from the code the platform returned. Every one of
# these is raised before or instead of a dialling attempt. A code not in here is left in
# the "nobody reached" bucket, unchanged: a code nobody has seen is not evidence of
# anything, and guessing which side it fell on would be this same error mirrored.
NEVER_CARRIED = frozenset({
    "invalid_phone",
    "invalid_recipient",
    "no_recipients",
    "unsupported_region",
    "unsupported_language",
    "recipient_blocked",
    "policy_violation",
    "invalid_request",
    "goal_not_published",
    "goal_not_executable",
    "schema_override_not_allowed",
    "variables_invalid",
    "idempotency_conflict",
    # Retryable, and still a refusal: these exhaust the retry policy and land as failed
    # having never reached a telephone. A rate limit filed as "nobody reached on any
    # number" is a district's morning turning into unreachable families because the
    # platform asked us to slow down.
    "rate_limit_exceeded",
    "provider_unavailable",
    "internal_error",
    "call_not_ready",
    "goal_not_ready",
})

# Anything here should stop the whole run rather than the item: continuing wastes money
# or cannot possibly work.
FATAL_ERRORS = frozenset({
    "insufficient_balance",
    "unauthorized",
    "forbidden",
    # A call this run itself just created came back not_found. That is not a per-item
    # data problem like invalid_phone, and it is not a timing problem retrying clears:
    # either the platform lost track of billable state or this client is pointed at
    # the wrong environment. Continuing to dispatch more calls into that state risks
    # placing more billed calls this run can never account for, so it stops the run
    # for a person to look at rather than grinding through the rest of the batch.
    "not_found",
})


@dataclass(frozen=True)
class WorkItem:
    """One unit of phone work: one person to reach, however many numbers they have."""

    id: str
    # Kept out of the repr, here and on ItemResult below. `masked_numbers` is the only view
    # anything serialises, so no production path formats one of these today. A repr is the
    # sink nobody chooses: one print, one error reporter that captures locals, one pytest
    # assertion message on a live run. The field still compares and still hashes; only the
    # printed form loses it, and the id beside it is what makes a repr worth reading.
    phones: tuple[str, ...] = field(repr=False)
    locale: str | None = None
    region: str | None = None
    context: dict[str, Any] = field(default_factory=dict)
    consented: bool = True
    # The id of a dated consent record in the register, when the work file names one.
    # `docs/the-legal-surface.md` says the boolean this sits beside is the largest open
    # question in this software and that a defensible answer replaces it with a reference
    # to a dated record. This is that reference. None means the row arrived with a boolean
    # and nothing else, which still dials and is counted separately in the run, because a
    # column that says yes is not a record and a district's counsel will ask which it was.
    consent_record: str | None = None
    # Why this row may not be dialled on that record, in a sentence an attendance officer
    # can act on. Set by the source, never by the dispatcher: whether a permission covers
    # this call is a property of the district's paperwork, not of telephony.
    consent_refusal: str | None = None
    # True when a dated record authorised this row and named no telephone number at all.
    # Consent attaches to the number called, so a record that names a pupil and no number
    # is the district's remaining exposure rather than a pass. It is a pass here, because
    # every register written before that field existed has no numbers in it and refusing
    # those rows would stop every deployment that has one. So the run counts them and
    # prints the count, which is the honest version of not refusing them.
    consent_names_no_number: bool = False
    # False when the office has recorded that the phone cannot reach this family: a
    # guardian who is deaf, hard of hearing, or has a speech disability. This app cannot
    # discover that by dialling, and dialling anyway files them under "nobody answered",
    # which is a record that says the family was unreachable when the channel was.
    reachable_by_voice: bool = True
    # Set when another absence on the same telephone number is being called this run, and
    # holds the id of the row that is. `dispatch/households.py` explains why this row is
    # held rather than closed on the other call's answer: the structured result has one
    # subject in it, and three records closed on one subject is an answer this program was
    # never given.
    household_held_for: str | None = None
    held_reason: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("WorkItem needs an id; it is the idempotency anchor.")
        if not self.phones:
            raise ValueError(f"WorkItem {self.id} has no phone numbers.")

    def recipient(self) -> dict[str, Any]:
        """The CALL-E recipient shape. `phones` is the fallback chain, in order."""
        payload: dict[str, Any] = {"phones": list(self.phones)}
        if self.locale:
            payload["locale"] = self.locale
        if self.region:
            payload["region"] = self.region
        return payload


@dataclass
class ItemResult:
    item: WorkItem
    resolution: Resolution
    call_id: str | None = None
    # The id CALL-E's own dashboard and usage page are keyed on. It is not the API's `id`,
    # and without it a receipt cannot be cross-referenced against the vendor's billing
    # record, which is the only account of a call nobody in this repository writes.
    provider_call_id: str | None = None
    structured_result: dict[str, Any] | None = None
    failure_code: str | None = None
    reason: str = ""
    attempts_made: int = 0
    numbers_tried: tuple[str, ...] = field(default=(), repr=False)
    transcript: tuple[dict[str, Any], ...] = field(default=(), repr=False)
    # True: this run placed the call. False: an idempotency key replayed an earlier one,
    # so no call was made and nothing was billed. None: the response carried no usable
    # created_at, so we do not know, and saying "placed" would be a guess.
    placed_by_this_run: bool | None = None
    # Whether the call reached a terminal completion and a conversation therefore happened,
    # whatever came back from it. Recorded because `UNDETERMINED` has two very different
    # populations under one word and no field distinguished them: three of its producers
    # mean somebody picked up and the answer was unusable, and five mean nothing is known
    # about whether a telephone was answered at all, or no call was placed. Anything that
    # divides by "answered" needs the first population and was being handed both.
    #
    # `NEVER_CARRIED` exists so "the platform refused it" is not filed as "nobody was
    # reached". This is the same distinction on the other side of the same word.
    spoke_to_someone: bool = False
    # Set by the caller's own rule, because what counts as unsafe to close is a property
    # of the domain and not of telephony. This package supplies the channel and the
    # default, which is that nothing escalates unless something says so.
    escalation: Escalation = Escalation.NONE
    # A skipped row is normally nobody's problem: an unconsented family was never going
    # to be dialled and nothing is owed. This one is different. The call was not placed
    # because the channel cannot carry it, so the work did not go away, it moved.
    needs_another_channel: bool = False
    # When the provider says the call ended, verbatim from its payload. A safeguarding
    # callback window is thirty minutes from this moment, so a queue without it can show
    # a position and cannot show a clock, which is what a district buyer reading the
    # published queue found: four identical rows under "Speak to this family first", no
    # time raised and no minutes left. None means the payload carried none, and a queue
    # that filled that in from its own clock would be inventing the one number the rule
    # is measured against.
    completed_at: str | None = None
    # The idempotency key of a request that went out, was never answered, and returned no
    # call id. Three paths reach that state: a 200 carrying no id, a create that ran out of
    # attempts unanswered, and a cancel landing during a create backoff. None of them can
    # enter `not_recallable`, which is a list of call ids, and all three may be on a bill.
    #
    # It is a recovery handle and not a label. CALL-E honours idempotency keys, so sending
    # the identical request again under this key replays the original and returns the call
    # object with its id, without a second telephone ringing. The key is stable per item and
    # per day, so the recovery is same-day.
    possibly_placed_key: str | None = None

    @property
    def masked_numbers(self) -> tuple[str, ...]:
        """Never log a real number. The repo's PR checklist requires masking."""
        return tuple(mask(n) for n in self.numbers_tried)

    @property
    def needs_a_human(self) -> bool:
        """The whole question, and the one every caller should be asking.

        `resolution.needs_a_human` answers only whether the call came back short. It was
        the only thing anyone asked, so an answer that arrived complete was closed no
        matter what it said, and the one case this software exists to catch was the one
        it filed automatically.
        """
        return (self.resolution.needs_a_human
                or self.escalation is not Escalation.NONE
                or self.needs_another_channel)


def dial_refusal(item: WorkItem) -> str | None:
    """Why this row will not be dialled, in the words the queue prints, or None if it will.

    One definition, because there were two. `WaveDispatcher.run` gates on four things in a
    deliberate order, and the call ceiling in `firstbell/cli.py` counted rows on two of them,
    so a run of five rows that would place two calls was refused with "this run would phone 4
    families" and told the operator to pass `--max-calls 4`. Following that instruction sets
    the ceiling to twice the spend it is there to cap.

    The gate that was supposed to catch this said in its own docstring that it would fail if
    the dispatcher grew a third reason to skip a row. The dispatcher had four from the start
    and the gate's fixture only contained rows for two of them, so it passed. A copy of two
    branches of a four-branch rule is not a check on that rule.

    The order is the dispatcher's and it is not arbitrary. `held_reason` first because it is
    the only one of the four that says nothing about the family: they consented, the
    telephone reaches them, and the reason this row is not a call is that the same call is
    already going out. The dated record before the boolean column, because a record
    withdrawn last week sits beside a `consent` column that still says yes, and reading the
    weaker of two answers is how somebody who asked not to be called gets called.
    """
    if item.held_reason:
        return item.held_reason
    if item.consent_refusal:
        return f"{NO_CONSENT}: {item.consent_refusal}"
    if not item.consented:
        return NO_CONSENT
    if not item.reachable_by_voice:
        return NO_VOICE_CHANNEL
    return None


def mask(phone: str) -> str:
    if len(phone) <= 5:
        return "*" * len(phone)
    return f"{phone[:3]}{'*' * (len(phone) - 5)}{phone[-2:]}"


# Seven digits, because that is shorter than any diallable number and longer than anything
# this app wants to keep: a SIP code is three, an HTTP status is three, and "E.164" is
# three. Separators are allowed inside the run so that a number written 04 1234 5678,
# (04) 1234-5678 or +1, 800, 555, 0199 is still caught. The comma matters: CALL-E
# quotes the number it rejected and a vendor that groups it with commas was breaking
# the run into pieces shorter than the floor, so none of them were masked.
#
# The class is every non-alphanumeric character rather than a list of the ones seen so far.
# An ASCII list was the same bug one layer up: Word and Excel autocorrect a typed hyphen to
# an en dash between digits in several locales, a pasted number carries a zero-width space,
# and a vendor export groups with a slash. Each of those split the run below the floor and
# nothing was masked. Widening cannot over-mask, because `hide` below returns any run of
# fewer than seven digits unchanged, so the floor and not the class is what protects a SIP
# code. It stops at letters, which is what keeps "E.164" and "attempt 2 of 3" whole.
_LONG_DIGIT_RUN = re.compile(r"\+?\d[\d\W_]{5,}\d")


def redact(text: str) -> str:
    """Mask any phone-shaped digit run in text this app did not write.

    `mask` is applied to numbers on the way out. This is the same rule applied to numbers
    on the way in, which is the direction that leaked: CALL-E's `invalid_phone` message
    quotes the number it rejected, and storing that message unchanged put a real number in
    stdout and in a receipt.

    It is deliberately blunt. A long digit run in a vendor error message or an exception is
    masked whether or not it is a phone number, so a timestamp inside one loses its digits
    too. That costs a little readability in a line nobody reads unless something broke, and
    it buys a rule with no exceptions to get wrong. The `code` beside it is a fixed
    vocabulary and is never touched, so the useful half survives.
    """
    def hide(match: re.Match[str]) -> str:
        digits = re.sub(r"[^\d+]", "", match.group())
        return mask(digits) if len(re.sub(r"\D", "", digits)) >= 7 else match.group()

    return _LONG_DIGIT_RUN.sub(hide, text)


def redact_free_text(value: Any) -> Any:
    """Run `redact` over every string inside a structure this app did not author.

    A structured result is CALL-E's account of what a person said, so any field of it can
    carry a number the caller read out. `--include-transcript` governs the transcript and
    has never governed the result, which is written on every run.

    Every string is masked rather than the ones whose names look like free text, because a
    name list has to be kept in step with the schema and this does not. The values this app
    writes are codes and enumerations with no long digit run, so they come back unchanged.
    """
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {k: redact_free_text(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_free_text(v) for v in value]
    return value


@dataclass
class DispatchReport:
    results: list[ItemResult] = field(default_factory=list)
    cancelled: bool = False
    cancelled_after: int = 0
    not_recallable: list[str] = field(default_factory=list)
    fatal_error: str | None = None

    def by(self, resolution: Resolution) -> list[ItemResult]:
        return [r for r in self.results if r.resolution is resolution]

    @property
    def needs_human(self) -> list[ItemResult]:
        """Everything a person has to look at, worst first.

        Order is part of the output. A queue that lists an escalation below eleven
        ordinary callbacks has technically reported it, and a clerk working top-down
        reaches it last.
        """
        queue = [r for r in self.results if r.needs_a_human]
        queue.sort(key=lambda r: 0 if r.escalation is not Escalation.NONE else 1)
        return queue

    @property
    def escalated(self) -> list[ItemResult]:
        return [r for r in self.results if r.escalation is not Escalation.NONE]

    def counts(self) -> dict[str, int]:
        out = {r.value: 0 for r in Resolution}
        for result in self.results:
            out[result.resolution.value] += 1
        return out

    @property
    def placed_without_id(self) -> list[ItemResult]:
        """Requests that may have landed and returned no id, recoverable by their key.

        Derived rather than accumulated, on purpose. A second list on the dispatcher would
        be a second thing to keep in sync with the rows, and the rows are the record. Any
        result that carries a `possibly_placed_key` is one of these, whatever path put it
        there, so a fourth path added later appears here without anyone remembering to
        register it.
        """
        return [r for r in self.results if r.possibly_placed_key]

    def summary(self) -> str:
        c = self.counts()
        parts = [
            f"{c['resolved']} resolved",
            f"{c['undetermined']} undetermined",
            f"{c['failed']} failed",
            f"{c['skipped']} skipped",
        ]
        line = ", ".join(parts)
        if self.cancelled:
            line += (f" | cancelled after {self.cancelled_after} dispatched"
                     f", {len(self.not_recallable)} already in flight and not recallable")
        elif self.not_recallable:
            # A poll failure fills `not_recallable` without setting `cancelled`, and this
            # used to mention the list only inside the branch above. The comment in
            # `scheduler._handle` justified keeping such a call in flight on the grounds
            # that "it is already printed, so a reader sees the id rather than a wrong
            # verdict". It was not printed on this path, which is the one that happens
            # without anyone asking for it.
            line += (f" | {len(self.not_recallable)} call(s) placed and not accounted "
                     f"for: {', '.join(self.not_recallable)}")
        # Printed on its own terms, outside the branches above, because the branches
        # are the reason this fact was invisible. The line was
        # `if cancelled: ... elif not_recallable: ...`, and the comment in that `elif`
        # records the last time a fact only reached the surface inside a branch somebody
        # else's condition owned. On the cancel path this list exists for, `cancelled` is
        # true and `not_recallable` is empty, so the reader was handed "0 already in flight
        # and not recallable" about a run that may have placed a call.
        #
        # The wording keeps the two apart. `not_recallable` is calls with ids that cannot be
        # accounted for; these are requests with no id at all, and the sentence says what to
        # do about them rather than only that they exist.
        if self.placed_without_id:
            keys = ", ".join(f"{r.item.id} under {r.possibly_placed_key}"
                             for r in self.placed_without_id)
            line += (f" | {len(self.placed_without_id)} request(s) may have been placed "
                     f"and returned no id: {keys}. Re-run the same command today to replay "
                     f"them under those keys rather than call again")
        if self.fatal_error:
            line += f" | run stopped: {self.fatal_error}"
        return line
